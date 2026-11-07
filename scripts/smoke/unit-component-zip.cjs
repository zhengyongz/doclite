// scripts/smoke/unit-component-zip.cjs
// 主进程 zip 解包器与 manifest 校验单测（在 Electron 环境跑，可用 app.getVersion）
// 原 .temp/test-zip.cjs，收纳入库（.temp 被 gitignore，每次迭代都在重写）。
// 运行：npx electron scripts/smoke/unit-component-zip.cjs --no-sandbox
//
// 覆盖的安全基线：白名单（H1）、sha256 强校验（H1-②）、minAppVersion 兼容（M2）、
// 体积防线（M3）、CRC 完整性。任一项回归都会导致冒烟失败。
const { app } = require('electron')
const APP_VER = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'package.json'), 'utf8')).version
const path = require('path')
const crypto = require('crypto')
const { zipSync } = require('fflate')

let passed = 0
let failed = 0
function ok(name, cond, extra) {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name}`, extra ?? '') }
}
function throws(name, fn, re) {
  try { fn(); failed++; console.error(`  ✗ ${name}（未抛错）`) }
  catch (e) {
    const good = !re || re.test(e.message)
    if (good) { passed++; console.log(`  ✓ ${name}`) }
    else { failed++; console.error(`  ✗ ${name}（错误不符）`, e.message) }
  }
}

const comp = require(path.join(__dirname, '..', '..', 'electron', 'converters-component.cjs'))
const { unzipComponent, validateManifest, isAllowedName, crc32 } = comp

const SCRIPT = Buffer.from('var DocLiteConverters=(function(){return {convertFile:function(){return "ok"}}})();')
const SHA = crypto.createHash('sha256').update(SCRIPT).digest('hex')

function mkZip(extra = {}, level = 9, manifestOverride = {}) {
  const manifest = {
    name: 'doclite-converters',
    version: APP_VER,
    minAppVersion: APP_VER,
    sha256: SHA,
    files: ['converters.js', 'manifest.json'],
    ...manifestOverride,
  }
  const files = {
    'converters.js': [new Uint8Array(SCRIPT), { mtime: new Date('1980-01-01T00:00:00Z') }],
    'manifest.json': [new Uint8Array(Buffer.from(JSON.stringify(manifest))), { mtime: new Date('1980-01-01T00:00:00Z') }],
    ...extra,
  }
  return Buffer.from(zipSync(files, { level }))
}

app.disableHardwareAcceleration()
app.whenReady().then(() => {
  console.log(`[环境] APP_VER = ${APP_VER}`)

  console.log('[1] 正常包（deflate）解析')
  {
    const files = unzipComponent(mkZip())
    ok('解出 converters.js', files['converters.js'] && files['converters.js'].toString() === SCRIPT.toString())
    ok('解出 manifest.json', !!files['manifest.json'])
    const m = validateManifest(files, APP_VER, APP_VER)
    ok('validateManifest 通过', m.version === APP_VER)
  }

  console.log('[2] store 模式（level 0）')
  {
    const files = unzipComponent(mkZip({}, 0))
    ok('store 解包内容一致', files['converters.js'].toString() === SCRIPT.toString())
  }

  console.log('[3] 白名单与路径（H1）')
  ok('isAllowedName: converters.js', isAllowedName('converters.js'))
  ok('isAllowedName: manifest.json', isAllowedName('manifest.json'))
  ok('isAllowedName: assets/a.js', isAllowedName('assets/a.js'))
  ok('isAllowedName 拒绝: evil.exe', !isAllowedName('evil.exe'))
  ok('isAllowedName 拒绝: ../evil.js', !isAllowedName('../evil.js'))
  ok('isAllowedName 拒绝: /etc/passwd', !isAllowedName('/etc/passwd'))
  ok('isAllowedName 拒绝: C:evil', !isAllowedName('C:evil'))
  ok('isAllowedName 拒绝: assets/', !isAllowedName('assets/'))
  throws('zip 含 evil.exe 被拒绝', () => unzipComponent(mkZip({ 'evil.exe': [new Uint8Array([1, 2, 3]), {}] })), /不允许的文件/)
  throws('zip 含 ../evil.js 被拒绝', () => unzipComponent(mkZip({ '../evil.js': [new Uint8Array([1]), {}] })), /不允许的文件/)

  console.log('[4] 损坏/篡改（CRC + 结构）')
  throws('截断包被拒绝', () => unzipComponent(mkZip().subarray(0, 40)), /格式无效|损坏|越界/)
  {
    const buf = mkZip({}, 0) // store 模式下数据区为明文，可精确定位篡改
    const idx = buf.indexOf(SCRIPT.subarray(0, 8))
    if (idx < 0) throw new Error('测试构造失败：未定位到明文')
    buf[idx + 5] ^= 0xff
    throws('CRC 篡改被拒绝', () => unzipComponent(buf), /完整性校验失败/)
  }

  console.log('[5] manifest 校验（H1-②/③、M2）')
  {
    const files = unzipComponent(mkZip({}, 9, { sha256: 'deadbeef' }))
    throws('sha256 不符被拒绝', () => validateManifest(files, APP_VER, APP_VER), /哈希校验失败/)
  }
  {
    const files = unzipComponent(mkZip({}, 9, { version: '../9.9.9' }))
    throws('非法 version 被拒绝', () => validateManifest(files, APP_VER, APP_VER), /版本号不合法/)
  }
  {
    // 构造高于当前应用的 minAppVersion
    const higher = String(Number(APP_VER.split('.')[0]) + 1) + '.0.0'
    const files = unzipComponent(mkZip({}, 9, { minAppVersion: higher }))
    throws('minAppVersion 过高被拒绝', () => validateManifest(files, APP_VER, APP_VER), /需要主程序/)
  }
  {
    const files = unzipComponent(mkZip())
    delete files['manifest.json']
    throws('缺 manifest 被拒绝', () => validateManifest(files, APP_VER, APP_VER), /缺少 manifest/)
  }

  console.log('[6] 体积防线（M3）')
  {
    const big = new Uint8Array(21 * 1024 * 1024) // 21MB > MAX_FILE_BYTES(20MB)
    throws('单文件超 20MB 预检拒绝', () => unzipComponent(mkZip({ 'assets/big.bin': [big, {}] })), /文件过大/)
  }

  console.log('[7] CRC32 实现')
  ok('crc32("123456789") === 0xCBF43926', crc32(Buffer.from('123456789')) === 0xcbf43926)

  console.log(`\n结果：${passed} 通过 / ${failed} 失败`)
  app.exit(failed === 0 ? 0 : 1)
})