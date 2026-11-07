#!/usr/bin/env node
/**
 * 生成给「星辰超级智能体」的交接指令包
 *
 * 目的：消灭"人当搬运工"——你不用再组织语言、复制上下文，
 *      一条命令生成完整指令包，你复制粘贴给星辰即可。
 *
 * 用法：
 *   npm run handoff                      # 列出所有待办，让你挑
 *   npm run handoff R-031 R-032          # 为指定问题生成指令包
 *   npm run handoff -- --task "做某个功能" # 为自定义任务生成
 *   npm run handoff -- --all             # 包含全部未闭环项
 *   npm run handoff -- --save            # 额外存到 .smoke-report/handoff.md
 *   npm run handoff -- --print           # 只输出纯指令包（无说明，便于复制）
 *
 * 输出即粘贴内容，不需要二次编辑。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TASKS = join(ROOT, 'docs/TASKS.md')
const STATE = join(ROOT, 'docs/STATE.md')

const args = process.argv.slice(2)
const wantAll = args.includes('--all')
const wantSave = args.includes('--save')
const printOnly = args.includes('--print')
const taskIdx = args.indexOf('--task')
const customTask = taskIdx >= 0 ? args[taskIdx + 1] : null
const ids = args.filter((a) => /^[RBTV]-\d+$/.test(a))

const c = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' }
const out = (s = '') => process.stdout.write(s + '\n')

// ---------- 读取台账 ----------
const OPEN_STATES = new Set(['待修', '进行中', '待验'])

function priorityOf(section) {
  if (section.includes('🔴 高优先级')) return '🔴'
  if (section.includes('🟡 中优先级')) return '🟡'
  if (section.includes('⚪ 低优先级')) return '⚪'
  if (section.includes('用户反馈')) return '🔴'
  if (section.includes('技术债')) return '🟡'
  if (section.includes('验证缺口')) return '🟡'
  return '⚪'
}

function parseTasks() {
  if (!existsSync(TASKS)) return []
  const rows = []
  let section = ''
  let inSummary = false
  for (const line of readFileSync(TASKS, 'utf8').split('\n')) {
    if (line.startsWith('## ')) {
      section = line.slice(3).trim()
      inSummary = section.includes('汇总看板')
      continue
    }
    if (inSummary) continue
    const m = line.match(/^\|\s*([RBTV])-(\d+)\s*\|/)
    if (!m) continue
    const cells = line.replace(/^\||\|$/g, '').split('|').map((s) => s.trim())
    const priority = priorityOf(section)
    const idx = cells.findIndex((x) => OPEN_STATES.has(x))
    const status = idx >= 0 ? cells[idx] : ''
    if (!OPEN_STATES.has(status)) continue
    const isTv = section.includes('技术债') || section.includes('验证缺口')
    rows.push({
      id: `${m[1]}-${m[2]}`,
      priority,
      status,
      title: isTv ? (cells[1] || '') : (cells[2] || cells[1] || ''),
      where: isTv ? (cells[2] || '') : (cells[3] || ''),
      note: isTv ? (cells[4] || '') : (cells[6] || ''),
    })
  }
  return rows
}

function parseDecisions() {
  if (!existsSync(STATE)) return []
  const t = readFileSync(STATE, 'utf8')
  const out = []
  for (const m of t.matchAll(/^### (D-\d+) · (\d{4}-\d{2}-\d{2}) · (.+)$/gm)) {
    out.push({ id: m[1], date: m[2], title: m[3] })
  }
  return out
}

const openTasks = parseTasks()
const decisions = parseDecisions()

// ---------- 无参数：列出待办让人挑 ----------
if (!ids.length && !customTask && !wantAll) {
  out('')
  out(`${c.b}══ 待办清单 ══${c.x}  ${c.d}（共 ${openTasks.length} 项未闭环）${c.x}`)
  out('')
  const groups = { '🔴': [], '🟡': [], '⚪': [] }
  for (const t of openTasks) groups[t.priority]?.push(t)
  for (const p of ['🔴', '🟡', '⚪']) {
    if (!groups[p].length) continue
    out(`${p} ${groups[p].length} 项`)
    for (const t of groups[p]) {
      out(`  ${t.id.padEnd(7)} ${t.status.padEnd(4)} ${t.title.slice(0, 52)}`)
    }
    out('')
  }
  out(`${c.d}用法：${c.x}`)
  out(`  npm run handoff R-031 R-032        ${c.d}为指定问题生成指令包${c.x}`)
  out(`  npm run handoff -- --task "描述"    ${c.d}为自定义任务生成${c.x}`)
  out(`  npm run handoff -- --all            ${c.d}包含全部未闭环项${c.x}`)
  out('')
  process.exit(0)
}

// ---------- 组装指令包 ----------
const picked = wantAll
  ? openTasks
  : ids.length
    ? openTasks.filter((t) => ids.includes(t.id))
    : []

if (ids.length && picked.length === 0) {
  out(`${c.r}✗ 未找到这些 ID：${ids.join(', ')}${c.x}`)
  out(`${c.d}可用 ID 见上方清单${c.x}`)
  process.exit(1)
}

const L = []
L.push('# DocLite 交接指令包')
L.push('')
L.push('> 本文件由 `npm run handoff` 自动生成。**请先读完本文件再动手，不要反问我项目背景。**')
L.push('')
L.push('## 项目')
L.push('')
L.push('- 路径：`/home/zhengyz/文档/doclite`')
L.push('- 技术栈：Electron 33 + React 18 + Vite 6 + Tailwind 3 + electron-builder 25')
L.push('- 形态：纯本地文档工具箱（PDF / Word / Excel / PPT / Markdown / MOBI / AZW3 预览与互转），不上传服务器')
L.push('- 当前版本：见 `package.json` 的 `version` 字段')
L.push('')

// 本轮任务
L.push('## 本轮任务')
L.push('')
if (customTask) {
  L.push(customTask)
} else {
  L.push('修复以下问题（按优先级排序，全部修完或明确说明为何不改）：')
  L.push('')
  for (const t of picked) {
    L.push(`- **${t.id}**（${t.priority} ${t.status}）${t.title}`)
    if (t.where) L.push(`  - 位置：${t.where}`)
    if (t.note) L.push(`  - 备注：${t.note}`)
  }
}
L.push('')

// 必读上下文
L.push('## 必读上下文（按顺序读完再动手）')
L.push('')
L.push('1. **`docs/STATE.md`** — 全部历史决策与理由。**这里面的决策不要推翻**；')
L.push('   若你认为某条决策已过时，改为在 `docs/STATE.md` 里追加新决策（标注「废止 D-xxx」），不要直接改旧条目。')
L.push('2. **`docs/TASKS.md`** — 问题清单与状态。修完把对应行状态改为 `待验`，验证通过后改 `已修` 并填关闭版本。')
L.push('3. **`.workbuddy/memory/`** — 最近的开发上下文（按文件名日期倒序读最近 2-3 篇）。')
L.push('4. **`DEVLOG.md`** — 版本记录与技术说明。')
L.push('5. **相关审查报告** — 在 `docs/reviews/`，文件名带日期与主题，按需查阅。')
L.push('')

// 关键约束
L.push('## 约束')
L.push('')
L.push('- 改完必须跑 `npm run smoke`，**全部通过**（允许有 ⚠ 警告，不允许有 ✗ 失败）才算完成。')
L.push('  - 若 L4 被跳过（提示 OOM / 无图形环境），改跑 `npm run smoke:static && npm run smoke:logic && npm run smoke:unit`，并在汇报里说明 L4 未跑。')
L.push('  - 注意：项目里的**已知待修项**显示为 ⚠ 警告，不是失败 —— 不要试图"顺手修完"所有警告，专注本轮任务。')
L.push('- 不要改动 `docs/STATE.md` 里的历史决策条目（可追加新决策）。')
L.push('- 不要改动 `docs/reviews/` 下的归档原文（那是当时快照）。')
L.push('- 不要动 `.smoke-report/`（测试产物目录，已 gitignore）。')
L.push('- 保持本地化：所有用户可见文案走 `src/i18n.jsx` 的 `t()` / `ts()`，不要硬编码中文或英文。')
L.push('')

// 验收标准
L.push('## 验收标准')
L.push('')
L.push('- [ ] `npm run smoke` 无 ✗ 失败')
L.push('- [ ] `npm run status` 中本轮涉及的条目状态已更新')
L.push('- [ ] 提交 commit，message 末尾附 `Closes: <ID列表>`（如 `Closes: R-031, R-032`）')
L.push('- [ ] 汇报时说清：改了什么、冒烟结果如何、哪些没做完及原因')
L.push('')

// 当前状态参考
L.push('## 当前项目状态（供参考）')
L.push('')
const byP = { '🔴': 0, '🟡': 0, '⚪': 0 }
for (const t of openTasks) byP[t.priority] = (byP[t.priority] || 0) + 1
L.push(`- 未闭环问题共 ${openTasks.length} 项（🔴 ${byP['🔴']} · 🟡 ${byP['🟡']} · ⚪ ${byP['⚪']}）`)
L.push(`- 决策台账共 ${decisions.length} 条`)
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
L.push(`- 当前版本：v${pkg.version}`)

// 最近提交（用 git 读，失败不影响主流程）
try {
  const { execFileSync } = await import('node:child_process')
  const log = execFileSync('git', ['log', '--oneline', '-5'], {
    cwd: ROOT, encoding: 'utf8', timeout: 10000,
  }).trim()
  if (log) {
    L.push('- 最近提交：')
    L.push('')
    for (const line of log.split('\n')) L.push(`  ${line}`)
  }
  const st = execFileSync('git', ['status', '--short'], {
    cwd: ROOT, encoding: 'utf8', timeout: 10000,
  }).trim()
  if (st) {
    L.push('')
    L.push('- 当前工作区有未提交改动（注意不要覆盖）：')
    L.push('')
    for (const line of st.split('\n').slice(0, 10)) L.push(`  ${line}`)
  }
} catch {
  // git 不可用时静默跳过，不影响交接包生成
}
L.push('')

// 附上本次要修的条目原文，便于星辰直接看到定位
if (picked.length) {
  L.push('---')
  L.push('')
  L.push('## 附：待修条目定位速查')
  L.push('')
  for (const t of picked) {
    L.push(`### ${t.id} ${t.title}`)
    L.push('')
    L.push(`- 优先级：${t.priority}　状态：${t.status}`)
    if (t.where) L.push(`- 位置：${t.where}`)
    if (t.note) L.push(`- 备注：${t.note}`)
    L.push('')
  }
}

const packet = L.join('\n')

// ---------- 输出 ----------
if (wantSave) {
  const dir = join(ROOT, '.smoke-report')
  mkdirSync(dir, { recursive: true })
  const f = join(dir, 'handoff.md')
  writeFileSync(f, packet, 'utf8')
  out(`${c.g}✓ 已保存：${f}${c.x}`)
  out('')
}

if (printOnly) {
  out(packet)
} else {
  out('')
  out(`${c.b}══ 交接指令包 ══${c.x}  ${c.d}${customTask ? '自定义任务' : picked.length + ' 个问题'}${c.x}`)
  out('')
  out(packet)
  out('')
  out(`${c.d}────────────────────────────────────────${c.x}`)
  out(`${c.b}用法：${c.x}全选上面内容复制 → 粘贴给星辰超级智能体。`)
  out(`${c.d}（加 --save 可同时存一份到 .smoke-report/handoff.md）${c.x}`)
  out('')
}
