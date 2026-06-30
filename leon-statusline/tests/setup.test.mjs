import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { targetPath, mergeStatusLine, applySetup, isOurs, applySync } from '../setup.mjs'

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

describe('isOurs', () => {
  it('true for leon-statusline plugin path', () =>
    expect(isOurs('node "/x/plugins/cache/leon-statusline-marketplace/leon-statusline/1.0.0/statusline.mjs"')).toBe(true))
  it('false for unrelated command', () =>
    expect(isOurs('node "/home/me/custom.sh"')).toBe(false))
  it('false for null', () => expect(isOurs(null)).toBe(false))
})

describe('applySync', () => {
  it('updates when ours and stale, backs up, preserves keys', () => {
    const f = join(dir, 'settings.json')
    writeFileSync(f, JSON.stringify({
      keep: 1,
      statusLine: { type: 'command', command: 'node "/p/leon-statusline/1.0.0/statusline.mjs"', refreshInterval: 10 },
    }))
    const desired = 'node "/p/leon-statusline/1.1.0/statusline.mjs"'
    const r = applySync(f, desired)
    expect(r.updated).toBe(true)
    expect(existsSync(r.backup)).toBe(true)
    const after = JSON.parse(readFileSync(f, 'utf8'))
    expect(after.statusLine.command).toBe(desired)
    expect(after.statusLine.refreshInterval).toBe(10)
    expect(after.keep).toBe(1)
  })
  it('no-op when already current', () => {
    const f = join(dir, 'settings.json')
    const desired = 'node "/p/leon-statusline/1.1.0/statusline.mjs"'
    writeFileSync(f, JSON.stringify({ statusLine: { type: 'command', command: desired } }))
    expect(applySync(f, desired).updated).toBe(false)
  })
  it('no-op when statusLine is not ours', () => {
    const f = join(dir, 'settings.json')
    writeFileSync(f, JSON.stringify({ statusLine: { type: 'command', command: 'node "/home/me/custom.mjs"' } }))
    expect(applySync(f, 'node "/p/leon-statusline/1.1.0/statusline.mjs"').updated).toBe(false)
    expect(JSON.parse(readFileSync(f, 'utf8')).statusLine.command).toBe('node "/home/me/custom.mjs"')
  })
  it('no-op when no statusLine / missing file', () => {
    const f = join(dir, 'settings.json')
    writeFileSync(f, JSON.stringify({ other: 1 }))
    expect(applySync(f, 'node x').updated).toBe(false)
    expect(applySync(join(dir, 'nope.json'), 'node x').updated).toBe(false)
  })
  it('status repointed with from/to when ours and stale', () => {
    const f = join(dir, 'settings.json')
    const oldCmd = 'node "/p/leon-statusline/1.0.0/statusline.mjs"'
    writeFileSync(f, JSON.stringify({ statusLine: { type: 'command', command: oldCmd } }))
    const desired = 'node "/p/leon-statusline/1.1.0/statusline.mjs"'
    const r = applySync(f, desired)
    expect(r.status).toBe('repointed')
    expect(r.from).toBe(oldCmd)
    expect(r.to).toBe(desired)
  })
  it('status current when already pointing at desired', () => {
    const f = join(dir, 'settings.json')
    const desired = 'node "/p/leon-statusline/1.1.0/statusline.mjs"'
    writeFileSync(f, JSON.stringify({ statusLine: { command: desired } }))
    expect(applySync(f, desired).status).toBe('current')
  })
  it('status foreign when statusLine not ours', () => {
    const f = join(dir, 'settings.json')
    writeFileSync(f, JSON.stringify({ statusLine: { command: 'node "/home/me/custom.mjs"' } }))
    expect(applySync(f, 'node "/p/leon-statusline/1.1.0/statusline.mjs"').status).toBe('foreign')
  })
  it('status absent when file missing', () => {
    expect(applySync(join(dir, 'nope.json'), 'node x').status).toBe('absent')
  })
})
