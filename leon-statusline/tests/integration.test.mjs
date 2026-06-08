import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join, dirname } from 'node:path'

const entry = join(dirname(fileURLToPath(import.meta.url)), '..', 'statusline.mjs')
const run = stdin => spawnSync('node', [entry], { input: stdin, encoding: 'utf8' })

describe('statusline entry (never crash)', () => {
  it('valid input -> exit 0, non-empty', () => {
    const r = run(JSON.stringify({ model: { display_name: 'Opus' }, workspace: { current_dir: '/tmp/x' } }))
    expect(r.status).toBe(0)
    expect(r.stdout.length).toBeGreaterThan(0)
  })
  it('empty input -> exit 0', () => {
    const r = run('')
    expect(r.status).toBe(0)
  })
  it('garbage input -> exit 0', () => {
    const r = run('}{not json')
    expect(r.status).toBe(0)
  })
})
