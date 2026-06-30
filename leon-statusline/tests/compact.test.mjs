import { describe, it, expect } from 'vitest'
import { autoCompactThreshold, autoCompactPct, autoCompactWindow, DEFAULT_AUTOCOMPACT_PCT } from '../src/compact.mjs'

describe('autoCompactThreshold', () => {
  it('uses env override when valid', () => {
    expect(autoCompactThreshold({ CLAUDE_CODE_AUTOCOMPACT_PCT_OVERRIDE: '80' })).toBe(80)
  })
  it('falls back to 95 for invalid / out-of-range / unset', () => {
    expect(autoCompactThreshold({ CLAUDE_CODE_AUTOCOMPACT_PCT_OVERRIDE: '0' })).toBe(95)
    expect(autoCompactThreshold({ CLAUDE_CODE_AUTOCOMPACT_PCT_OVERRIDE: '150' })).toBe(95)
    expect(autoCompactThreshold({ CLAUDE_CODE_AUTOCOMPACT_PCT_OVERRIDE: 'abc' })).toBe(95)
    expect(autoCompactThreshold({})).toBe(95)
    expect(DEFAULT_AUTOCOMPACT_PCT).toBe(95)
  })
})

describe('autoCompactPct', () => {
  it('token 路徑：usedTokens ÷ window', () => {
    expect(autoCompactPct({ usedTokens: 250000, window: 500000 })).toBe(50)
    expect(autoCompactPct({ usedTokens: 95689, window: 1000000 })).toBeCloseTo(9.5689, 4)
  })
  it('token 路徑夾 0–100', () => {
    expect(autoCompactPct({ usedTokens: 600000, window: 500000 })).toBe(100) // usedTokens > window
    expect(autoCompactPct({ usedTokens: -5, window: 500000 })).toBe(0)
  })
  it('無有效 window → 近似 usedPercentage ÷ threshold', () => {
    expect(autoCompactPct({ usedPercentage: 47.5, threshold: 95 })).toBe(50)
    expect(autoCompactPct({ usedPercentage: 0, threshold: 95 })).toBe(0)
    expect(autoCompactPct({ usedPercentage: 47.5, window: 0, threshold: 95 })).toBe(50) // window 0 無效
    expect(autoCompactPct({ usedPercentage: 120, threshold: 95 })).toBe(100)
  })
  it('window 在但 usedTokens 缺 → 走近似', () => {
    expect(autoCompactPct({ usedPercentage: 47.5, window: 500000, threshold: 95 })).toBe(50)
  })
  it('兩者皆缺 → null', () => {
    expect(autoCompactPct({})).toBe(null)
    expect(autoCompactPct({ usedPercentage: null, threshold: 95 })).toBe(null)
    expect(autoCompactPct()).toBe(null)
  })
})

describe('autoCompactWindow', () => {
  it('取第一個有效正數視窗', () => {
    expect(autoCompactWindow([{ autoCompactWindow: 500000 }])).toBe(500000)
    expect(autoCompactWindow([{}, { autoCompactWindow: 1000000 }])).toBe(1000000)
    expect(autoCompactWindow([{ autoCompactWindow: 0 }, { autoCompactWindow: 800000 }])).toBe(800000)
  })
  it('跳過 null/0/負/NaN/非數字；全無 → null', () => {
    expect(autoCompactWindow([{ autoCompactWindow: 0 }])).toBe(null)
    expect(autoCompactWindow([{ autoCompactWindow: -1 }])).toBe(null)
    expect(autoCompactWindow([{ autoCompactWindow: 'big' }])).toBe(null)
    expect(autoCompactWindow([null, undefined, {}])).toBe(null)
    expect(autoCompactWindow([])).toBe(null)
    expect(autoCompactWindow()).toBe(null)
  })
})
