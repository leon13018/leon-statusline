import { describe, it, expect } from 'vitest'
import { colorize, gradientColor, gradientBar } from '../src/color.mjs'

const strip = s => s.replace(/\x1b\[[0-9;]*m/g, '')

describe('colorize', () => {
  it('wraps text in truecolor escape + reset', () => {
    expect(colorize('x', [1, 2, 3])).toBe('\x1b[38;2;1;2;3mx\x1b[0m')
  })
})

describe('gradientColor', () => {
  it('green at 0, red at 1', () => {
    expect(gradientColor(0)).toEqual([0, 200, 80])
    expect(gradientColor(1)).toEqual([220, 40, 40])
  })
})

describe('gradientBar', () => {
  it('null pct -> empty bar + n/a (沒抓到)', () => {
    const out = strip(gradientBar(null, 10))
    expect(out).toBe('░░░░░░░░░░ n/a')
    expect(out).not.toContain('█')
  })
  it('real 0 pct -> empty bar + 0% (讀到真 0，非 n/a)', () => {
    expect(strip(gradientBar(0, 10))).toBe('░░░░░░░░░░ 0%')
  })
  it('renders width blocks + percent suffix', () => {
    const out = strip(gradientBar(50, 10))
    expect(out.match(/█/g).length).toBe(5)
    expect(out.match(/░/g).length).toBe(5)
    expect(out.endsWith('50%')).toBe(true)
  })
  it('clamps over 100', () => {
    expect(strip(gradientBar(150, 10))).toContain('100%')
  })
})
