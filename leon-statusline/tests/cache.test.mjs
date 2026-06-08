import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withCache } from '../src/cache.mjs'

let dir
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'lsl-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('withCache', () => {
  it('runs fn first time, caches within ttl', () => {
    let calls = 0
    const fn = () => (++calls, 'v')
    expect(withCache('sid', 'k', 1000, fn, 5000, dir)).toBe('v')
    expect(withCache('sid', 'k', 1000, fn, 5500, dir)).toBe('v')
    expect(calls).toBe(1)
  })
  it('re-runs after ttl expires', () => {
    let calls = 0
    const fn = () => (++calls, calls)
    withCache('sid', 'k', 1000, fn, 5000, dir)
    expect(withCache('sid', 'k', 1000, fn, 7000, dir)).toBe(2)
  })
  it('fn throw -> returns last cached or null', () => {
    expect(withCache('sid', 'k', 1000, () => { throw new Error() }, 1, dir)).toBe(null)
  })
})
