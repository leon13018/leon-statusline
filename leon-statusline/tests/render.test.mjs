import { describe, it, expect } from 'vitest'
import { renderLine2, renderLine3, renderLine4, buildOutput } from '../src/render.mjs'

const strip = s => s.replace(/\x1b\[[0-9;]*m/g, '')

const deps = {
  home: '/home/leon',
  now: () => 1000,
  git: () => ({ branch: 'main', staged: 2, modified: 1, ahead: 1, behind: 0 }),
  counts: () => ({ claudeMd: 7, memory: 5, mcp: 3, agent: 1, skill: 2, hook: 13, plugin: 2, workflow: 1 }),
}

describe('renderLine2 (conditional)', () => {
  it('hides absent repo/worktree/PR, shows git + lines', () => {
    const d = { cost: { total_lines_added: 156, total_lines_removed: 23 } }
    const out = strip(renderLine2(d, deps))
    expect(out).toContain('git:main +2 ~1 ↑1')
    expect(out).toContain('+156 -23')
    expect(out).not.toContain('repo:')
    expect(out).not.toContain('PR:')
  })
})

describe('renderLine3', () => {
  it('hides rate limits when absent; api <1m', () => {
    const d = { cost: { total_api_duration_ms: 3000, total_duration_ms: 14 * 60000, total_cost_usd: 0.42 } }
    const out = strip(renderLine3(d, deps))
    expect(out).toContain('api:<1m')
    expect(out).toContain('wall:14m')
    expect(out).toContain('cost:$0.42')
    expect(out).not.toContain('5h:')
  })
  it('shows rate limits with countdown for Pro/Max', () => {
    const d = { rate_limits: { five_hour: { used_percentage: 24, resets_at: 1000 + 3600 + 23 * 60 } } }
    const out = strip(renderLine3(d, deps))
    expect(out).toContain('5h:24%(reset 1h23m)')
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
