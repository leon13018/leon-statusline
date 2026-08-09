import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withCache, readSharedState, writeSharedState } from '../src/cache.mjs'

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

describe('shared state', () => {
  it('寫入後可讀回', () => {
    writeSharedState('runaway-state', { t: 1, procs: { 9: { name: 'a', cpu: 2, streak: 3 } } }, dir)
    expect(readSharedState('runaway-state', dir)).toEqual({ t: 1, procs: { 9: { name: 'a', cpu: 2, streak: 3 } } })
  })
  it('缺檔 → null', () => {
    expect(readSharedState('nope', dir)).toBe(null)
  })
  it('壞 JSON → null', () => {
    writeFileSync(join(dir, 'broken.json'), '{ not json')
    expect(readSharedState('broken', dir)).toBe(null)
  })
  it('寫入失敗不拋（目錄不存在）', () => {
    expect(() => writeSharedState('x', { a: 1 }, join(dir, 'no-such-dir'))).not.toThrow()
  })
  it('不留下暫存檔', () => {
    writeSharedState('runaway-state', { t: 1 }, dir)
    expect(readdirSync(dir).filter(f => f.endsWith('.tmp'))).toEqual([])
  })
})
