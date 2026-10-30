// electron/converters-component.cjs
// 可选"文件转换组件"管理：主包只含浏览功能，转换库（jspdf/html2canvas/xlsx/docx/mobi 等）
// 打包为独立组件（IIFE 单文件 converters.js），三种来源（版本高者优先）：
//   1) dev：项目 dist/converters（vite.config.converters.js 产物）
//   2) 系统级：<resourcesPath>/converters（Linux 组件 deb / NSIS 管理员安装）
//   3) 用户级：<userData>/converters（应用内 zip 安装，免提权，支持一键卸载）
//
// 应用内安装（v0.5.1 起全程主进程，不再信任渲染层回传）：
//   定位资产（版本 <= 当前主程序）→ 镜像轮询下载 zip → sha256 强制校验（缺失即中止）
//   → 主进程内置最小 zip 解包（Node zlib，白名单 + 体积上限 + inflate 输出上限 + CRC32）
//   → manifest 校验（version 格式 / minAppVersion / converters.js 哈希）→ 原子写盘。
// 安全要点（workbuddy 审查 H1/M1/M2/M3/M4 修复）：
//   - 白名单文件（converters.js/manifest.json/assets/**），杜绝任意文件写入
//   - 解压输出用 maxOutputLength 限制（防 zip 炸弹）、CRC32 校验（防损坏/篡改）
//   - 无渲染层回传路径：IPC 仅返回结果，攻击面收敛到主进程
const { app, ipcMain, BrowserWindow, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const zlib = require('zlib')
const { pathToFileURL } = require('url')
const { createHash } = require('crypto')
const {
  buildCandidateSources, downloadFromUrl, requestUrl, check: checkUpdate, compareVersions,
} = require('./updater.cjs')

const MANIFEST = 'manifest.json'
const COMPONENT_SCRIPT = 'converters.js'
const ZIP_NAME_RE = /^DocLite-converters-(\d+\.\d+\.\d+(?:-[\w.]+)?)\.zip$/
const MAX_FILE_BYTES = 20 * 1024 * 1024 // 单文件解压上限（组件主体约 2.2MB）
const MAX_TOTAL_BYTES = 60 * 1024 * 1024 // 解压总体积上限
const MAX_ENTRIES = 50 // zip 条目数上限
const ALLOWED_FILES = new Set([COMPONENT_SCRIPT, MANIFEST])
const ALLOWED_DIR_PREFIXES = ['assets/']
const INSTALL_DOWNLOAD_MAX = 100 * 1024 * 1024 // 组件包下载体积硬上限

let installing = false // M1：模块级并发互斥

// ---------- CRC32（zip 完整性校验，自带查表实现，避免第三方依赖） ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// ---------- 组件文件名白名单（H1：拒绝任意文件写入） ----------
function isAllowedName(name) {
  const clean = String(name).replace(/\\/g, '/')
  if (!clean || clean.includes('..') || clean.startsWith('/') || /^[a-zA-Z]:/.test(clean)) return false
  if (ALLOWED_FILES.has(clean)) return true
  return ALLOWED_DIR_PREFIXES.some((p) => clean.startsWith(p) && clean.length > p.length && !clean.endsWith('/'))
}

// ---------- 最小 zip 解包（仅支持 store/deflate，self-produced zip 约定；防御性校验） ----------
// 返回 { [相对路径]: Buffer }；任何异常一律中止安装。
function unzipComponent(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error('组件包格式无效')
  const sigEocd = 0x06054b50
  let eocd = -1
  const searchStart = Math.max(0, buf.length - 65557) // EOCD 最多带 64K 注释
  for (let i = buf.length - 22; i >= searchStart; i--) {
    if (buf.readUInt32LE(i) === sigEocd) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('组件包格式无效（无法定位中央目录）')

  const count = buf.readUInt16LE(eocd + 10)
  const cdSize = buf.readUInt32LE(eocd + 12)
  const cdOffset = buf.readUInt32LE(eocd + 16)
  if (count === 0) throw new Error('组件包内容为空')
  if (count > MAX_ENTRIES) throw new Error('组件包条目数超出上限')
  if (cdOffset + cdSize > buf.length || cdOffset < 22) throw new Error('组件包中央目录越界')

  const files = {}
  let total = 0
  let p = cdOffset
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('组件包中央目录损坏')
    const method = buf.readUInt16LE(p + 10)
    const crc = buf.readUInt32LE(p + 16)
    const compSize = buf.readUInt32LE(p + 20)
    const uncompSize = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    if (p + 46 + nameLen > buf.length) throw new Error('组件包文件名字段越界')
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    p += 46 + nameLen + extraLen + commentLen

    // H1：白名单（目录条目 0 长度且以 / 结尾的直接忽略）
    if (name.endsWith('/')) { continue }
    if (!isAllowedName(name)) throw new Error(`组件包含不允许的文件：${name}`)
    if (uncompSize > MAX_FILE_BYTES) throw new Error(`组件文件过大：${name}`)
    total += uncompSize
    if (total > MAX_TOTAL_BYTES) throw new Error('组件解压总体积超出上限')

    // 本地文件头定位数据区
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error('组件包本地文件头损坏')
    }
    const lNameLen = buf.readUInt16LE(localOffset + 26)
    const lExtraLen = buf.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + lNameLen + lExtraLen
    if (dataStart + compSize > buf.length) throw new Error('组件包数据区越界')
    const comp = buf.subarray(dataStart, dataStart + compSize)

    let data
    if (method === 0) {
      data = Buffer.from(comp)
    } else if (method === 8) {
      // M3：maxOutputLength 防 zip 炸弹（inflate 输出硬上限）
      try {
        data = zlib.inflateRawSync(comp, { maxOutputLength: MAX_FILE_BYTES })
      } catch (e) {
        throw new Error(`组件文件解压失败：${name}（${e.message}）`)
      }
    } else {
      throw new Error(`不支持的压缩方式（${method}）：${name}`)
    }
    if (data.length !== uncompSize) throw new Error(`组件文件大小不符：${name}`)
    if (crc32(data) !== crc) throw new Error(`组件文件完整性校验失败：${name}`)
    files[name.replace(/\\/g, '/')] = data
  }
  if (!files[COMPONENT_SCRIPT]) throw new Error('组件包缺少 converters.js')
  return files
}

// ---------- 校验 manifest（H1：version 格式回验；M2：minAppVersion 兼容性） ----------
function validateManifest(files, versionFallback, currentVersion = app.getVersion()) {
  const raw = files[MANIFEST]
  if (!raw) throw new Error('组件包缺少 manifest.json')
  let manifest
  try {
    manifest = JSON.parse(raw.toString('utf8'))
  } catch {
    throw new Error('组件包 manifest.json 格式无效')
  }
  const version = String(manifest.version || versionFallback || '')
  if (!ZIP_NAME_RE.test(`DocLite-converters-${version}.zip`)) {
    throw new Error(`组件版本号不合法：${version}`)
  }
  // M2：组件要求的最低主程序版本——高于当前应用则拒绝（避免 API 错配）
  if (manifest.minAppVersion && compareVersions(String(manifest.minAppVersion), currentVersion) > 0) {
    throw new Error(`组件需要主程序 ${manifest.minAppVersion} 及以上，请先升级应用`)
  }
  // H1-②：converters.js 哈希（manifest.sha256 与实算比对；纵深防御，防通道内文件被替换）
  if (manifest.sha256) {
    const actual = createHash('sha256').update(files[COMPONENT_SCRIPT]).digest('hex')
    if (actual !== String(manifest.sha256).toLowerCase()) {
      throw new Error('组件脚本哈希校验失败（文件被篡改）')
    }
  }
  return { name: manifest.name || 'doclite-converters', version, minAppVersion: manifest.minAppVersion || null }
}

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

// ---------- 组件状态：存在的来源中取版本最高者；同版本按候选顺序 ----------
async function getConvertersStatus() {
  const found = []
  const order = componentDirs()
  for (const cand of order) {
    const info = await readComponentInfo(cand)
    if (info) found.push(info)
  }
  if (found.length === 0) {
    return { installed: false, version: null, source: null, scriptUrl: null }
  }
  found.sort((a, b) => {
    const c = compareVersions(b.version, a.version)
    if (c !== 0) return c
    return order.findIndex((d) => d.label === a.label) - order.findIndex((d) => d.label === b.label)
  })
  const best = found[0]
  return { installed: true, version: best.version, source: best.label, scriptUrl: best.scriptUrl }
}

// ---------- 写盘（白名单已在解压时校验；此处保留路径/体积纵深防御 + 原子替换） ----------
async function writeComponentFiles(files, destDir) {
  const names = Object.keys(files || {})
  if (names.length === 0) throw new Error('组件包内容为空')

  const tmpDir = destDir + '.installing'
  const tmpResolved = path.resolve(tmpDir)
  let total = 0
  const plan = []
  for (const name of names) {
    const clean = String(name).replace(/\\/g, '/').replace(/^\/+/, '')
    if (!isAllowedName(name)) throw new Error(`组件包含不允许的文件：${name}`)
    const target = path.join(tmpDir, clean)
    if (!path.resolve(target).startsWith(tmpResolved + path.sep)) {
      throw new Error(`组件路径越界：${name}`)
    }
    const bytes = files[name]
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
  const current = app.getVersion()
  const candidates = assets
    .map((a) => ({ asset: a, m: ZIP_NAME_RE.exec(a.name) }))
    .filter((x) => x.m)
    // M2：只安装不高于当前主程序版本的组件，避免 API 错配
    .filter((x) => compareVersions(x.m[1], current) <= 0)
    .sort((x, y) => compareVersions(y.m[1], x.m[1])) // 版本降序，取最高可用
  if (candidates.length === 0) {
    throw new Error(`当前版本（v${current}）暂无匹配的转换组件包，请稍后再试或升级应用`)
  }
  const zip = {
    name: candidates[0].asset.name,
    version: candidates[0].m[1],
    size: candidates[0].asset.size,
    url: candidates[0].asset.url,
  }

  // M3：sha256 期望值必须拿到，否则中止（组件包由自家发布流程产出，缺失即发布异常）
  const shaAsset = assets.find((a) => a.name === `${zip.name}.sha256`)
  if (!shaAsset) throw new Error('组件包缺少校验文件（.sha256），已中止安装')
  for (const s of buildCandidateSources(shaAsset.url)) {
    try {
      const buf = await requestUrl(s.url, { 'User-Agent': `DocLite/${current} (component-installer)` }, { maxBytes: 4096 })
      const h = buf.toString('utf8').trim().split(/\s+/)[0].toLowerCase()
      if (/^[0-9a-f]{64}$/.test(h)) { zip.sha256 = h; break }
    } catch { /* 试下一源 */ }
  }
  if (!zip.sha256) throw new Error('组件包校验文件获取失败，已中止安装')
  return zip
}

// ---------- 应用内安装（全程主进程；M1 并发互斥；临时文件随机后缀） ----------
async function installConverters(onProgress) {
  if (installing) return { ok: false, error: '组件安装正在进行中，请稍候' }
  installing = true
  const tmpZip = path.join(app.getPath('userData'), `converters-download-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.zip`)
  try {
    // 1) 定位资产（含版本上限与 sha256 期望值）
    const zip = await locateComponentAsset()

    // 2) 镜像轮询下载（复用升级器镜像加速基建）
    const sources = buildCandidateSources(zip.url)
    const failures = []
    let downloadedOk = false
    for (const source of sources) {
      const hash = createHash('sha256')
      try {
        const st = await downloadFromUrl(source, tmpZip, {
          size: zip.size,
          sizeCap: Math.min(Math.ceil((zip.size || 0) * 1.1), INSTALL_DOWNLOAD_MAX),
          hash,
          onProgress: (r, t) => onProgress && onProgress(r, t, source.name),
        })
        if (hash.digest('hex') !== zip.sha256) throw new Error('组件包校验失败（sha256 不匹配）')
        if (st.total > 0 && st.received !== st.total) throw new Error('组件包下载不完整')
        downloadedOk = true
        break
      } catch (e) {
        await fs.promises.unlink(tmpZip).catch(() => {})
        failures.push(`${source.name}：${e.message}`)
      }
    }
    if (!downloadedOk) throw new Error(`组件包下载失败：${failures.join('；')}`)

    // 3) 主进程解包 + 校验（H1：无渲染层回传路径；M3：inflate 输出上限）
    const buf = await fs.promises.readFile(tmpZip)
    const files = unzipComponent(buf)
    const manifest = validateManifest(files, zip.version)

    // 4) 原子写盘到用户级目录
    const destDir = componentDirs().find((d) => d.label === 'user').dir
    const count = await writeComponentFiles(files, destDir)
    // 以 zip 内 manifest 为准重写（附文件数，供状态检测读取版本）
    await fs.promises.writeFile(
      path.join(destDir, MANIFEST),
      JSON.stringify({ ...manifest, files: count }, null, 2) + '\n'
    )
    const status = await getConvertersStatus()
    // 返回"本次安装的组件版本"（而非全局生效版本——dev/系统级来源可能版本更高，会误导 UI）
    return { ok: true, version: manifest.version, status }
  } catch (e) {
    return { ok: false, error: e.message || '安装失败' }
  } finally {
    await fs.promises.unlink(tmpZip).catch(() => {})
    installing = false
  }
}

// ---------- 注册 IPC ----------
function registerConvertersComponent() {
  ipcMain.handle('converters:get-status', () => getConvertersStatus())

  ipcMain.handle('converters:install', () => installConverters())

  // 卸载（仅用户级；系统级由包管理器移除）；L3：顺带清理临时残留
  ipcMain.handle('converters:uninstall', async () => {
    const userDir = componentDirs().find((d) => d.label === 'user').dir
    try {
      if (installing) return { ok: false, error: '组件安装正在进行中，请稍候' }
      await fs.promises.rm(userDir, { recursive: true, force: true })
      await fs.promises.rm(userDir + '.installing', { recursive: true, force: true })
      const leftovers = await fs.promises.readdir(app.getPath('userData')).catch(() => [])
      await Promise.all(
        leftovers
          .filter((f) => /^converters-download-.*\.zip$/.test(f))
          .map((f) => fs.promises.unlink(path.join(app.getPath('userData'), f)).catch(() => {}))
      )
      const status = await getConvertersStatus()
      return { ok: true, status }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  })

  // 组件目录（用户级）在文件管理器中打开
  ipcMain.handle('converters:open-folder', async () => {
    const status = await getConvertersStatus()
    if (!status.installed) return false
    if (status.source === 'system') {
      shell.showItemInFolder(path.join(process.resourcesPath, 'converters', COMPONENT_SCRIPT))
    } else if (status.source === 'user') {
      shell.showItemInFolder(path.join(app.getPath('userData'), 'converters', COMPONENT_SCRIPT))
    } else {
      return false
    }
    return true
  })
}

module.exports = {
  registerConvertersComponent,
  getConvertersStatus,
  // 导出供单元测试
  unzipComponent,
  validateManifest,
  crc32,
  isAllowedName,
  installConverters,
}