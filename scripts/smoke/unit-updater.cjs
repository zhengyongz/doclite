// scripts/smoke/unit-updater.cjs
// 升级链路纯逻辑单元测试（不依赖 Electron / 不依赖网络）
// 原 .temp/test-updater-mirror.cjs，收纳入库并补充回归用例。
// 运行：node scripts/smoke/unit-updater.cjs

const updater = require('../../electron/updater.cjs')

let passed = 0
let failed = 0
let warnings = 0
function ok(name, cond, extra) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name}${extra ? '  ' + extra : ''}`) }
}

console.log('[1] buildCandidateSources：官方直连优先 + 镜像顺序')
const assetUrl = 'https://github.com/zhengyongz/doclite/releases/download/v0.4.2/doclite_0.4.2_amd64.deb'
const cands = updater.buildCandidateSources(assetUrl)
ok('候选数 = 4（直连 + 3 镜像）', cands.length === 4, `实际 ${cands.length}`)
ok('第一个为官方直连（前缀为空）', cands[0].name === '官方直连' && cands[0].url === assetUrl)
ok('第二个为 ghfast.top', cands[1].name.includes('ghfast.top') && cands[1].url === 'https://ghfast.top/' + assetUrl)
ok('第三个为 gh-proxy.com', cands[2].name.includes('gh-proxy.com') && cands[2].url === 'https://gh-proxy.com/' + assetUrl)
ok('第四个为 ghproxy.net', cands[3].name.includes('ghproxy.net') && cands[3].url === 'https://ghproxy.net/' + assetUrl)

console.log('[2] DOWNLOAD_SOURCES 常量完整性')
const names = updater.DOWNLOAD_SOURCES.map((s) => s.name)
ok('含官方直连与 3 个镜像', names.length === 4 && names[0] === '官方直连')
ok('镜像均带前缀且非空', updater.DOWNLOAD_SOURCES.slice(1).every((s) => /^https:\/\/[^/]+\/$/.test(s.prefix)))

console.log('[3] compareVersions 回归（防误伤旧逻辑）')
const cv = updater.compareVersions
ok('0.4.2 < 0.4.3', cv('0.4.2', '0.4.3') === -1)
ok('0.4.3 > 0.4.2', cv('0.4.3', '0.4.2') === 1)
ok('同版本相等', cv('0.4.3', 'v0.4.3') === 0)
ok('正式版 > 预发布', cv('0.4.3', '0.4.3-beta.1') === 1)
ok('主版本比较', cv('0.10.0', '0.9.9') === 1)

console.log('[4] pickAsset darwin 正则（v0.6.0 踩坑回归）')
// electron-builder zip 命名怪癖：arm64 → *-arm64-mac.zip；x64 无 arch 后缀 → *-mac.zip
const pick = updater.pickAsset
if (typeof pick === 'function') {
  const assets = [
    { name: 'DocLite-0.8.1-arm64-mac.zip' },
    { name: 'DocLite-0.8.1-mac.zip' },
    { name: 'DocLite-0.8.1-setup.exe' },
    { name: 'doclite_0.8.1_amd64.deb' },
  ]
  const got = pick(assets, 'darwin')
  ok('darwin 优先 arm64-mac.zip', got && got.name === 'DocLite-0.8.1-arm64-mac.zip', got ? got.name : 'undefined')
  const got2 = pick([{ name: 'DocLite-0.8.1-mac.zip' }], 'darwin')
  ok('darwin 无 arm64 时回退 mac.zip', got2 && got2.name === 'DocLite-0.8.1-mac.zip', got2 ? got2.name : 'undefined')
  const got3 = pick(assets, 'win32')
  ok('win32 选中 setup.exe', got3 && got3.name === 'DocLite-0.8.1-setup.exe', got3 ? got3.name : 'undefined')
  const got4 = pick(assets, 'linux')
  ok('linux 选中 deb', got4 && got4.name === 'doclite_0.8.1_amd64.deb', got4 ? got4.name : 'undefined')
} else {
  ok('pickAsset 已导出（用于 darwin 命名回归）', false, 'updater.cjs 未导出 pickAsset')
}

console.log('[5] 已知待修项监控（警告项，不计入失败）')
// 设计说明：这些是 docs/TASKS.md 里已登记的待修项，不是回归。
// 冒烟测试的目的是「判断本次改动有没有引入新问题」，不是「要求历史问题已修完」。
// 因此这里输出 ⚠ 而非 ✗ —— 修好后会变成 ✓，修复过程可被观察到。
const fs = require('fs')
const src = fs.readFileSync(require('path').join(__dirname, '..', '..', 'electron', 'updater.cjs'), 'utf8')

function warn(name, cond, extra) {
  const mark = cond ? '\u2713' : '\u26a0'
  console.log(`  ${mark} ${name}${extra ? '  ' + extra : ''}`)
  if (cond) passed++; else warnings++
}

const handlerMatch = src.match(/ipcMain\.handle\('updater:open-installer'[\s\S]{0,600}?\n\s*\}\)/)
if (handlerMatch) {
  const body = handlerMatch[0]
  const guarded = /startsWith\s*\(/.test(body) || /path\.resolve/.test(body) || /includes\s*\(/.test(body)
  warn('R-033 open-installer 限定下载目录', guarded, guarded ? '已加固' : '仍未限定路径（TASKS.md 待修）')
} else {
  warn('R-033 检出 updater:open-installer handler', false, '未匹配到 IPC handler')
}

// R-034：copy-install-cmd 入参校验
const copyMatch = src.match(/ipcMain\.handle\('updater:copy-install-cmd'[\s\S]{0,600}?\n\s*\}\)/)
if (copyMatch) {
  const guarded = /startsWith\s*\(/.test(copyMatch[0]) || /includes\s*\(/.test(copyMatch[0]) || /typeof\s+/.test(copyMatch[0])
  warn('R-034 copy-install-cmd 校验入参', guarded, guarded ? '已加固' : '未校验（TASKS.md 待修）')
} else {
  warn('R-034 检出 updater:copy-install-cmd handler', false, '未匹配到 IPC handler')
}

console.log(`\n结果：${passed} 通过 / ${failed} 失败 / ${warnings} 警告`)
console.log('（警告项为 docs/TASKS.md 已登记的待修项，不阻塞冒烟；修好后会变成 ✓）')
process.exit(failed === 0 ? 0 : 1)
