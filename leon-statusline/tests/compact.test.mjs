import { describe, it, expect } from 'vitest'
import { autoCompactThreshold, autoCompactPct, DEFAULT_AUTOCOMPACT_PCT } from '../src/compact.mjs'

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
  it('null / non-finite used -> null', () => {
    expect(autoCompactPct(null, 95)).toBe(null)
    expect(autoCompactPct(undefined, 95)).toBe(null)
  })
  it('scales used to threshold', () => {
    expect(autoCompactPct(47.5, 95)).toBe(50)
    expect(autoCompactPct(0, 95)).toBe(0)
  })
  it('caps at 100 when used >= threshold', () => {
    expect(autoCompactPct(95, 95)).toBe(100)
    expect(autoCompactPct(120, 95)).toBe(100)
  })
})
