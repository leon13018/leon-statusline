import { describe, it, expect } from 'vitest'
import { parseInput } from '../src/input.mjs'

describe('parseInput', () => {
  it('parses valid json', () => expect(parseInput('{"a":1}')).toEqual({ a: 1 }))
  it('bad json -> {}', () => expect(parseInput('not json')).toEqual({}))
  it('empty -> {}', () => expect(parseInput('')).toEqual({}))
})
