import { attr, joinLine, fmtDuration, resetCountdown, shortPath } from './format.mjs'
import { gradientBar, colorize } from './color.mjs'
import { autoCompactPct } from './compact.mjs'

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
    colorize('compact', DIM) + ' ' + gradientBar(autoCompactPct({
      usedTokens: cw.total_input_tokens,
      usedPercentage: cw.used_percentage,
      window: deps.autoCompactWindow,
      threshold: deps.autoCompactThreshold,
    })),
    field('session:', d.session_name, DIM, 'none'),
  ]
  return joinLine(parts)
}

export function renderLine2(d, deps) {
  const g = deps.git(d.workspace?.current_dir)
  let gitPart
  if (g) {
    const status = (g.staged || g.modified) ? `+${g.staged} ~${g.modified}` : 'clean'
    const ab = `${g.ahead ? `↑${g.ahead}` : ''}${g.behind ? `↓${g.behind}` : ''}`
    const gitStr = [g.branch, status, ab].filter(Boolean).join(' ')
    gitPart = colorize('git:' + gitStr, (g.staged || g.modified) ? YELLOW : GREEN)
  } else {
    gitPart = colorize('git:none', DIM)
  }
  const c = d.cost || {}
  const linesPart = (c.total_lines_added != null || c.total_lines_removed != null)
    ? colorize(`+${c.total_lines_added || 0} -${c.total_lines_removed || 0}`, DIM)
    : colorize('n/a', DIM)
  const pr = d.pr ? `#${d.pr.number} ${d.pr.review_state || ''}`.trim() : null
  const parts = [
    field('repo:', d.workspace?.repo?.name, DIM, 'none'),
    field('worktree:', d.workspace?.git_worktree, DIM, 'none'),
    gitPart,
    linesPart,
    field('PR:', pr, YELLOW, 'none'),
  ]
  return joinLine(parts)
}

export function renderLine3(d, deps) {
  const c = d.cost || {}
  const rl = d.rate_limits || {}
  const now = deps.now()
  const rlPart = (label, obj) => {
    if (!obj || obj.used_percentage == null) return colorize(`${label}n/a`, DIM)
    const cd = obj.resets_at ? resetCountdown(obj.resets_at, now) : ''
    const val = `${Math.round(obj.used_percentage)}%${cd ? `(reset ${cd})` : ''}`
    return colorize(`${label}${val}`, tierColor(obj.used_percentage))
  }
  const parts = [
    field('api:', c.total_api_duration_ms != null ? fmtDuration(c.total_api_duration_ms) : null, DIM, 'n/a'),
    field('wall:', c.total_duration_ms != null ? fmtDuration(c.total_duration_ms) : null, DIM, 'n/a'),
    field('cost:', c.total_cost_usd != null ? `$${c.total_cost_usd.toFixed(2)}` : null, YELLOW, 'n/a'),
    rlPart('5h:', rl.five_hour),
    rlPart('7d:', rl.seven_day),
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

// flagged 的元素形狀來自磁碟狀態（節流命中時 detect 直接回吐 state.flagged，未逐列重驗），
// 損毀或被竄改時任意 JSON 垃圾都會進到這裡。畸形列一律略過而非渲染成 '?'：
// 一則「零噪音」，二則沒有 PID／名稱的警告對使用者毫無用處
// 判準刻意不重述 runaway.mjs 的 valid()：pid 放寬（不管整數／正負，印得出來就好）、
// name 收緊（空字串印出來只是噪音）。兩處差異實務上皆不可達，但別把它當成上游語義的副本。
const validFlag = f =>
  !!f && typeof f === 'object' &&
  Number.isFinite(f.pid) &&
  typeof f.name === 'string' && f.name !== '' &&
  Number.isFinite(f.rate)

// 第 5 行：僅在偵測到持續失控的行程時出現；否則回 ''，由 buildOutput 的 filter 自動略過
// 只提示，絕不提供也絕不執行任何終止行程的手段
export function renderLine5(d, deps) {
  let flagged = null
  // try 只圈住外部注入的呼叫；其餘程式碼靠 validFlag 保證不會 throw，
  // 免得自己的格式化 bug 被靜默吞掉
  try { flagged = deps.runaway ? deps.runaway() : null } catch { flagged = null }
  const rows = Array.isArray(flagged) ? flagged.filter(validFlag) : []
  if (rows.length === 0) return ''
  const shown = rows.slice(0, 2).map(f => `${f.name}(${f.pid}) ${f.rate.toFixed(2)}c`).join(', ')
  const extra = rows.length > 2 ? ` +${rows.length - 2}` : ''
  return joinLine([
    colorize(`⚠ runaway:${rows.length}`, RED),
    colorize(shown + extra, RED),
  ])
}

export function buildOutput(d, deps) {
  const lines = [renderLine1(d, deps), renderLine2(d, deps), renderLine3(d, deps), renderLine4(d, deps), renderLine5(d, deps)]
  return lines.filter(l => l && l.length).join('\n')
}
