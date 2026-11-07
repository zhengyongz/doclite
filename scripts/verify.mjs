#!/usr/bin/env node
/**
 * DocLite 一键体检（verify）
 *
 * 汇总三件事，一眼看全：
 *   1. 问题清单状态（读 docs/TASKS.md）
 *   2. 冒烟测试结果（读 .smoke-report/smoke.json，如不存在则现跑）
 *   3. 决策台账健康度（读 docs/STATE.md）
 *
 * 用途：AI 或人在动手前后各跑一次，判断"现在能不能发版"。
 *
 * 用法：
 *   node scripts/verify.mjs            # 体检（冒烟缺失则现跑）
 *   node scripts/verify.mjs --no-smoke # 跳过冒烟，只看台账
 *   node scripts/verify.mjs --json     # 机器可读
 *
 * 退出码：0 = 可以发版；1 = 有阻塞项
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TASKS = join(ROOT, 'docs/TASKS.md')
const STATE = join(ROOT, 'docs/STATE.md')
const SMOKE_REPORT = join(ROOT, '.smoke-report', 'smoke.json')

const args = process.argv.slice(2)
const wantJson = args.includes('--json')
const noSmoke = args.includes('--no-smoke')

const c = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' }
const out = (s = '') => process.stdout.write(s + '\n')

const OPEN_STATES = new Set(['待修', '进行中', '待验'])
const CLOSED_STATES = new Set(['已修', '已知限制', '已搁置'])

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
      inSummary = section.includes('汇总看板')
      continue
    }
    if (inSummary) continue
    const m = line.match(/^\|\s*([RBTV])-(\d+)\s*\|/)
    if (!m) continue
    const cells = line.replace(/^\||\|$/g, '').split('|').map((s) => s.trim())
    const priority = priorityOf(section)
    const idx = cells.findIndex((x) => OPEN_STATES.has(x) || CLOSED_STATES.has(x))
    const status = idx >= 0 ? cells[idx] : '?'
    const title = section.includes('技术债') || section.includes('验证缺口')
      ? (cells[1] || '') : (cells[2] || cells[1] || '')
    rows.push({ id: `${m[1]}-${m[2]}`, priority, status, title })
  }
  return rows
}

function main() {
  const report = { ok: false, checks: {}, blockers: [], warnings: [] }

  // ---- 1. 问题清单 ----
  if (!existsSync(TASKS)) {
    report.blockers.push(`缺少 ${TASKS}`)
  } else {
    const rows = parseTasks(readFileSync(TASKS, 'utf8'))
    const open = rows.filter((r) => OPEN_STATES.has(r.status))
    const high = open.filter((r) => r.priority === '🔴')
    report.checks.tasks = {
      total: rows.length,
      open: open.length,
      highOpen: high.length,
      highOpenIds: high.map((r) => r.id),
    }
    if (high.length) {
      report.blockers.push(`有 ${high.length} 项 🔴 高优先级未闭环：${high.map((r) => r.id).join(', ')}`)
    }
  }

  // ---- 2. 决策台账 ----
  if (!existsSync(STATE)) {
    report.blockers.push(`缺少 ${STATE}`)
  } else {
    const st = readFileSync(STATE, 'utf8')
    const decisions = (st.match(/^### D-\d+/gm) || []).length
    const pendings = (st.match(/^\| Q-\d+/gm) || []).length
    report.checks.state = { decisions, pendings }
    if (pendings) report.warnings.push(`${pendings} 项决策待人拍板（见 STATE.md 第六节）`)
  }

  // ---- 3. 冒烟 ----
  if (!noSmoke) {
    if (!existsSync(SMOKE_REPORT)) {
      out(`${c.d}[verify] 未发现冒烟报告，现跑 npm run smoke …${c.x}`)
      const r = spawnSync('npm', ['run', 'smoke', '--silent'], {
        cwd: ROOT, encoding: 'utf8', timeout: 600000,
      })
      if (!existsSync(SMOKE_REPORT)) {
        report.blockers.push('冒烟测试未能产出报告（可能构建失败）')
        report.checks.smoke = { ok: false, reason: '无报告' }
      }
    }
    if (existsSync(SMOKE_REPORT)) {
      const s = JSON.parse(readFileSync(SMOKE_REPORT, 'utf8'))
      report.checks.smoke = { ok: s.ok, total: s.total, passed: s.passed, failed: s.failed, durationMs: s.durationMs }
      if (!s.ok) {
        const failedItems = (s.results || []).filter((r) => !r.ok)
        report.blockers.push(`冒烟测试 ${s.failed} 项失败：${failedItems.map((r) => r.name).join('; ').slice(0, 300)}`)
      }
    }
  } else {
    report.checks.smoke = { skipped: true }
  }

  report.ok = report.blockers.length === 0

  if (wantJson) {
    out(JSON.stringify(report, null, 2))
  } else {
    out('')
    out(`${c.b}══ DocLite 发版体检 ══${c.x}`)
    out('')
    if (report.checks.tasks) {
      const t = report.checks.tasks
      out(`问题清单    总计 ${t.total} 条 · 未闭环 ${t.open} 条${t.highOpen ? ` · ${c.r}其中 🔴 ${t.highOpen} 条${c.x}` : ''}`)
      if (t.highOpenIds.length) out(`            ${c.r}${t.highOpenIds.join(', ')}${c.x}`)
    }
    if (report.checks.state) {
      const s = report.checks.state
      out(`决策台账    ${s.decisions} 条决策 · ${s.pendings} 项待拍板`)
    }
    if (report.checks.smoke) {
      const s = report.checks.smoke
      if (s.skipped) out(`冒烟测试    ${c.d}已跳过${c.x}`)
      else out(`冒烟测试    ${s.passed}/${s.total} 通过 · ${s.failed} 失败 · ${((s.durationMs || 0) / 1000).toFixed(1)}s`)
    }
    out('')
    if (report.blockers.length) {
      out(`${c.r}阻塞项${c.x}`)
      for (const b of report.blockers) out(`  ${c.r}✗${c.x} ${b}`)
    }
    if (report.warnings.length) {
      out(`${c.y}提醒${c.x}`)
      for (const w of report.warnings) out(`  ${c.y}⚠${c.x} ${w}`)
    }
    if (report.ok) {
      out(`${c.g}✓ 无阻塞项，可进入合并/发版流程${c.x}`)
    } else {
      out(`${c.r}✗ 存在阻塞项，先处理上述问题${c.x}`)
    }
    out('')
  }

  process.exit(report.ok ? 0 : 1)
}

main()
