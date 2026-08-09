import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readdirSync, mkdirSync, readFileSync } from 'node:fs'
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
  it('覆寫既有檔：讀回最新值且不留暫存檔', () => {
    writeSharedState('s', { t: 1 }, dir)
    writeSharedState('s', { t: 2 }, dir)
    expect(readSharedState('s', dir)).toEqual({ t: 2 })
    expect(readdirSync(dir)).toEqual(['s.json'])
  })
  it('name 不得跳出目錄（路徑穿越）', () => {
    const inner = join(dir, 'inner')
    mkdirSync(inner)
    writeFileSync(join(dir, 'victim.json'), '{"original":true}')
    // 讀：不得讀到 inner 之外的檔（須在下面那筆寫入之前斷言，否則會讀到 inner 內同名的清洗後檔案）
    expect(readSharedState('../victim', inner)).toBe(null)
    // 寫：不得覆寫 inner 之外的檔
    writeSharedState('../victim', { PWNED: true }, inner)
    expect(JSON.parse(readFileSync(join(dir, 'victim.json'), 'utf8'))).toEqual({ original: true })
    expect(readdirSync(dir).sort()).toEqual(['inner', 'victim.json'])
  })
})
