import { attr, joinLine, fmtDuration, resetCountdown, shortPath } from './format.mjs'
import { gradientBar, colorize } from './color.mjs'

const BLUE = [86, 156, 214], MAGENTA = [197, 134, 192], DIM = [130, 130, 130]
const GREEN = [0, 200, 80], YELLOW = [220, 200, 0], RED = [220, 40, 40], CYAN = [86, 182, 194]

const tierColor = p => (p >= 90 ? RED : p >= 70 ? YELLOW : GREEN)

// 永不隱藏：讀到值（非 null/空）→ label+value 上 color；沒抓到 → label+placeholder 上 DIM
const field = (label, value, color, placeholder) =>
  (value == null || value === '')
    ? colorize(`${label}${placeholder}`, DIM)
    : colorize(`${label}${value}`, color)

export function renderLine1(d, deps) {
  const cw = d.context_window || {}
  const dir = d.workspace?.current_dir
  const tok = cw.total_input_tokens
  const parts = [
    field('', dir ? shortPath(dir, deps.home) : null, BLUE, 'n/a'),
    field('', d.model?.display_name, MAGENTA, 'none'),
    field('effort:', d.effort?.level, DIM, 'n/a'),
    colorize('think:' + (d.thinking?.enabled ? 'on' : 'off'), DIM),
    field('token:', tok != null ? `${(tok / 1000).toFixed(1)}k` : null, DIM, 'n/a'),
    gradientBar(cw.used_percentage),
    field('session:', d.session_name, DIM, 'none'),
  ]
  return joinLine(parts)
}

export function renderLine2(d, deps) {
  const g = deps.git(d.workspace?.current_dir)
  let gitStr = ''
  if (g) {
    const status = (g.staged || g.modified) ? `+${g.staged} ~${g.modified}` : 'clean'
    const ab = `${g.ahead ? `↑${g.ahead}` : ''}${g.behind ? `↓${g.behind}` : ''}`
    gitStr = [g.branch, status, ab].filter(Boolean).join(' ')
  }
  const c = d.cost || {}
  const lines = (c.total_lines_added != null || c.total_lines_removed != null)
    ? `+${c.total_lines_added || 0} -${c.total_lines_removed || 0}`
    : ''
  const pr = d.pr ? `#${d.pr.number} ${d.pr.review_state || ''}`.trim() : ''
  const parts = [
    attr('repo:', d.workspace?.repo?.name, DIM),
    attr('worktree:', d.workspace?.git_worktree, DIM),
    gitStr ? colorize('git:' + gitStr, g.staged || g.modified ? YELLOW : GREEN) : '',
    lines ? colorize(lines, DIM) : '',
    attr('PR:', pr, YELLOW),
  ]
  return joinLine(parts)
}

export function renderLine3(d, deps) {
  const c = d.cost || {}
  const rl = d.rate_limits || {}
  const now = deps.now()
  const rlStr = (label, obj) => {
    if (!obj || obj.used_percentage == null) return ''
    const cd = obj.resets_at ? resetCountdown(obj.resets_at, now) : ''
    const val = `${Math.round(obj.used_percentage)}%${cd ? `(reset ${cd})` : ''}`
    return colorize(`${label}${val}`, tierColor(obj.used_percentage))
  }
  const parts = [
    attr('api:', c.total_api_duration_ms != null ? fmtDuration(c.total_api_duration_ms) : '', DIM),
    attr('wall:', c.total_duration_ms != null ? fmtDuration(c.total_duration_ms) : '', DIM),
    attr('cost:', c.total_cost_usd != null ? `$${c.total_cost_usd.toFixed(2)}` : '', YELLOW),
    rlStr('5h:', rl.five_hour),
    rlStr('7d:', rl.seven_day),
  ]
  return joinLine(parts)
}

export function renderLine4(d, deps) {
  const c = deps.counts(d.workspace?.project_dir || d.workspace?.current_dir)
  if (!c) return ''
  const parts = [
    attr('CLAUDE.md:', c.claudeMd, DIM),
    attr('memory:', c.memory, DIM),
    attr('mcp:', c.mcp, DIM),
    attr('agent:', c.agent, DIM),
    attr('skill:', c.skill, DIM),
    attr('hook:', c.hook, DIM),
    attr('plugin:', c.plugin, DIM),
    attr('workflow:', c.workflow, DIM),
  ]
  return joinLine(parts)
}

export function buildOutput(d, deps) {
  const lines = [renderLine1(d, deps), renderLine2(d, deps), renderLine3(d, deps), renderLine4(d, deps)]
  return lines.filter(l => l && l.length).join('\n')
}
