// build/pack-converters.cjs
// 可选转换组件打包（electron:build 后接续执行）：
//   1) DocLite-converters-<版本>.zip        — 应用内安装用（主进程下载→渲染层 fflate 解压→用户级目录）
//   2) DocLite-converters-<版本>.zip.sha256 — 完整性校验（下载后核对，防篡改）
//   3) doclite-converters_<版本>_amd64.deb  — Linux 系统级组件包（apt install 主包时按 Recommends 自动带上；
//                                             安装到 /opt/DocLite/resources/converters 与主程序同目录）
//   4) 主 deb 后处理：control 添加 "Recommends: doclite-converters"（浏览版默认不含转换，apt 用户可选）
// 仅依赖 node 内置模块 + fflate（构建机 node_modules）；deb 生成仅在 Linux（有 dpkg-deb）。
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFileSync } = require('child_process')
const { zipSync } = require('fflate')

const ROOT = path.join(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const VERSION = pkg.version
const SRC = path.join(ROOT, 'dist', 'converters')
const OUT = path.join(ROOT, 'release')

// ---------- 组件内容 ----------
const scriptFile = path.join(SRC, 'converters.js')
if (!fs.existsSync(scriptFile)) {
  console.error('[pack-converters] 缺少 dist/converters/converters.js，请先运行 npm run build')
  process.exit(1)
}
const scriptBuf = fs.readFileSync(scriptFile)
const scriptSha = crypto.createHash('sha256').update(scriptBuf).digest('hex')

// 资产文件（pdfjs worker 等）：dist/converters/assets/**（R-096）
// zip 路径与安装白名单（converters-component.cjs 的 ALLOWED_DIR_PREFIXES = ['assets/']）对齐
const assetFiles = []
const assetsDir = path.join(SRC, 'assets')
if (fs.existsSync(assetsDir)) {
  const walk = (dir, prefix) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name)
      const rel = prefix ? `${prefix}/${name}` : name
      if (fs.statSync(full).isDirectory()) walk(full, rel)
      else assetFiles.push({ rel: `assets/${rel}`, full })
    }
  }
  walk(assetsDir, '')
}
// 硬校验（R-096）：worker 缺失则组件内所有 PDF 源转换（→docx/png/azw3）都会失败，
// 宁可打包中断也不静默发布残缺组件
if (!assetFiles.some((f) => f.rel === 'assets/pdf.worker.min.mjs')) {
  console.error('[pack-converters] 缺少 assets/pdf.worker.min.mjs（pdfjs worker）——请检查 vite.config.converters.js 的 copy-pdfjs-worker 插件是否执行')
  process.exit(1)
}
const manifest = {
  name: 'doclite-converters',
  version: VERSION,
  minAppVersion: VERSION, // 主进程安装时校验：高于当前应用版本则拒绝（防 API 错配）
  sha256: scriptSha, // 主进程解包后校验 converters.js 一致性（防通道内替换）
  files: ['converters.js', 'manifest.json', ...assetFiles.map((f) => f.rel)],
}

// ---------- 1/2) zip + sha256 ----------
// 固定 mtime：使同源码重复构建产出一致（zip 字节级可复现，便于校验）
const FIXED_MTIME = new Date('1980-01-01T00:00:00Z') // zip DOS 时间下限（fflate 要求 1980-2099）
const files = {
  'converters.js': [new Uint8Array(scriptBuf), { mtime: FIXED_MTIME }],
  'manifest.json': [new Uint8Array(Buffer.from(JSON.stringify(manifest, null, 2) + '\n', 'utf8')), { mtime: FIXED_MTIME }],
}
for (const f of assetFiles) {
  files[f.rel] = [new Uint8Array(fs.readFileSync(f.full)), { mtime: FIXED_MTIME }]
}
if (assetFiles.length) {
  console.log(`[pack-converters] 附带资产 ${assetFiles.length} 个：${assetFiles.map((f) => f.rel).join(', ')}`)
}
const zipBuf = Buffer.from(zipSync(files, { level: 9, mtime: FIXED_MTIME }))
const zipName = `DocLite-converters-${VERSION}.zip`
const zipPath = path.join(OUT, zipName)
fs.mkdirSync(OUT, { recursive: true })
fs.writeFileSync(zipPath, zipBuf)
const sha = crypto.createHash('sha256').update(zipBuf).digest('hex')
fs.writeFileSync(path.join(OUT, `${zipName}.sha256`), `${sha}  ${zipName}\n`)
console.log(`[pack-converters] ${zipName}（${(zipBuf.length / 1024).toFixed(1)}KB，gzip 压缩后）`)
console.log(`[pack-converters] sha256: ${sha}`)

// ---------- 3) Linux 组件 deb ----------
if (process.platform === 'linux') {
  const tree = path.join(OUT, '.converters-deb')
  const payload = path.join(tree, 'opt', 'DocLite', 'resources', 'converters')
  fs.rmSync(tree, { recursive: true, force: true })
  fs.mkdirSync(payload, { recursive: true })
  fs.copyFileSync(scriptFile, path.join(payload, 'converters.js'))
  fs.writeFileSync(path.join(payload, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  for (const f of assetFiles) {
    const dest = path.join(payload, f.rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(f.full, dest)
  }

  const debian = path.join(tree, 'DEBIAN')
  fs.mkdirSync(debian, { recursive: true })
  // 主 deb 无版本强依赖（Recommends + 版本下限），避免组件主版本耦合
  fs.writeFileSync(path.join(debian, 'control'), [
    'Package: doclite-converters',
    `Version: ${VERSION}`,
    'Architecture: amd64',
    'Maintainer: doclite <doclite@localhost>',
    'Section: utils',
    'Priority: optional',
    'Description: DocLite 可选文件转换组件（Word/Excel/PPT/PDF 转换为 PDF、图片、电子书等）',
    '  浏览功能在主包 doclite 中；本组件提供格式转换能力，可不安装。',
    '',
  ].join('\n'))

  const debName = `doclite-converters_${VERSION}_amd64.deb`
  const debPath = path.join(OUT, debName)
  execFileSync('dpkg-deb', ['--root-owner-group', '-b', tree, debPath], { stdio: 'inherit' })
  fs.rmSync(tree, { recursive: true, force: true })
  const debSha = crypto.createHash('sha256').update(fs.readFileSync(debPath)).digest('hex')
  fs.writeFileSync(path.join(OUT, `${debName}.sha256`), `${debSha}  ${debName}\n`)
  console.log(`[pack-converters] ${debName}（${(fs.statSync(debPath).size / 1024).toFixed(1)}KB）`)

  // ---------- 4) 主 deb 后处理：添加 Recommends ----------
  const mainDeb = path.join(OUT, `doclite_${VERSION}_amd64.deb`)
  if (fs.existsSync(mainDeb)) {
    const rw = path.join(OUT, '.main-deb-rw')
    fs.rmSync(rw, { recursive: true, force: true })
    execFileSync('dpkg-deb', ['-R', mainDeb, rw], { stdio: 'inherit' })
    const controlPath = path.join(rw, 'DEBIAN', 'control')
    let control = fs.readFileSync(controlPath, 'utf8')
    const want = `doclite-converters (>= ${VERSION})`
    let changed = false
    if (control.includes(want)) {
      console.log('[pack-converters] 主包 Recommends 已包含转换组件，跳过')
    } else if (/^Recommends:(.*)$/m.test(control)) {
      // electron-builder 已生成 Recommends（如 libappindicator3-1）：追加转换组件
      control = control.replace(/^(Recommends:.*)$/m, (m, existing) => {
        const list = existing.replace(/^Recommends:\s*/, '').trim()
        return `Recommends: ${list ? list + ', ' : ''}${want}`
      })
      fs.writeFileSync(controlPath, control)
      changed = true
      console.log(`[pack-converters] 主包 Recommends 已追加 ${want}`)
    } else {
      control = control.replace(/^(Architecture:.*$)/m, `$1\nRecommends: ${want}`)
      fs.writeFileSync(controlPath, control)
      changed = true
      console.log(`[pack-converters] 主包已添加 Recommends: ${want}`)
    }
    if (changed) {
      // 原子替换：先写临时文件再 rename，避免中断留下半截 deb（不可恢复损坏）
      // -Zxz -z9：与 electron-builder 原生 deb 同等压缩率（差值 <1%），代价约 4 分钟构建时间
      const mainDebNew = mainDeb + '.new'
      execFileSync('dpkg-deb', ['-b', '-Zxz', '-z9', rw, mainDebNew], { stdio: 'pipe' })
      fs.renameSync(mainDebNew, mainDeb)
    } else {
      console.log('[pack-converters] control 无变更，跳过重压缩（约省 4 分钟）')
    }
    fs.rmSync(rw, { recursive: true, force: true })
    const mainSha = crypto.createHash('sha256').update(fs.readFileSync(mainDeb)).digest('hex')
    fs.writeFileSync(path.join(OUT, `doclite_${VERSION}_amd64.deb.sha256`), `${mainSha}  doclite_${VERSION}_amd64.deb\n`)
    console.log(`[pack-converters] 主包 sha256 已重算: ${mainSha.slice(0, 16)}…`)
  } else {
    console.warn('[pack-converters] 未找到主 deb，跳过 Recommends 后处理')
  }
}

console.log('[pack-converters] 完成')
