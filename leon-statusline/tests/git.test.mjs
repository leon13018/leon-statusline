import { describe, it, expect } from 'vitest'
import { gitInfo } from '../src/git.mjs'

function fakeRunner(map) {
  return (args) => {
    const key = args.join(' ')
    return key in map ? map[key] : null
  }
}

describe('gitInfo', () => {
  it('not a repo -> null', () => {
    expect(gitInfo('/x', fakeRunner({}))).toBe(null)
  })
  it('parses branch, staged, modified, untracked, ahead/behind', () => {
    const r = fakeRunner({
      'rev-parse --abbrev-ref HEAD': 'main',
      'status --porcelain': 'M  a.js\n M b.js\n?? c.js',
      'rev-list --left-right --count @{u}...HEAD': '2\t1',
    })
    expect(gitInfo('/x', r)).toEqual({ branch: 'main', staged: 1, modified: 2, ahead: 1, behind: 2 })
  })
  it('clean repo, no upstream', () => {
    const r = fakeRunner({
      'rev-parse --abbrev-ref HEAD': 'main',
      'status --porcelain': '',
    })
    expect(gitInfo('/x', r)).toEqual({ branch: 'main', staged: 0, modified: 0, ahead: 0, behind: 0 })
  })
})
