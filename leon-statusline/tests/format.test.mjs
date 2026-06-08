import { describe, it, expect } from 'vitest'
import { fmtDuration, resetCountdown, shortPath, attr, joinLine } from '../src/format.mjs'

const strip = s => s.replace(/\x1b\[[0-9;]*m/g, '')

describe('fmtDuration', () => {
  it('under 1 minute -> <1m', () => expect(fmtDuration(30_000)).toBe('<1m'))
  it('minutes only', () => expect(fmtDuration(14 * 60_000)).toBe('14m'))
  it('hours+minutes', () => expect(fmtDuration((2 * 60 + 5) * 60_000)).toBe('2h5m'))
  it('days+hours+minutes', () => expect(fmtDuration(((1 * 24 + 3) * 60 + 5) * 60_000)).toBe('1d3h5m'))
  it('omits zero middle units', () => expect(fmtDuration((24 * 60 + 5) * 60_000)).toBe('1d5m'))
  it('invalid -> empty', () => expect(fmtDuration(null)).toBe(''))
})

describe('resetCountdown', () => {
  it('future -> duration', () => expect(resetCountdown(1000 + 3600 + 23 * 60, 1000)).toBe('1h23m'))
  it('past/now -> 0m', () => expect(resetCountdown(1000, 2000)).toBe('0m'))
  it('invalid -> empty', () => expect(resetCountdown(null, 1000)).toBe(''))
})

describe('shortPath', () => {
  it('replaces home with ~', () =>
    expect(shortPath('/home/leon/Desktop/Project_01', '/home/leon')).toBe('~/Desktop/Project_01'))
  it('collapses when deeper than 3 segments', () =>
    expect(shortPath('/home/leon/a/b/c/proj', '/home/leon')).toBe('~/…/c/proj'))
  it('handles windows backslashes', () =>
    expect(shortPath('C:\\Users\\leon\\Desktop\\Project_01', 'C:\\Users\\leon')).toBe('~/Desktop/Project_01'))
  it('empty -> empty', () => expect(shortPath('', '/home/leon')).toBe(''))
})

describe('attr', () => {
  it('hides when value empty/null', () => {
    expect(attr('token:', '')).toBe('')
    expect(attr('token:', null)).toBe('')
  })
  it('renders label+value, strips to plain', () => {
    expect(strip(attr('token:', '15.5k'))).toBe('token:15.5k')
  })
})

describe('joinLine', () => {
  it('drops empties and 2-space joins', () => expect(joinLine(['a', '', 'b'])).toBe('a  b'))
  it('all empty -> empty', () => expect(joinLine(['', null])).toBe(''))
})
