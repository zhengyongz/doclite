// electron/updater.cjs
// 轻量自动升级模块：GitHub Releases 检查 + 流式下载 + 进度推送（零第三方依赖）
// 说明：使用经典 net.request 而非 net.fetch（实测部分网络环境 net.fetch 对 GitHub 返回 504）。
// 安全设计（按 workbuddy 审查 H1/M1 修复）：下载路径、安装命令、剪贴板写入全部由主进程记账
// （lastDownloaded），所有升级 IPC 不再接受渲染层传入的文件路径/命令文本。
const { app, net, ipcMain, clipboard, shell, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')

const REPO = 'zhengyongz/doclite'
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`
const SUB_DIR = 'DocLite' // 下载目录下的子目录名
const CACHE_TTL = 60_000 // 检查结果缓存时间（防高频重复请求 GitHub API）
const IDLE_TIMEOUT = 30_000 // 网络空闲超时（30 秒无数据即失败，非总时长限制）
const SIZE_CAP_RATIO = 1.1 // 下载大小硬上限系数 = 期望大小 × 该值

let cachedState = null // { ts, result }
let downloading = false // 下载互斥锁（防并发重复下载）
let lastDownloaded = null // 主进程记账：最近一次成功下载的安装包路径

// 懒取当前主窗口：窗口重建（macOS activate 等）后自动指向新窗口
function currentWin() {
  return BrowserWindow.getAllWindows()[0] || null
}

// ---------- 语义化版本比较：返回 -1(a<b) / 0(a==b) / 1(a>b) ----------
// 预发布处理：剥离 -后缀 比较主版本，同主版本下 正式版 > 预发布版（L1）
function compareVersions(a, b) {
  const parse = (v) => {
    const s = String(v || '').replace(/^v/i, '')
    const m = /^(\d+(?:\.\d+)*)(?:-(.+))?$/.exec(s)
    return {
      nums: (m ? m[1] : s).split('.').map((n) => parseInt(n, 10) || 0),
      pre: m ? m[2] : null,
    }
  }
  const pa = parse(a)
  const pb = parse(b)
  const len = Math.max(pa.nums.length, pb.nums.length)
  for (let i = 0; i < len; i++) {
    const da = pa.nums[i] || 0
    const db = pb.nums[i] || 0
    if (da !== db) return da > db ? 1 : -1
  }
  if (pa.pre === pb.pre) return 0
  if (pa.pre == null) return 1
  if (pb.pre == null) return -1
  return 0 // 双方都是预发布版且标识不同：保守判等
}

// ---------- 按当前平台从资产列表中选择安装包（只信任资产列表内文件） ----------
function pickAsset(assets, platform) {
  if (!Array.isArray(assets)) return null
  if (platform === 'win32') {
    return assets.find((a) => /-Setup\.exe$/i.test(a.name)) || null
  }
  if (platform === 'linux') {
    return assets.find((a) => /^doclite_\d+\.\d+\.\d+_amd64\.deb$/.test(a.name)) || null
  }
  return null // macOS 暂无发布
}

// ---------- net.request 封装：GET 小响应（带空闲超时，403/429 给专属文案） ----------
function requestUrl(url, headers = {}, { maxBytes = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const req = net.request(url)
    for (const [k, v] of Object.entries(headers)) req.setHeader(k, v)

    let idleTimer = setTimeout(() => req.destroy(new Error('网络超时')), IDLE_TIMEOUT)
    const armIdle = () => {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => req.destroy(new Error('网络超时')), IDLE_TIMEOUT)
    }

    const chunks = []
    let received = 0

    req.on('response', (res) => {
      res.on('data', (c) => {
        armIdle()
        received += c.length
        if (maxBytes > 0 && received > maxBytes) {
          req.destroy() // 关闭连接（promise 直接 reject，不依赖 error 事件）
          reject(new Error('响应超出预期大小'))
          return
        }
        chunks.push(c)
      })
      res.on('end', () => {
        clearTimeout(idleTimer)
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(Buffer.concat(chunks))
        } else if (res.statusCode === 403 || res.statusCode === 429) {
          reject(new Error('检查过于频繁，请稍后再试')) // M3：API 限额专属文案
        } else {
          reject(new Error(`GitHub 响应异常（HTTP ${res.statusCode}）`))
        }
      })
      res.on('error', (e) => { clearTimeout(idleTimer); reject(e) })
    })
    req.on('error', (e) => { clearTimeout(idleTimer); reject(e) })
    req.end()
  })
}

// ---------- 检查更新 ----------
async function check({ force = false } = {}) {
  // M3：手动检查也走缓存（TTL 内直接返回，避免触发 GitHub API 限额）
  if (!force && cachedState && Date.now() - cachedState.ts < CACHE_TTL) {
    return cachedState.result
  }

  const currentVersion = app.getVersion()
  const result = { ok: false, currentVersion, error: null, hasUpdate: false }

  try {
    const body = await requestUrl(API_URL, {
      'User-Agent': `DocLite/${currentVersion} (auto-updater)`,
      Accept: 'application/vnd.github+json',
    })
    const data = JSON.parse(body.toString('utf8'))
    if (!data || !data.tag_name) throw new Error('GitHub 返回数据异常')

    const latestVersion = String(data.tag_name).replace(/^v/i, '')
    const mainAsset = pickAsset(data.assets || [], process.platform)
    // L7：可选 sha256 校验资产（发布时附带 <资产名>.sha256 即启用，旧版本无则跳过）
    const shaAsset =
      mainAsset && (data.assets || []).find((a) => a.name === `${mainAsset.name}.sha256`)

    result.ok = true
    result.hasUpdate = compareVersions(latestVersion, currentVersion) > 0
    result.latestVersion = latestVersion
    result.publishedAt = data.published_at || ''
    result.releaseName = data.name || data.tag_name
    result.releaseNotes = data.body || ''
    result.platform = process.platform
    result.asset = mainAsset
      ? {
          name: mainAsset.name,
          size: mainAsset.size,
          url: mainAsset.browser_download_url,
          sha256Url: shaAsset ? shaAsset.browser_download_url : null,
        }
      : null

    cachedState = { ts: Date.now(), result }
  } catch (err) {
    console.error('[updater] 检查更新失败:', err.message)
    result.error = err.message || '获取失败'
  }

  return result
}

// ---------- 流式下载安装包（背压 + 空闲超时 + 大小上限 + 可选 sha256），进度经 updater:status 推送 ----------
async function download(assetOverride) {
  const state = cachedState && cachedState.result
  const asset = assetOverride || (state && state.asset) // assetOverride 仅供测试注入
  if (downloading) throw new Error('下载已在进行中') // 互斥：不推送 error（渲染层有防重入，双保险）
  if (!asset) throw new Error('未找到可用安装包，请先检查更新')

  downloading = true
  const send = (status) => {
    const win = currentWin()
    if (win && !win.isDestroyed()) win.webContents.send('updater:status', status)
  }

  const dir = path.join(app.getPath('downloads'), SUB_DIR)
  const target = path.join(dir, path.basename(asset.name)) // basename 防路径穿越

  try {
    await fs.promises.mkdir(dir, { recursive: true })

    // L4：下载前清理历史同类型安装包（保留本次）
    const pattern = process.platform === 'win32' ? /-Setup\.exe$/i : /^doclite_\d+\.\d+\.\d+_amd64\.deb$/
    const oldFiles = await fs.promises.readdir(dir).catch(() => [])
    await Promise.all(
      oldFiles
        .filter((f) => pattern.test(f) && f !== path.basename(asset.name))
        .map((f) => fs.promises.unlink(path.join(dir, f)).catch(() => {}))
    )

    // L7：可选 sha256 期望值（获取失败则跳过校验，与旧版本行为一致）
    let expectedSha = null
    if (asset.sha256Url) {
      try {
        const buf = await requestUrl(asset.sha256Url, {
          'User-Agent': `DocLite/${app.getVersion()} (auto-updater)`,
        }, { maxBytes: 4096 })
        const m = buf.toString('utf8').trim().split(/\s+/)[0].toLowerCase()
        if (/^[0-9a-f]{64}$/.test(m)) expectedSha = m
      } catch (e) {
        console.warn('[updater] sha256 资产获取失败，跳过哈希校验:', e.message)
      }
    }
    const hash = crypto.createHash('sha256')

    send({ type: 'downloading', received: 0, total: asset.size || 0 })

    let received = 0
    let lastSend = 0
    // M4：大小硬上限（期望大小 ×1.1，未告知大小时按 500MB 兜底），防无限写盘
    const sizeCap = Math.ceil((asset.size || 500 * 1024 * 1024) * SIZE_CAP_RATIO)

    await new Promise((resolve, reject) => {
      const req = net.request(asset.url)
      req.setHeader('User-Agent', `DocLite/${app.getVersion()} (auto-updater)`)

      let idleTimer = setTimeout(() => req.destroy(new Error('下载超时（30 秒无数据）')), IDLE_TIMEOUT)
      const armIdle = () => {
        clearTimeout(idleTimer)
        idleTimer = setTimeout(() => req.destroy(new Error('下载超时（30 秒无数据）')), IDLE_TIMEOUT)
      }

      req.on('response', (res) => {
        if (res.statusCode !== 200) {
          req.destroy()
          reject(new Error(`下载失败（HTTP ${res.statusCode}）`))
          return
        }
        // L3：响应头可能是 string[]，显式取首元素；M4：与预期大小严重不符时提前拒绝
        const cl = res.headers['content-length']
        const total = Number(Array.isArray(cl) ? cl[0] : cl) || asset.size || 0
        if (asset.size > 0 && total > 0 && Math.abs(total - asset.size) > asset.size * 0.1) {
          req.destroy()
          reject(new Error('服务器返回大小与预期不符'))
          return
        }
        const ws = fs.createWriteStream(target)

        res.on('data', (chunk) => {
          armIdle()
          received += chunk.length
          if (received > sizeCap) {
            req.destroy()
            reject(new Error('下载文件超出预期大小'))
            return
          }
          hash.update(chunk)
          // 背压：写缓冲区满时暂停网络流，防止大文件占满内存
          if (!ws.write(chunk)) {
            res.pause()
            ws.once('drain', () => res.resume())
          }
          const now = Date.now()
          if (now - lastSend > 200) {
            lastSend = now
            send({ type: 'downloading', received, total })
          }
        })

        res.on('end', () => {
          clearTimeout(idleTimer)
          ws.end((err) => {
            if (err) { reject(new Error('写入文件失败: ' + err.message)); return }
            // 大小完整性校验（仅当服务端告知了长度时）
            fs.promises.stat(target).then((s) => {
              if (total > 0 && s.size !== total) return reject(new Error('文件下载不完整，请重试'))
              if (expectedSha && hash.digest('hex') !== expectedSha) {
                return reject(new Error('文件校验失败（sha256 不匹配）'))
              }
              lastDownloaded = target // H1/M1：主进程记账，供 open-installer / copy-install-cmd 使用
              send({ type: 'downloaded', received, total, filePath: target })
              resolve(target)
            }).catch(reject)
          })
        })

        res.on('error', (e) => { clearTimeout(idleTimer); reject(e) })
        ws.on('error', (e) => { clearTimeout(idleTimer); reject(new Error('写入文件失败: ' + e.message)) })
      })

      req.on('error', (e) => { clearTimeout(idleTimer); reject(e) })
      req.end()
    })

    return target
  } catch (err) {
    fs.promises.unlink(target).catch(() => {}) // 失败时清理残留文件
    send({ type: 'error', message: err.message || '下载失败' })
    throw err
  } finally {
    downloading = false
  }
}

// ---------- 注册 IPC 与自动检查调度（app ready 后调用一次） ----------
function registerUpdater() {
  ipcMain.handle('updater:check', async () => {
    const r = await check() // M3：走 TTL 缓存，不强制请求
    const win = currentWin()
    if (win && !win.isDestroyed()) {
      win.webContents.send('updater:status', { type: 'check-result', ...r })
    }
    return r
  })

  ipcMain.handle('updater:download', async () => {
    try {
      const filePath = await download()
      return { ok: true, filePath }
    } catch (err) {
      return { ok: false, error: err.message }
    }
  })

  // M1：安装命令由主进程根据记账路径拼装，不接受渲染层参数
  ipcMain.handle('updater:copy-install-cmd', () => {
    if (!lastDownloaded || !fs.existsSync(lastDownloaded)) return false
    clipboard.writeText(`sudo dpkg -i "${lastDownloaded}"`)
    return true
  })

  // H1：只操作主进程记账路径，渲染层无法指定任意文件
  ipcMain.handle('updater:open-installer', async () => {
    if (!lastDownloaded || !fs.existsSync(lastDownloaded)) return false
    if (process.platform === 'linux') {
      shell.showItemInFolder(lastDownloaded)
      return true
    }
    await shell.openPath(lastDownloaded)
    return true
  })

  // 启动后延迟 3 秒静默检查（不打扰用户，仅在发现新版时推送提示）
  setTimeout(async () => {
    const r = await check({ force: true }) // 启动首次检查绕过空缓存
    const win = currentWin()
    if (r.ok && r.hasUpdate && win && !win.isDestroyed()) {
      win.webContents.send('updater:status', { type: 'available', ...r })
    }
  }, 3000)
}

module.exports = { registerUpdater, compareVersions, check, download, pickAsset }