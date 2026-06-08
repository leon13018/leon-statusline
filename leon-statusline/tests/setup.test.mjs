import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { targetPath, mergeStatusLine, applySetup } from '../setup.mjs'

let dir
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'lsls-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('targetPath', () => {
  it('user/project/local', () => {
    expect(targetPath('user', '/home/leon', '/proj')).toBe(join('/home/leon', '.claude', 'settings.json'))
    expect(targetPath('project', '/home/leon', '/proj')).toBe(join('/proj', '.claude', 'settings.json'))
    expect(targetPath('local', '/home/leon', '/proj')).toBe(join('/proj', '.claude', 'settings.local.json'))
  })
})

describe('mergeStatusLine', () => {
  it('adds statusLine, preserves other keys', () => {
    const out = mergeStatusLine({ a: 1, hooks: {} }, 'node x')
    expect(out.a).toBe(1)
    expect(out.hooks).toEqual({})
    expect(out.statusLine).toEqual({ type: 'command', command: 'node x', refreshInterval: 10 })
  })
})

describe('applySetup', () => {
  it('reports existing without writing when statusLine present and not forced', () => {
    const f = join(dir, 'settings.json')
    writeFileSync(f, JSON.stringify({ statusLine: { type: 'command', command: 'old' }, keep: 1 }))
    const r = applySetup(f, 'node new', false)
    expect(r.existing).toBe(true)
    expect(r.written).toBe(false)
    expect(JSON.parse(readFileSync(f, 'utf8')).statusLine.command).toBe('old')
  })
  it('writes + backs up when forced; preserves other keys', () => {
    const f = join(dir, 'settings.json')
    writeFileSync(f, JSON.stringify({ statusLine: { command: 'old' }, keep: 1 }))
    const r = applySetup(f, 'node new', true)
    expect(r.written).toBe(true)
    expect(existsSync(r.backup)).toBe(true)
    const after = JSON.parse(readFileSync(f, 'utf8'))
    expect(after.statusLine.command).toBe('node new')
    expect(after.keep).toBe(1)
  })
  it('creates file when absent', () => {
    const f = join(dir, 'sub', 'settings.json')
    const r = applySetup(f, 'node new', false)
    expect(r.written).toBe(true)
    expect(JSON.parse(readFileSync(f, 'utf8')).statusLine.command).toBe('node new')
  })
})
