// electron/updater.cjs
// 轻量自动升级模块：GitHub Releases 检查 + 流式下载 + 进度推送（零第三方依赖）
// 说明：使用经典 net.request 而非 net.fetch（实测部分网络环境 net.fetch 对 GitHub 返回 504）。
// 安全设计（按 workbuddy 审查 H1/M1 修复）：下载路径、安装命令、剪贴板写入全部由主进程记账
// （lastDownloaded），所有升级 IPC 不再接受渲染层传入的文件路径/命令文本。
const { app, net, ipcMain, clipboard, shell, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { execFile } = require('child_process')

const REPO = 'zhengyongz/doclite'
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`
const RELEASE_PAGE_URL = `https://github.com/${REPO}/releases/latest` // macOS 手动更新引导用
const SUB_DIR = 'DocLite' // 下载目录下的子目录名
const CACHE_TTL = 60_000 // 检查结果缓存时间（防高频重复请求 GitHub API）
const IDLE_TIMEOUT = 30_000 // 网络空闲超时（30 秒无数据即算失败，非总时长限制）
const SIZE_CAP_RATIO = 1.1 // 下载大小硬上限系数 = 期望大小 × 该值

// ---------- 镜像加速配置 ----------
// 实测（2026-07，大陆网络）：官方直连约 200KB/s（87MB 需约 13 分钟）；镜像 ghfast.top 约 1.2MB/s、
// gh-proxy.com 约 526KB/s、ghproxy.net 约 325KB/s；ghproxy 类服务格式为「前缀 + 官方完整 URL」。
// 镜像下载产物已用官方发布 sha256 逐一核对一致（无篡改）。策略：官方直连优先，启动期速度过慢或
// 下载失败时自动降级切换下一个镜像；全部失败则汇总各源原因。
const DOWNLOAD_SOURCES = [
  { name: '官方直连', prefix: '' },
  { name: '镜像 ghfast.top', prefix: 'https://ghfast.top/' },
  { name: '镜像 gh-proxy.com', prefix: 'https://gh-proxy.com/' },
  { name: '镜像 ghproxy.net', prefix: 'https://ghproxy.net/' },
]
const SLOW_WINDOW_MS = 10_000 // 启动期速度检测窗口（收到首个数据块后计时）
const SLOW_MIN_BYTES = 2 * 1024 * 1024 // 窗口内累计接收不足 2MB（约 200KB/s）判定当前源过慢

// ---------- 生成候选下载源（官方直连 + 镜像），供 download 轮询 ----------
function buildCandidateSources(assetUrl) {
  return DOWNLOAD_SOURCES.map((s) => ({ name: s.name, url: s.prefix + assetUrl }))
}

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
  // macOS（v0.6.0+）：一期仅手动更新——无 Developer ID 签名时 electron-updater 的 zip 替换
  // 会被 Gatekeeper 阻止，自动更新必失败；识别 zip 资产仅用于弹窗展示版本信息，引导手动下载 DMG。
  // 命名注意（electron-builder 历史怪癖）：arm64 zip 为「*-arm64-mac.zip」，x64 zip 不带 arch
  // 后缀、直接为「*-mac.zip」——务必先排除 arm64 再匹配 x64。
  if (platform === 'darwin') {
    return assets.find((a) => /^DocLite-.*-arm64-mac\.zip$/.test(a.name))
      || assets.find((a) => /^DocLite-.*-mac\.zip$/.test(a.name) && !/-arm64/.test(a.name))
      || null
  }
  return null // 其他平台暂无发布
}

// ---------- 补充：下载器主入口优先尝试差量引擎（见函数内注释） ----------

// ---------- net.request 封装：GET 小响应（带空闲超时，403/429 给专属文案） ----------
function requestUrl(url, headers = {}, { maxBytes = 0 } = {}) {
  return new Promise((resolve, reject) => {
    const req = net.request(url)
    for (const [k, v] of Object.entries(headers)) req.setHeader(k, v)

    // 注意：实测 req.destroy() 后 error 事件可能不触发（GitHub 资产偶发无响应），
    // 因此超时必须在定时器内直接 reject，不能依赖 error 事件结算 promise。
    let idleTimer = setTimeout(() => {
      req.destroy()
      reject(new Error('网络超时'))
    }, IDLE_TIMEOUT)
    const armIdle = () => {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        req.destroy()
        reject(new Error('网络超时'))
      }, IDLE_TIMEOUT)
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
  // releasePageUrl 统一由主进程下发（workbuddy L1：渲染层不再硬编码第二份仓库地址）
  const result = { ok: false, currentVersion, error: null, hasUpdate: false, releasePageUrl: RELEASE_PAGE_URL }

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
    // 全部资产清单（转换组件安装器用：定位 DocLite-converters-<版本>.zip 及其 .sha256）
    result.releaseAssets = (data.assets || []).map((a) => ({
      name: a.name,
      size: a.size,
      url: a.browser_download_url,
    }))
    result.asset = mainAsset
      ? {
          name: mainAsset.name,
          size: mainAsset.size,
          url: mainAsset.browser_download_url,
          sha256Url: shaAsset ? shaAsset.browser_download_url : null,
        }
      : null

    // v0.6.0+ macOS：一期不做自动更新（无 Developer ID 签名，zip 替换必被 Gatekeeper 阻止）。
    // 只下发 manualDownload 标记：弹窗的手动更新文案/「前往下载」按钮由渲染层按 i18n 组装
    // （workbuddy M4：不再往 releaseNotes 尾部拼中文说明，避免英文界面混入整段中文）
    if (process.platform === 'darwin' && result.hasUpdate) {
      result.manualDownload = true
    }

    cachedState = { ts: Date.now(), result }
  } catch (err) {
    console.error('[updater] 检查更新失败:', err.message)
    result.error = err.message || '获取失败'
  }

  return result
}

// ---------- 单源下载（分块 + 背压 + 空闲超时 + 慢速检测 + 大小上限），返回 { received, total } ----------
// 慢速检测：收到首个数据块后 10s 内累计 < 2MB 视为过慢并中断，由外层轮询切换下一个源。
function downloadFromUrl(source, target, { size, sizeCap, hash, onProgress }) {
  return new Promise((resolve, reject) => {
    const req = net.request(source.url)
    req.setHeader('User-Agent', `DocLite/${app.getVersion()} (auto-updater)`)

    let received = 0
    let idleTimer = setTimeout(() => {
      req.destroy()
      reject(new Error('下载超时（30 秒无数据）'))
    }, IDLE_TIMEOUT)
    const armIdle = () => {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        req.destroy()
        reject(new Error('下载超时（30 秒无数据）'))
      }, IDLE_TIMEOUT)
    }
    let slowTimer = null
    const armSlow = () => {
      if (slowTimer) return
      slowTimer = setTimeout(() => {
        if (received < SLOW_MIN_BYTES) {
          req.destroy()
          reject(new Error(`当前源速度过慢（${(received / 1024 / 1024).toFixed(1)}MB/${SLOW_WINDOW_MS / 1000}s）`))
        }
      }, SLOW_WINDOW_MS)
    }
    const clearTimers = () => {
      clearTimeout(idleTimer)
      if (slowTimer) clearTimeout(slowTimer)
    }

    req.on('response', (res) => {
      if (res.statusCode !== 200) {
        req.destroy()
        reject(new Error(`下载失败（HTTP ${res.statusCode}）`))
        return
      }
      // L3：响应头可能是 <string[]>，显式取首元素；M4：与预期大小严重不符时提前拒绝
      const cl = res.headers['content-length']
      const total = Number(Array.isArray(cl) ? cl[0] : cl) || size || 0
      if (size > 0 && total > 0 && Math.abs(total - size) > size * 0.1) {
        req.destroy()
        reject(new Error('服务器返回大小与预期不符'))
        return
      }
      const ws = fs.createWriteStream(target)

      res.on('data', (chunk) => {
        armIdle()
        armSlow()
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
        onProgress(received, total)
      })

      res.on('end', () => {
        clearTimers()
        ws.end((err) => {
          if (err) { reject(new Error('写入文件失败: ' + err.message)); return }
          resolve({ received, total })
        })
      })

      res.on('error', (e) => { clearTimers(); reject(e) })
      ws.on('error', (e) => { clearTimers(); reject(new Error('写入文件失败: ' + e.message)) })
    })

    req.on('error', (e) => { clearTimers(); reject(e) })
    req.end()
  })
}

// ---------- 差量下载引擎（v0.5.2+，Windows） ----------
// 基于 electron-updater + electron-builder 构建期生成的 Setup.exe.blockmap 分块对比：
//   ① 下载新版 blockmap（约 100KB）
//   ② 与本地缓存的上一次下载产物（cacheDir/installer.exe + cacheDir/current.blockmap）分块对比
//   ③ 仅对变化块发 HTTP Range 请求，拼回完整安装包（拼装后 sha512 全文校验）
// 阅读 electron-updater 6.8.x 源码得出的关键实现细节：
//   · 差量对照的旧文件固定读 cacheDir/installer.exe，而下载产物按原始文件名存 pending/ 且
//     换代时会被清空——库自身从不写 installer.exe，需在每次下载成功后主动“播种”（复制一份）。
//   · 旧 blockmap 优先读本地缓存 cacheDir/current.blockmap（每次下载成功后自动提升），
//     与播种文件天然同版本；feed 用 GitHub stable 地址时服务端旧 blockmap 会 404，但无需依赖。
//   · generic provider 默认尝试 multipart/byteranges 多段请求，GitHub/镜像多不支持，
//     显式 useMultipleRangeRequest:false 改走逐块单 Range，兼容性最好。
//   · 任一环节失败（无播种文件/镜像不支持 Range/块校验失败）库内部自动回退全量，不会中断升级。
//   · 安全：拼装结果经 latest.yml 的 sha512 全文校验，等效全量+哈希校验；另将 latest.yml 的
//     size 与 GitHub API 资产清单交叉核对，防镜像同时算改安装包与元数据。
const STABLE_DOWNLOAD_BASE = `https://github.com/${REPO}/releases/latest/download/`

// 生成 feed 候选源（与 DOWNLOAD_SOURCES 同序：官方直连 + 镜像；镜像支持 Range 时同样可差量）
function buildFeedSources() {
  return DOWNLOAD_SOURCES.map((s) => ({ name: s.name, url: s.prefix + STABLE_DOWNLOAD_BASE }))
}

function createDiffLogger() {
  const tag = '[electron-updater]'
  return {
    info: (m) => { if (process.env.DOCLITE_UPDATER_VERBOSE === '1') console.log(tag, m) },
    warn: (m) => console.warn(tag, m),
    error: (m) => console.error(tag, m),
    debug: () => {},
  }
}

// 播种差量基准：把下载产物复制为 cacheDir/installer.exe，供下次差量对照
async function seedDiffBaseFile(updater, downloadedFile) {
  try {
    const helper = updater.downloadedUpdateHelper
    if (!helper || !helper.cacheDir) return
    await fs.promises.mkdir(helper.cacheDir, { recursive: true })
    await fs.promises.copyFile(downloadedFile, path.join(helper.cacheDir, 'installer.exe'))
  } catch (e) {
    console.warn('[updater] 差量基准播种失败（下次将回退全量）:', e.message)
  }
}

// 差量下载：逐源（官方 + 镜像）尝试 electron-updater（generic feed，单 Range）。
// feedSources 可选注入（本地集成测试用）；缺省用 buildFeedSources()。
// 返回 { filePath, source, mode: 'differential'|'full', received, total }；全部失败抛错，由调用方回退传统全量。
async function downloadDifferential({ onProgress, onSource, feedSources } = {}) {
  const { NsisUpdater } = require('electron-updater') // 懒加载：非差量路径不引入第三方依赖
  const state = cachedState && cachedState.result
  const apiAssetSize = state && state.asset ? state.asset.size : 0 // GitHub API 交叉核对基准
  const sources = feedSources || buildFeedSources()
  const failures = []

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i]
    const note = i > 0 ? `已自动切换（上一源：${sources[i - 1].name}）` : undefined
    if (onSource) onSource(source.name, note)

    const u = new NsisUpdater()
    u.logger = createDiffLogger()
    u.autoDownload = false
    u.autoInstallOnAppQuit = false // 保持“用户手动运行安装向导”的既有交互，不静默安装
    // 未打包环境（electron:dev/本地测试宿主）下 electron-updater 默认整体停用，强制启用便于调试
    if (!app.isPackaged) u.forceDevUpdateConfig = true

    let progressMax = { received: 0, total: 0 }
    try {
      u.setFeedURL({ provider: 'generic', url: source.url, useMultipleRangeRequest: false })
      u.on('download-progress', (p) => {
        progressMax = { received: p.transferred, total: p.total }
        if (onProgress) onProgress(p.transferred, p.total, source.name, note)
      })

      const checkResult = await u.checkForUpdates() // 仅拉取 latest.yml（小文件）
      const info = checkResult && checkResult.updateInfo
      if (!info || !info.version) throw new Error('feed 无版本信息')
      if (compareVersions(info.version, app.getVersion()) <= 0) {
        throw new Error(`feed 版本不高于当前（${info.version}）`)
      }
      // 安装包期望大小：兼容 electron-builder 新旧 latest.yml 格式（新格式 size 在 files[0]）
      const expectedSize =
        (Array.isArray(info.files) && info.files[0] && info.files[0].size) || info.size || 0
      // 防篡改交叉核对：latest.yml 的 size 应与 GitHub API 资产清单一致（不一致视为该源不可信）
      if (apiAssetSize > 0 && expectedSize > 0 && Math.abs(expectedSize - apiAssetSize) > apiAssetSize * 0.1) {
        throw new Error(`feed 大小与官方清单不符（${expectedSize} vs ${apiAssetSize}）`)
      }

      const result = await u.downloadUpdate() // 内部自动：差量失败→全量；成功后 sha512 已校验
      const filePath = Array.isArray(result) ? result[0] : result
      if (!filePath || !fs.existsSync(filePath)) throw new Error('下载产物缺失')

      await seedDiffBaseFile(u, filePath) // 为下次差量播种

      // 全量/差量判定：差量进度总字节远小于安装包体积；命中缓存直取时进度为空，标为全量完成
      let mode = 'full'
      if (progressMax.total > 0 && expectedSize > 0 && progressMax.total < expectedSize * 0.5) mode = 'differential'
      const received = progressMax.total > 0 ? progressMax.received : expectedSize
      const total = progressMax.total > 0 ? progressMax.total : expectedSize

      u.removeAllListeners()
      return { filePath, source: source.name, mode, received, total }
    } catch (err) {
      u.removeAllListeners()
      failures.push(`${source.name}：${err.message}`)
      console.warn(`[updater] 差量源失败（${source.name}）:`, err.message)
    }
  }
  throw new Error(`差量引擎全部源失败：${failures.map((f) => `\n· ${f}`).join('')}`)
}

// ---------- 流式下载安装包（镜像源轮询 + sha256 校验），进度经 updater:status 推送 ----------
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
  let lastSend = 0 // 进度事件节流（差量与传统全量两路径共用）

  // v0.6.0+ macOS：不进入下载流程——无 Developer ID 签名时 zip 替换必被 Gatekeeper 阻止，
  // 自动更新必失败。此处打开 Release 页引导手动下载 DMG，友好文案经 IPC error 返回（渲染层展示）。
  if (process.platform === 'darwin' && !assetOverride) {
    try { await shell.openExternal(RELEASE_PAGE_URL) } catch { /* 浏览器打开失败不影响提示 */ }
    downloading = false
    throw new Error('macOS 暂不支持自动更新：已打开下载页面，请手动下载 DMG 安装（Apple Silicon 选 -arm64，Intel 选 -x64）')
  }

  const dir = path.join(app.getPath('downloads'), SUB_DIR)
  const target = path.join(dir, path.basename(asset.name)) // basename 防路径穿越

  try {
    // v0.5.2+ Windows：优先差量引擎（electron-updater，分块对比只传变化部分，逐源尝试），
    // 差量条件不满足时其内部自动全量；引擎整体失败时回退下方传统镜像全量下载。
    // assetOverride 仅供测试注入，绕过差量。
    if (process.platform === 'win32' && !assetOverride) {
      try {
        const r = await downloadDifferential({
          onSource: (sourceName, note) => {
            send({ type: 'downloading', received: 0, total: 0, source: sourceName, note })
          },
          onProgress: (received, total, sourceName, note) => {
            const now = Date.now()
            if (now - lastSend > 200) {
              lastSend = now
              send({ type: 'downloading', received, total, source: sourceName, note })
            }
          },
        })
        const label = r.mode === 'differential' ? `${r.source}·差量` : r.source
        const note = r.mode === 'differential' ? '差量更新：仅下载与上一版不同的部分' : undefined
        lastDownloaded = r.filePath // H1/M1：主进程记账，供 open-installer 使用
        send({ type: 'downloaded', received: r.received, total: r.total, filePath: r.filePath, source: label, note })
        return r.filePath
      } catch (err) {
        console.warn('[updater] 差量引擎不可用，回退传统镜像全量下载:', err.message)
      }
    }

    await fs.promises.mkdir(dir, { recursive: true })

    // L4：下载前清理历史同类型安装包（保留本次）
    const pattern = process.platform === 'win32' ? /-Setup\.exe$/i : /^doclite_\d+\.\d+\.\d+_amd64\.deb$/
    const oldFiles = await fs.promises.readdir(dir).catch(() => [])
    await Promise.all(
      oldFiles
        .filter((f) => pattern.test(f) && f !== path.basename(asset.name))
        .map((f) => fs.promises.unlink(path.join(dir, f)).catch(() => {}))
    )

    // L7：可选 sha256 期望值（镜像可能被篡改，取到即全源共用；获取失败则跳过校验，与旧版本行为一致）
    let expectedSha = null
    if (asset.sha256Url) {
      for (const s of buildCandidateSources(asset.sha256Url)) {
        try {
          const buf = await requestUrl(s.url, {
            'User-Agent': `DocLite/${app.getVersion()} (auto-updater)`,
          }, { maxBytes: 4096 })
          const m = buf.toString('utf8').trim().split(/\s+/)[0].toLowerCase()
          if (/^[0-9a-f]{64}$/.test(m)) { expectedSha = m; break }
        } catch (e) {
          console.warn(`[updater] sha256 资产获取失败（${s.name}）:`, e.message)
        }
      }
    }

    // M4：大小硬上限（期望大小 × 1.1，未告知大小时按 500MB 兜底），防无限写盘
    const sizeCap = Math.ceil((asset.size || 500 * 1024 * 1024) * SIZE_CAP_RATIO)
    const sources = buildCandidateSources(asset.url)
    const failures = []

    for (let i = 0; i < sources.length; i++) {
      const source = sources[i]
      const hash = crypto.createHash('sha256') // 每个源独立哈希（切换后不混算）
      let received = 0
      const note = i > 0 ? `已自动切换（上一源：${sources[i - 1].name}）` : undefined
      send({ type: 'downloading', received: 0, total: asset.size || 0, source: source.name, note })

      try {
        const result = await downloadFromUrl(source, target, {
          size: asset.size,
          sizeCap,
          hash,
          onProgress: (r, t) => {
            received = r
            const now = Date.now()
            if (now - lastSend > 200) {
              lastSend = now
              send({ type: 'downloading', received: r, total: t, source: source.name, note })
            }
          },
        })
        received = result.received
        // 大小完整性 + sha256 校验（校验失败视为该源失败，切换下一源重试）
        const stat = await fs.promises.stat(target)
        if (result.total > 0 && stat.size !== result.total) throw new Error('文件下载不完整，请重试')
        if (expectedSha && hash.digest('hex') !== expectedSha) {
          throw new Error('文件校验失败（sha256 不匹配，疑似镜像被篡改）')
        }
        lastDownloaded = target // H1/M1：主进程记账，供 open-installer / copy-install-cmd 使用
        send({ type: 'downloaded', received, total: result.total, filePath: target, source: source.name })
        return target
      } catch (err) {
        await fs.promises.unlink(target).catch(() => {}) // 该源失败，清理残留再试下一源
        failures.push(`${source.name}：${err.message}`)
        console.warn(`[updater] 下载源失败（${source.name}）:`, err.message)
      }
    }

    throw new Error(`所有下载源均失败：${failures.map((f) => `\n· ${f}`).join('')}`)
  } catch (err) {
    fs.promises.unlink(target).catch(() => {}) // 全部失败时清理残留文件
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

  // 一键安装（Linux）：pkexec 提权执行 dpkg，系统弹出原生图形密码框，全程无需终端
  // 安全：仅安装主进程记账的 lastDownloaded，路径不跨信任边界；pkexec 由 PolicyKit 管理授权
  ipcMain.handle('updater:install', () => {
    if (process.platform !== 'linux') {
      return Promise.resolve({ ok: false, error: '当前平台不支持一键安装' })
    }
    if (!lastDownloaded || !fs.existsSync(lastDownloaded)) {
      return Promise.resolve({ ok: false, error: '未找到已下载的安装包，请先下载更新' })
    }
    return new Promise((resolve) => {
      execFile('pkexec', ['dpkg', '-i', lastDownloaded], (err, _stdout, stderr) => {
        if (!err) { resolve({ ok: true }); return }
        if (err.code === 'ENOENT') {
          resolve({ ok: false, error: '系统缺少 pkexec（PolicyKit），请改用下方命令手动安装' })
        } else if (err.code === 126 || err.code === 127) {
          // 126：用户取消密码框或未授权；127：pkexec 内找不到命令
          resolve({ ok: false, cancelled: true, error: err.code === 127 ? '无法调用 dpkg，请改用下方命令手动安装' : '已取消安装' })
        } else {
          const detail = String(stderr || '')
            .split('\n').filter(Boolean).slice(-2).join(' ') || `退出码 ${err.code}`
          resolve({ ok: false, error: '安装失败：' + detail })
        }
      })
    })
  })

  // 安装成功后重启应用加载新版本
  ipcMain.handle('updater:relaunch', () => {
    app.relaunch()
    app.exit(0)
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

module.exports = { registerUpdater, compareVersions, check, download, pickAsset, buildCandidateSources, buildFeedSources, downloadDifferential, seedDiffBaseFile, DOWNLOAD_SOURCES, downloadFromUrl, requestUrl }