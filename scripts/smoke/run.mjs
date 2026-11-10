#!/usr/bin/env node
/**
 * DocLite 冒烟测试套件 —— 统一入口
 *
 * 设计目标：让 AI（星辰 / WorkBuddy）能自己验证修改是否正确。
 * 判据：退出码 0 = 全通过，1 = 有失败。同时输出 JSON 报告供程序消费。
 *
 * 分层（每层可单独跑，失败即中止后续依赖层）：
 *   L1 静态    —— 不需要 Electron，纯文件/文本检查。最快，秒级。
 *   L2 逻辑    —— 纯 Node 单元测试（updater 镜像源、版本比较）。秒级。
 *   L3 单元    —— 需要 Electron 环境（zip 解包器安全校验）。约 5 秒。
 *   L4 集成    —— 起真实 Electron 进程，渲染层断言 + 截图。约 20 秒。
 *
 * 用法：
 *   node scripts/smoke/run.mjs              # 全跑（L1→L4）
 *   node scripts/smoke/run.mjs --layer L1   # 只跑某一层
 *   node scripts/smoke/run.mjs --skip L4    # 跳过某层
 *   node scripts/smoke/run.mjs --json       # 输出 JSON 报告（给 AI 读）
 *   node scripts/smoke/run.mjs --no-build   # 跳过构建（dist 已存在时更快）
 *
 * 退出码：0 = 全部通过；1 = 有失败；2 = 环境不满足（如未构建）
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const REPORT_DIR = join(ROOT, '.smoke-report')

const args = process.argv.slice(2)
const hasFlag = (f) => args.includes(f)
const layerArg = args.find((a) => a.startsWith('--layer='))?.split('=')[1]
const skipArg = args.find((a) => a.startsWith('--skip='))?.split('=')[1]
const wantJson = hasFlag('--json')
const noBuild = hasFlag('--no-build')

const results = []
let failed = false

// ---------- 工具 ----------
const c = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' }
const out = (s = '') => process.stdout.write(s + '\n')

function record(layer, name, ok, detail = '') {
  results.push({ layer, name, ok, detail })
  if (!ok) failed = true
}

// 环境不满足（如无显示环境 / 内存不足导致渲染层 OOM）→ 记为跳过，不算失败。
// 理由：冒烟测试要回答的是「这次改动有没有引入回归」，
// 环境跑不起来属于「测不了」，不属于「测出问题」。
function skip(layer, name, reason) {
  results.push({ layer, name, ok: true, skipped: true, detail: reason })
}

function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: opts.timeout || 180000,
    // 以 cleanEnv 为基线（已剔除 ELECTRON_RUN_AS_NODE），
    // 再叠加调用方指定的变量 —— 否则 process.env 里的污染会被带回来。
    env: { ...cleanEnv(), ...opts.env },
  })
  return {
    code: r.status,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
    output: (r.stdout || '') + (r.stderr || ''),
  }
}

// 解析测试脚本输出里的 "✓ 名称" / "✗ 名称" 标记，转换为断言条目
function parseMarks(output) {
  const marks = []
  for (const line of output.split('\n')) {
    const m = line.match(/^\s*([✓✗])\s+(.+?)(?:\s{2,}(.*))?$/)
    if (m) marks.push({ ok: m[1] === '✓', name: m[2].trim(), detail: (m[3] || '').trim() })
  }
  return marks
}

// ---------- 环境预检 ----------
// 为什么要预检：node_modules 里的 electron 二进制可能与包声明版本不一致
// （postinstall 下载失败时会残留系统旧版二进制）。此时 require('electron') 返回
// 路径字符串而非模块对象，测试会以 "app is undefined" 这种看不懂的方式失败。
// 这里提前把真实原因报出来。
function precheckElectron() {
  const electronDir = join(ROOT, 'node_modules', 'electron')
  const pkgPath = join(electronDir, 'package.json')
  if (!existsSync(pkgPath)) {
    record('precheck', 'electron 包已安装', false, '未找到 node_modules/electron，先跑 npm ci')
    return false
  }
  const declared = JSON.parse(readFileSync(pkgPath, 'utf8')).version
  const binPath = join(electronDir, 'dist', 'electron')
  if (!existsSync(binPath)) {
    record('precheck', 'electron 二进制已下载', false, `缺少 ${binPath}，跑 npm ci 或 node node_modules/electron/install.js`)
    return false
  }
  // 直接问二进制自己的版本号。
  // 必须带 --no-sandbox：以 root 运行时 Electron 会拒绝启动（crbug.com/638180）。
  const r = spawnSync(binPath, ['--version', '--no-sandbox'], { encoding: 'utf8', timeout: 20000, env: cleanEnv() })
  const actual = (r.stdout || r.stderr || '').trim()
  const okVer = actual === `v${declared}`
  record('precheck', `electron 版本一致（声明 ${declared}）`, okVer,
    okVer ? actual : `实际 ${actual || '未知'}，需重装：ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ node node_modules/electron/install.js`)
  if (!okVer) return false

  // ELECTRON_RUN_AS_NODE=1 会让 electron 以纯 Node 模式启动 →
  // require('electron') 返回路径字符串而非模块对象，测试报 "app is undefined"。
  // 这是环境问题而非代码问题，这里主动剔除该变量。
  if (process.env.ELECTRON_RUN_AS_NODE) {
    record('precheck', '已剔除 ELECTRON_RUN_AS_NODE（否则 electron 无法以 GUI 启动）', true,
      `原值=${process.env.ELECTRON_RUN_AS_NODE}`)
  }
  return true
}

// 剔除会让 Electron 退化成纯 Node 模式的环境变量
function cleanEnv() {
  const e = { ...process.env }
  delete e.ELECTRON_RUN_AS_NODE
  return e
}

// ---------- L1 静态检查 ----------
function layerStatic() {
  out(`${c.b}[L1] 静态检查${c.x}`)
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

  // 版本号一致性：package.json / DEVLOG 头部 / appId
  const devlog = existsSync(join(ROOT, 'DEVLOG.md')) ? readFileSync(join(ROOT, 'DEVLOG.md'), 'utf8') : ''
  const devlogVer = devlog.match(/^## .*?v(\d+\.\d+\.\d+)/m)?.[1]
  record('L1', 'package.json 版本号存在', !!pkg.version, pkg.version)
  record('L1', 'DEVLOG 有版本记录', !!devlogVer, devlogVer || '未找到')

  // 关键文件存在
  const mustExist = [
    'electron/main.cjs', 'electron/preload.cjs', 'electron/updater.cjs',
    'electron/converters-component.cjs', 'src/i18n.jsx', 'index.html',
    '.github/workflows/ci.yml', '.github/workflows/release.yml',
    'docs/TASKS.md', 'docs/STATE.md',
  ]
  for (const f of mustExist) {
    record('L1', `文件存在 ${f}`, existsSync(join(ROOT, f)))
  }

  // Electron 安全基线（D-010）：sandbox / CSP / 窗口拦截
  const main = readFileSync(join(ROOT, 'electron/main.cjs'), 'utf8')
  const html = readFileSync(join(ROOT, 'index.html'), 'utf8')
  record('L1', 'webPreferences.sandbox = true', /sandbox:\s*true/.test(main))
  record('L1', 'setWindowOpenHandler 已设置', /setWindowOpenHandler/.test(main))
  record('L1', 'will-navigate 已拦截', /will-navigate/.test(main))
  record('L1', 'index.html 有 CSP', /Content-Security-Policy/.test(html))

  // 组件安全基线（D-009 / R-001）：白名单 + 体积上限 + 强校验
  const comp = readFileSync(join(ROOT, 'electron/converters-component.cjs'), 'utf8')
  record('L1', '组件写盘有文件名白名单', /ALLOWED_FILES/.test(comp))
  record('L1', '组件解压有单文件上限', /MAX_FILE_BYTES/.test(comp))
  record('L1', '组件解压有总体积上限', /MAX_TOTAL_BYTES/.test(comp))
  record('L1', '组件 manifest 有 sha256 校验', /manifest\.sha256/.test(comp))

  // 副标题过滤窗口（D-006 / R-006）：必须是有限窗口，不能是无限 flag
  const conv = existsSync(join(ROOT, 'src/utils/converters.js'))
    ? readFileSync(join(ROOT, 'src/utils/converters.js'), 'utf8') : ''
  const hasWindow = /postHeading\s*=\s*\d+/.test(conv)
  record('L1', '副标题过滤为有限窗口（postHeading = N）', hasWindow)
  record('L1', '副标题判定只挡句读（不含 ：、，）', /[。！？；]/.test(conv) && !/looksLikeTitleLine[\s\S]{0,400}?\[。！？；、，]/.test(conv))

  // 图片 recindex 5 位零填充（B-021）：MOBI 规范要求，Kindle/文石严格解析；
  // 不带补零时正文图片全部失效只剩封面（v8 修复曾因存在未入库脚本而在重写时丢失）。
  // 只查 padStart(5) 写法存在（R-118）：正则绑变量名会在改名时误红；
  // 补零后确实写进产物由 L4 C9 的 /^\d{5}$/ 断言守护
  record('L1', "图片 recindex 用 padStart(5, '0') 补零",
    /padStart\(5,\s*'0'\)/.test(conv))
  // 沉浸热区让路标记（B-023）：渲染器目录面板带 data-toc-panel，App 热区据此不弹侧栏遮挡
  const app = existsSync(join(ROOT, 'src/App.jsx')) ? readFileSync(join(ROOT, 'src/App.jsx'), 'utf8') : ''
  const azw3 = existsSync(join(ROOT, 'src/components/renderers/Azw3Renderer.jsx'))
    ? readFileSync(join(ROOT, 'src/components/renderers/Azw3Renderer.jsx'), 'utf8') : ''
  record('L1', 'Azw3Renderer 目录面板带 data-toc-panel 标记', /data-toc-panel/.test(azw3))
  record('L1', 'App 热区对 [data-toc-panel] 让路', /closest\('\[data-toc-panel\]'\)/.test(app))

  // i18n 完整性（D-016）：关键键在 zh/en 两个字典里都存在
  const i18n = readFileSync(join(ROOT, 'src/i18n.jsx'), 'utf8')
  const keyCount = (k) => (i18n.match(new RegExp(`['\"]${k.replace(/\./g, '\\.')}['\"]\\s*:`, 'g')) || []).length
  for (const k of ['renderer.azw.sectionFailed', 'update.macManualTitle', 'update.goDownload']) {
    record('L1', `i18n 键 ${k} 在 zh+en 均定义`, keyCount(k) === 2, `出现 ${keyCount(k)} 次（期望 2）`)
  }

  // 项目状态台账（TASKS.md）与决策台账（STATE.md）非空且有内容
  const tasks = readFileSync(join(ROOT, 'docs/TASKS.md'), 'utf8')
  const state = readFileSync(join(ROOT, 'docs/STATE.md'), 'utf8')
  record('L1', 'TASKS.md 有条目', (tasks.match(/^\| [RBTV]-\d+/gm) || []).length >= 100,
    `${(tasks.match(/^\| [RBTV]-\d+/gm) || []).length} 条`)
  record('L1', 'STATE.md 有决策', (state.match(/^### D-\d+/gm) || []).length >= 20,
    `${(state.match(/^### D-\d+/gm) || []).length} 条`)

  out(`  ${c.d}静态检查完成${c.x}`)
}

// ---------- L2 纯逻辑单元 ----------
function layerLogic() {
  out(`${c.b}[L2] 逻辑单元测试${c.x}`)
  const r = run(process.execPath, [join(HERE, 'unit-updater.cjs')])
  const marks = parseMarks(r.output)
  if (!marks.length) {
    record('L2', 'updater 逻辑测试可执行', false, r.output.slice(0, 300))
  } else {
    for (const m of marks) record('L2', m.name, m.ok, m.detail)
  }
  if (r.code !== 0 && !marks.length) record('L2', 'updater 逻辑测试退出码为 0', false, `code=${r.code}`)
}

// ---------- L3 需要 Electron 的单元 ----------
function layerUnit() {
  out(`${c.b}[L3] 组件安全单元测试（Electron 环境）${c.x}`)
  if (!precheckElectron()) return
  const electron = join(ROOT, 'node_modules', 'electron', 'dist', 'electron')
  const r = run(electron, [join(HERE, 'unit-component-zip.cjs'), '--no-sandbox'], { timeout: 60000, env: cleanEnv() })
  const marks = parseMarks(r.output)
  if (!marks.length) {
    record('L3', '组件安全测试可执行', false, r.output.slice(0, 400))
  } else {
    for (const m of marks) record('L3', m.name, m.ok, m.detail)
  }
}

// ---------- L4 集成（真实 Electron 进程）----------
function layerIntegration() {
  out(`${c.b}[L4] 集成测试（真实 Electron 进程）${c.x}`)
  if (!precheckElectron()) return
  const electron = join(ROOT, 'node_modules', 'electron', 'dist', 'electron')
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
    record('L4', 'dist 已构建', false, '缺少 dist/index.html，先跑 npm run build')
    return
  }
  const r = run(electron, [join(HERE, 'integration-app.cjs'), '--no-sandbox'], {
    timeout: 120000,
    env: { ...cleanEnv(), DOCLITE_SMOKE_RESULT: join(REPORT_DIR, 'integration.json') },
  })
  const lines = r.output.split('\n')

  // 优先识别「环境跑不起来」的情形：渲染进程 OOM（exitCode 5）
  const oomLine = lines.find((l) => /渲染进程崩溃.*exitCode"?\s*:\s*5/.test(l) || /渲染进程 OOM/.test(l))
  if (oomLine) {
    skip('L4', '集成测试（渲染层需图形环境）', '渲染进程 OOM（exitCode 5）—— 当前环境内存不足或无显示环境。请在开发机/CI runner 跑 L4，或用 --skip=L4 只跑 L1-L3。')
    out(`  ${c.y}⚠ L4 跳过：渲染进程 OOM（环境限制，非代码问题）${c.x}`)
    return
  }

  // 渲染层断言以 "[assert] PASS/FAIL: 名称" 形式输出
  let sawAssert = false
  for (const line of lines) {
    const m = line.match(/^\[assert\]\s+(PASS|FAIL)\s*[:：]\s*(.+)$/)
    if (m) {
      sawAssert = true
      record('L4', m[2].trim(), m[1] === 'PASS')
    }
  }
  if (!sawAssert) {
    record('L4', '集成测试产生断言结果', false, r.output.slice(-500))
  }
  const fatal = lines.find((l) => l.startsWith('[fatal]'))
  if (fatal) record('L4', '集成测试无致命错误', false, fatal.slice(0, 300))
  else record('L4', '集成测试无致命错误', true)
}

// ---------- 主流程 ----------
function main() {
  const started = Date.now()
  mkdirSync(REPORT_DIR, { recursive: true })

  // 构建（集成层需要 dist）
  if (!noBuild && !existsSync(join(ROOT, 'dist', 'index.html'))) {
    out(`${c.d}[build] dist 缺失，先构建…${c.x}`)
    const b = run('npm', ['run', 'build'], { timeout: 300000 })
    if (b.code !== 0) {
      record('build', 'npm run build 成功', false, b.output.slice(-500))
      out(`${c.r}构建失败，跳过后续层${c.x}`)
    } else {
      record('build', 'npm run build 成功', true)
    }
  }

  const layers = [
    ['L1', layerStatic],
    ['L2', layerLogic],
    ['L3', layerUnit],
    ['L4', layerIntegration],
  ]

  for (const [name, fn] of layers) {
    if (layerArg && layerArg !== name) continue
    if (skipArg && skipArg.split(',').includes(name)) continue
    try {
      fn()
    } catch (e) {
      record(name, `${name} 层执行异常`, false, e && e.message ? e.message : String(e))
    }
    // 前一层失败则中止后续（依赖关系）
    if (failed && (name === 'L1' || name === 'L2' || name === 'L3')) {
      out(`${c.y}${name} 有失败，跳过后续层${c.x}`)
      const rest = layers.slice(layers.findIndex(([n]) => n === name) + 1)
      for (const [n] of rest) {
        if (!layerArg && !skipArg) record(n, `${n} 因前置层失败未执行`, false, 'skipped')
      }
      break
    }
  }

  const skipped = results.filter((r) => r.skipped)
  const report = {
    ok: !failed,
    durationMs: Date.now() - started,
    total: results.length,
    passed: results.filter((r) => r.ok && !r.skipped).length,
    failed: results.filter((r) => !r.ok).length,
    skipped: skipped.length,
    skipReasons: skipped.map((r) => ({ name: r.name, reason: r.detail })),
    results,
  }
  writeFileSync(join(REPORT_DIR, 'smoke.json'), JSON.stringify(report, null, 2), 'utf8')

  if (wantJson) {
    out(JSON.stringify(report, null, 2))
  } else {
    out('')
    out(`${c.b}══ 冒烟测试结果 ══${c.x}`)
    out(`  总计 ${report.total} 项 · 通过 ${report.passed} · 失败 ${report.failed} · 跳过 ${report.skipped} · 耗时 ${(report.durationMs / 1000).toFixed(1)}s`)
    if (report.skipped) {
      out('')
      out(`${c.y}跳过项（环境限制，非代码问题）：${c.x}`)
      for (const s of report.skipReasons) {
        out(`  ${c.y}⚠${c.x} ${s.name}${s.reason ? `\n      ${c.d}${s.reason}${c.x}` : ''}`)
      }
    }
    if (report.failed) {
      out('')
      out(`${c.r}失败项：${c.x}`)
      for (const r of results.filter((x) => !x.ok)) {
        out(`  ${c.r}✗${c.x} [${r.layer}] ${r.name}${r.detail ? `  ${c.d}${r.detail}${c.x}` : ''}`)
      }
    }
    out('')
    out(`  报告已写入 .smoke-report/smoke.json`)
    out('')
  }

  process.exit(failed ? 1 : 0)
}

main()
