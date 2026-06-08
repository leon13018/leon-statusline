import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { countClaudeMd, countDirFiles, countMemory } from '../src/count.mjs'

let root
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'lslc-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

function touch(rel) {
  const f = join(root, rel)
  mkdirSync(join(f, '..'), { recursive: true })
  writeFileSync(f, '')
}

describe('countClaudeMd', () => {
  it('counts recursively, excludes node_modules/.git', () => {
    touch('CLAUDE.md'); touch('sub/CLAUDE.md')
    touch('node_modules/pkg/CLAUDE.md'); touch('.git/CLAUDE.md')
    expect(countClaudeMd(root)).toBe(2)
  })
  it('missing dir -> 0', () => expect(countClaudeMd(join(root, 'nope'))).toBe(0))
})

describe('countDirFiles', () => {
  it('counts files matching predicate', () => {
    touch('agents/a.md'); touch('agents/b.md'); touch('agents/notes.txt')
    expect(countDirFiles(join(root, 'agents'), n => n.endsWith('.md'))).toBe(2)
  })
})

describe('countMemory', () => {
  it('counts *.md including MEMORY.md', () => {
    touch('memory/MEMORY.md'); touch('memory/a.md'); touch('memory/b.txt')
    expect(countMemory(join(root, 'memory'))).toBe(2)
  })
})
