// electron/converters-component.cjs
// 可选"文件转换组件"管理：主包只含浏览功能，转换库（jspdf/html2canvas/xlsx/docx/mobi 等）
// 打包为独立组件（IIFE 单文件 converters.js），三种来源（版本高者优先）：
//   1) dev：项目 dist/converters（vite.config.converters.js 产物）
//   2) 系统级：<resourcesPath>/converters（Linux 组件 deb / NSIS 管理员安装）
//   3) 用户级：<userData>/converters（应用内 zip 安装，免提权，支持一键卸载）
// 应用内安装流程：检查更新资产 → 镜像轮询下载 zip → sha256 校验 → 推给渲染层 fflate 解压
// → 写入用户级目录 → 推送状态变更。安全：解压文件路径防穿越 + 单文件/总体积上限 + 原子替换。
const { app, ipcMain, BrowserWindow, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const { pathToFileURL } = require('url')
const { createHash } = require('crypto')
const {
  buildCandidateSources, downloadFromUrl, requestUrl, check: checkUpdate, compareVersions,
} = require('./updater.cjs')

const MANIFEST = 'manifest.json'
const COMPONENT_SCRIPT = 'converters.js'
const ZIP_NAME_RE = /^DocLite-converters-(\d+\.\d+\.\d+(?:-[\w.]+)?)\.zip$/
const MAX_FILE_BYTES = 20 * 1024 * 1024 // 单文件上限（组件主体约 2.2MB）
const MAX_TOTAL_BYTES = 60 * 1024 * 1024 // 解压总体积上限
const INSTALL_TIMEOUT = 90_000 // 等渲染层解压回传的总时限

let installSession = null // { resolve, timer }：等待渲染层回传解压结果

// ---------- 组件目录候选 ----------
function componentDirs() {
  const dirs = []
  if (!app.isPackaged) {
    dirs.push({ label: 'dev', dir: path.join(__dirname, '..', 'dist', 'converters') }) // 源码运行
  }
  dirs.push({ label: 'system', dir: path.join(process.resourcesPath, 'converters') }) // 组件 deb / NSIS
  dirs.push({ label: 'user', dir: path.join(app.getPath('userData'), 'converters') }) // 应用内安装
  return dirs
}

// ---------- 读某目录的组件信息（无 → null） ----------
async function readComponentInfo({ label, dir }) {
  try {
    const script = path.join(dir, COMPONENT_SCRIPT)
    await fs.promises.access(script, fs.constants.R_OK)
    let version = '0.0.0'
    try {
      const m = JSON.parse(await fs.promises.readFile(path.join(dir, MANIFEST), 'utf8'))
      if (m && typeof m.version === 'string' && ZIP_NAME_RE.test(`DocLite-converters-${m.version}.zip`)) {
        version = m.version
      }
    } catch {
      if (!app.isPackaged) {
        try {
          const pkg = JSON.parse(await fs.promises.readFile(path.join(__dirname, '..', 'package.json'), 'utf8'))
          version = pkg.version
        } catch { /* 保持默认 */ }
      }
    }
    return { label, dir, version, scriptUrl: pathToFileURL(script).href }
  } catch {
    return null
  }
}

// ---------- 组件状态：存在的来源中取版本最高者；同版本按候选顺序（dev/system 优先） ----------
async function getConvertersStatus() {
  const found = []
  for (const cand of componentDirs()) {
    const info = await readComponentInfo(cand)
    if (info) found.push(info)
  }
  if (found.length === 0) {
    return { installed: false, version: null, source: null, scriptUrl: null }
  }
  found.sort((a, b) => {
    const c = compareVersions(b.version, a.version)
    if (c !== 0) return c
    return componentDirs().findIndex((d) => d.label === a.label) - componentDirs().findIndex((d) => d.label === b.label)
  })
  const best = found[0]
  return { installed: true, version: best.version, source: best.label, scriptUrl: best.scriptUrl }
}

// ---------- 写解压后的文件（防路径穿越 + 体积上限 + 原子替换，返回写入数） ----------
async function writeComponentFiles(files, destDir) {
  const names = Object.keys(files || {})
  if (names.length === 0) throw new Error('组件包内容为空')

  const tmpDir = destDir + '.installing'
  const tmpResolved = path.resolve(tmpDir)
  let total = 0
  const plan = []
  for (const name of names) {
    const clean = String(name).replace(/\\/g, '/').replace(/^\/+/, '')
    if (!clean || clean.includes('..') || path.isAbsolute(clean)) {
      throw new Error(`组件包含非法路径：${name}`)
    }
    const target = path.join(tmpDir, clean)
    if (!path.resolve(target).startsWith(tmpResolved + path.sep)) {
      throw new Error(`组件路径越界：${name}`)
    }
    const data = files[name]
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
    if (bytes.length > MAX_FILE_BYTES) throw new Error(`组件文件过大：${name}`)
    total += bytes.length
    plan.push({ target, bytes })
  }
  if (total > MAX_TOTAL_BYTES) throw new Error('组件总体积超出上限')

  // 先全部写临时目录，成功后原子替换（避免写一半失败留下损坏组件）
  await fs.promises.rm(tmpDir, { recursive: true, force: true })
  await fs.promises.mkdir(tmpDir, { recursive: true })
  for (const { target, bytes } of plan) {
    await fs.promises.mkdir(path.dirname(target), { recursive: true })
    await fs.promises.writeFile(target, bytes)
  }
  await fs.promises.rm(destDir, { recursive: true, force: true })
  await fs.promises.rename(tmpDir, destDir)
  return plan.length
}

// ---------- 从 Release 资产中定位组件 zip + sha256 期望值 ----------
async function locateComponentAsset() {
  const upd = await checkUpdate({ force: true })
  if (!upd.ok) throw new Error(upd.error || '未获取到更新信息，请稍后再试')
  const assets = upd.releaseAssets || []
  const zips = assets
    .map((a) => ({ asset: a, m: ZIP_NAME_RE.exec(a.name) }))
    .filter((x) => x.m)
    .sort((x, y) => compareVersions(y.m[1], x.m[1])) // 取最新
  if (zips.length === 0) throw new Error('当前 Release 未提供转换组件包')
  const zip = { name: zips[0].asset.name, version: zips[0].m[1], size: zips[0].asset.size, url: zips[0].asset.url }

  // 期望 sha256：配套 .sha256 资产（发布流程生成），拿不到则跳过校验（与主程序升级策略一致）
  const shaAsset = assets.find((a) => a.name === `${zip.name}.sha256`)
  if (shaAsset) {
    for (const s of buildCandidateSources(shaAsset.url)) {
      try {
        const buf = await requestUrl(s.url, { 'User-Agent': `DocLite/${app.getVersion()} (component-installer)` }, { maxBytes: 4096 })
        const h = buf.toString('utf8').trim().split(/\s+/)[0].toLowerCase()
        if (/^[0-9a-f]{64}$/.test(h)) { zip.sha256 = h; break }
      } catch { /* 试下一源 */ }
    }
  }
  return zip
}

// ---------- 应用内安装：下载 zip → 渲染层解压 → 写入用户级目录 ----------
function installConverters(onProgress) {
  return new Promise(async (resolve) => {
    const finish = (r) => {
      if (installSession) {
        clearTimeout(installSession.timer)
        installSession = null
      }
      resolve(r)
    }
    try {
      // 1) 定位资产（含 sha256 期望值）
      const zip = await locateComponentAsset()

      // 2) 镜像轮询下载到临时文件（复用升级器下载基建）
      const tmpZip = path.join(app.getPath('userData'), 'converters-download.zip')
      const sources = buildCandidateSources(zip.url)
      const failures = []
      let downloadedOk = false
      for (let i = 0; i < sources.length; i++) {
        const source = sources[i]
        const hash = createHash('sha256')
        try {
          const st = await downloadFromUrl(source, tmpZip, {
            size: zip.size,
            sizeCap: Math.ceil((zip.size || 50 * 1024 * 1024) * 1.1),
            hash,
            onProgress: (r, t) => onProgress && onProgress(r, t, source.name),
          })
          if (zip.sha256 && hash.digest('hex') !== zip.sha256) {
            throw new Error('组件包校验失败（sha256 不匹配）')
          }
          if (st.total > 0 && st.received !== st.total) throw new Error('组件包下载不完整')
          downloadedOk = true
          break
        } catch (e) {
          await fs.promises.unlink(tmpZip).catch(() => {})
          failures.push(`${source.name}：${e.message}`)
        }
      }
      if (!downloadedOk) throw new Error(`组件包下载失败：${failures.join('；')}`)

      // 3) 读 zip → 推给渲染层解压（fflate 在主 bundle；主进程刻意不依赖任何 npm 包）
      const buf = await fs.promises.readFile(tmpZip)
      await fs.promises.unlink(tmpZip).catch(() => {})
      const win = BrowserWindow.getAllWindows()[0]
      if (!win || win.isDestroyed()) throw new Error('窗口不可用')

      installSession = {
        resolve: finish,
        timer: setTimeout(() => {
          installSession = null
          finish({ ok: false, error: '组件安装超时，请重试' })
        }, INSTALL_TIMEOUT),
      }
      win.webContents.send('converters:unzip-request',
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), zip)
      // finish 由 'converters:unzip-result' IPC 完成
    } catch (e) {
      finish({ ok: false, error: e.message || '安装失败' })
    }
  })
}

// ---------- 注册 IPC ----------
function registerConvertersComponent() {
  ipcMain.handle('converters:get-status', () => getConvertersStatus())

  // 渲染层解压结果回传（fflate unzipSync 输出 { 相对路径: Uint8Array }）
  ipcMain.handle('converters:unzip-result', async (_e, files, versionTag) => {
    const session = installSession
    if (!session) return { ok: false, error: '无进行中的组件安装' }
    installSession = null
    clearTimeout(session.timer)
    try {
      const destDir = componentDirs().find((d) => d.label === 'user').dir
      const count = await writeComponentFiles(files, destDir)
      if (versionTag && versionTag.version) {
        // 写 manifest（记录组件版本，状态检测用）
        const manifest = { name: 'doclite-converters', version: versionTag.version, files: count }
        await fs.promises.writeFile(path.join(destDir, MANIFEST), JSON.stringify(manifest, null, 2))
      }
      const status = await getConvertersStatus()
      session.resolve({ ok: true, version: status.version, status })
    } catch (e) {
      session.resolve({ ok: false, error: e.message })
    }
    return { ok: true }
  })

  ipcMain.handle('converters:install', () => installConverters())

  // 卸载（仅用户级；系统级由系统包管理器移除）
  ipcMain.handle('converters:uninstall', async () => {
    const userDir = componentDirs().find((d) => d.label === 'user').dir
    try {
      await fs.promises.rm(userDir, { recursive: true, force: true })
      const status = await getConvertersStatus()
      return { ok: true, status }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })
}

module.exports = { registerConvertersComponent, getConvertersStatus }
