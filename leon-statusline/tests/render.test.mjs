import { describe, it, expect } from 'vitest'
import { renderLine1, renderLine2, renderLine3, renderLine4, buildOutput } from '../src/render.mjs'

const strip = s => s.replace(/\x1b\[[0-9;]*m/g, '')

const deps = {
  home: '/home/leon',
  now: () => 1000,
  git: () => ({ branch: 'main', staged: 2, modified: 1, ahead: 1, behind: 0 }),
  counts: () => ({ claudeMd: 7, memory: 5, mcp: 3, agent: 1, skill: 2, hook: 13, plugin: 2, workflow: 1 }),
}

const DIM = '\x1b[38;2;130;130;130m'

describe('renderLine1 (never hide)', () => {
  it('empty d -> 佔位（沒抓到）', () => {
    const raw = renderLine1({}, deps)
    const out = strip(raw)
    expect(out).toContain('none')          // model
    expect(out).toContain('effort:n/a')
    expect(out).toContain('think:off')
    expect(out).toContain('token:n/a')
    expect(out).toContain('session:none')
    expect(out).toContain('n/a')           // bar / dir 佔位
    expect(raw).toContain(DIM + 'effort:n/a')   // 佔位是 DIM
    expect(raw).toContain(DIM + 'session:none')
  })
  it('真 0 token & pct -> 真值，非 n/a', () => {
    const d = { context_window: { total_input_tokens: 0, used_percentage: 0 } }
    const out = strip(renderLine1(d, deps))
    expect(out).toContain('token:0.0k')
    expect(out).toContain('0%')
    expect(out).not.toContain('token:n/a')
  })
})

describe('renderLine2 (never hide)', () => {
  it('absent repo/worktree/PR -> none；git + lines 真值', () => {
    const d = { cost: { total_lines_added: 156, total_lines_removed: 23 } }
    const raw = renderLine2(d, deps)
    const out = strip(raw)
    expect(out).toContain('git:main +2 ~1 ↑1')
    expect(out).toContain('+156 -23')
    expect(out).toContain('repo:none')
    expect(out).toContain('worktree:none')
    expect(out).toContain('PR:none')
    expect(raw).toContain(DIM + 'repo:none')
  })
  it('不在 git repo -> git:none (DIM)', () => {
    const noGit = { ...deps, git: () => null }
    const raw = renderLine2({}, noGit)
    expect(strip(raw)).toContain('git:none')
    expect(raw).toContain(DIM + 'git:none')
  })
  it('無 cost -> 增刪行 n/a（沒抓到）', () => {
    expect(strip(renderLine2({}, deps))).toContain('n/a')
  })
})

describe('renderLine3 (never hide)', () => {
  it('absent rate -> 5h/7d n/a；api/wall/cost 真值', () => {
    const d = { cost: { total_api_duration_ms: 3000, total_duration_ms: 14 * 60000, total_cost_usd: 0.42 } }
    const out = strip(renderLine3(d, deps))
    expect(out).toContain('api:<1m')
    expect(out).toContain('wall:14m')
    expect(out).toContain('cost:$0.42')
    expect(out).toContain('5h:n/a')
    expect(out).toContain('7d:n/a')
  })
  it('Pro/Max rate 帶倒數', () => {
    const d = { rate_limits: { five_hour: { used_percentage: 24, resets_at: 1000 + 3600 + 23 * 60 } } }
    expect(strip(renderLine3(d, deps))).toContain('5h:24%(reset 1h23m)')
  })
  it('無 cost -> api/wall/cost n/a（沒抓到）', () => {
    const out = strip(renderLine3({}, deps))
    expect(out).toContain('api:n/a')
    expect(out).toContain('wall:n/a')
    expect(out).toContain('cost:n/a')
  })
  it('真 0% rate -> 0%，非 n/a', () => {
    const d = { rate_limits: { five_hour: { used_percentage: 0, resets_at: 1000 + 60 } } }
    const out = strip(renderLine3(d, deps))
    expect(out).toContain('5h:0%')
    expect(out).not.toContain('5h:n/a')
  })
})

describe('renderLine4', () => {
  it('renders all counts with labels', () => {
    const out = strip(renderLine4({ workspace: { project_dir: '/p' } }, deps))
    expect(out).toContain('CLAUDE.md:7')
    expect(out).toContain('workflow:1')
  })
})

describe('buildOutput', () => {
  it('drops fully-empty lines, joins with newline', () => {
    const out = buildOutput({ model: { display_name: 'Opus' }, workspace: { current_dir: '/home/leon/p' } }, deps)
    const lines = strip(out).split('\n')
    expect(lines[0]).toContain('Opus')
    expect(lines.every(l => l.length > 0)).toBe(true)
  })
})
