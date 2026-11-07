#!/usr/bin/env node
/**
 * DocLite 项目状态体检（v1）
 *
 * 用途：一条命令看清「还有什么没修」「哪些决策没记录」「验证基建缺什么」。
 * 用途边界：这是 P1 阶段的轻量版，只做统计与体检，不做验证。
 * P2 阶段会扩展为 handoff（生成给星辰的指令包）。
 *
 * 用法：
 *   node scripts/project-status.mjs            # 体检报告
 *   node scripts/project-status.mjs --json     # 机器可读输出
 *   node scripts/project-status.mjs --open     # 列出未闭环项
 *
 * 依赖：仅 Node 内置模块，零外部依赖。
 */

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TASKS = join(ROOT, 'docs/TASKS.md')
const STATE = join(ROOT, 'docs/STATE.md')

const OPEN_STATES = new Set(['待修', '进行中', '待验'])
const CLOSED_STATES = new Set(['已修', '已知限制', '已搁置'])

// 章节 → 优先级（T/B/V 段列结构不同，优先级由章节决定）
function priorityOf(section) {
  if (section.includes('🔴 高优先级')) return '🔴'
  if (section.includes('🟡 中优先级')) return '🟡'
  if (section.includes('⚪ 低优先级')) return '⚪'
  if (section.includes('用户反馈')) return '🔴'
  if (section.includes('技术债')) return '🟡'
  if (section.includes('验证缺口')) return '🟡'
  return '⚪'
}

function parseTasks(text) {
  const rows = []
  let section = ''
  let inSummary = false
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) {
      section = line.slice(3).trim()
      // 汇总看板里的表格是「摘要视图」，不是条目本身，必须排除
      inSummary = section.includes('汇总看板')
      continue
    }
    if (inSummary) continue
    const m = line.match(/^\|\s*([RBTV])-(\d+)\s*\|/)
    if (!m) continue
    const cells = line.replace(/^\||\|$/g, '').split('|').map((s) => s.trim())
    const priority = priorityOf(section)
    // 定位状态列：R/B 段表头为 ID|来源|问题|定位|状态|关闭版本|备注
    //            T/V 段表头为 ID|问题|定位|状态|备注
    // 用「状态候选值」匹配定位，避免硬编码列号（各段列数不同会错位）
    const statusIdx = cells.findIndex((c) => OPEN_STATES.has(c) || CLOSED_STATES.has(c))
    const status = statusIdx >= 0 ? cells[statusIdx] : '?'
    // 标题列：R/B 段表头 ID|来源|问题|定位|状态 → 问题在 index 2
    //          T/V 段表头 ID|问题|定位|状态      → 问题在 index 1
    const title = section.includes('技术债') || section.includes('验证缺口')
      ? (cells[1] || '')
      : (cells[2] || cells[1] || '')
    rows.push({
      id: `${m[1]}-${m[2]}`,
      priority,
      status,
      title,
    })
  }
  return rows
}

function parseDecisions(text) {
  const ids = []
  for (const m of text.matchAll(/^### (D-\d+) · (\d{4}-\d{2}-\d{2}) · (.+)$/gm)) {
    ids.push({ id: m[1], date: m[2], title: m[3] })
  }
  return ids
}

function parsePending(text) {
  const ids = []
  for (const m of text.matchAll(/^\| (Q-\d+) \| (.+?) \| (.+?) \| (.+?) \|$/gm)) {
    ids.push({ id: m[1], topic: m[2], options: m[3], impact: m[4] })
  }
  return ids
}

function main() {
  const args = process.argv.slice(2)

  if (!existsSync(TASKS)) {
    console.error(`✗ 找不到 ${TASKS}`)
    process.exit(1)
  }
  const taskText = readFileSync(TASKS, 'utf8')
  const rows = parseTasks(taskText)

  const byStatus = {}
  const byPriority = {}
  const open = []
  for (const r of rows) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1
    byPriority[r.priority] = (byPriority[r.priority] || 0) + 1
    if (OPEN_STATES.has(r.status)) open.push(r)
  }

  const decisions = existsSync(STATE) ? parseDecisions(readFileSync(STATE, 'utf8')) : []
  const pendings = existsSync(STATE) ? parsePending(readFileSync(STATE, 'utf8')) : []

  const result = {
    total: rows.length,
    byStatus,
    byPriority,
    openCount: open.length,
    open: open.map((r) => ({ id: r.id, priority: r.priority, status: r.status, title: r.title })),
    decisions: decisions.length,
    pendingDecisions: pendings.length,
    checks: {
      hasTestScript: /"test"\s*:/.test(readFileSync(join(ROOT, 'package.json'), 'utf8')),
      smokeScriptExists: existsSync(join(ROOT, 'scripts/smoke.cjs')),
      smokeInRepo: existsSync(join(ROOT, 'scripts')) && !existsSync(join(ROOT, '.temp/smoke-install.cjs')),
    },
  }

  if (args.includes('--json')) {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  if (args.includes('--open')) {
    console.log('\n未闭环问题（按优先级排序）\n')
    const order = { '🔴': 0, '🟡': 1, '⚪': 2 }
    open.sort((a, b) => order[a.priority] - order[b.priority] || a.id.localeCompare(b.id))
    for (const r of open) {
      console.log(`  ${r.id}  ${r.priority}  ${r.status.padEnd(4)}  ${r.title.slice(0, 60)}`)
    }
    console.log(`\n合计 ${open.length} 项未闭环\n`)
    return
  }

  console.log('\n══ DocLite 项目状态体检 ══\n')
  console.log(`问题清单    ${TASKS.replace(ROOT + '/', '')}`)
  console.log(`决策台账    ${STATE.replace(ROOT + '/', '')}  (${decisions.length} 条决策, ${pendings.length} 项待定)`)
  console.log('')
  console.log(`总条目      ${rows.length}`)
  console.log(`  优先级    ` + Object.entries(byPriority).map(([k, v]) => `${k}${v}`).join('  '))
  console.log(`  状态      ` + Object.entries(byStatus).map(([k, v]) => `${k}${v}`).join('  '))
  console.log('')
  console.log(`未闭环      ${open.length} 项`)

  const byP = {}
  for (const r of open) byP[r.priority] = (byP[r.priority] || 0) + 1
  console.log(`  分布      ` + Object.entries(byP).map(([k, v]) => `${k}${v}`).join('  '))

  console.log('')
  console.log('基建检查')
  console.log(`  ${result.checks.hasTestScript ? '✓' : '✗'} package.json 有 test script`)
  console.log(`  ${result.checks.smokeScriptExists ? '✓' : '✗'} scripts/smoke.cjs 存在`)
  console.log(`  ${result.checks.smokeInRepo ? '✓' : '✗'} 冒烟脚本已从 .temp 迁入仓库`)
  console.log('')
  if (!result.checks.hasTestScript || !result.checks.smokeScriptExists) {
    console.log('提示  基建未就绪 → AI 无法自证修改正确，每轮仍需人工验证')
    console.log('      见 docs/TASKS.md V-001 / V-004 与 docs/STATE.md D-033')
    console.log('')
  }
  console.log('复查命令')
  console.log('  node scripts/project-status.mjs --open    列出未闭环项')
  console.log('  node scripts/project-status.mjs --json    机器可读输出')
  console.log('')
}

main()
