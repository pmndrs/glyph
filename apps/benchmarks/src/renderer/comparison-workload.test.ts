import { describe, expect, it } from 'vitest'

import { ladderDeviceSizes, paintWordHue } from './comparison-workload'

describe('text ladder scale selection', () => {
  it('fills a tall viewport with the complete ordered scale', () => {
    expect(ladderDeviceSizes(1_700, 1)).toEqual([
      8, 10, 12, 14, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128, 160, 192, 256, 512,
    ])
  })

  it('keeps the complete physical range on a small viewport and at both DPRs', () => {
    expect(ladderDeviceSizes(360, 1)).toEqual(ladderDeviceSizes(360, 2))
    expect(ladderDeviceSizes(360, 1).at(0)).toBe(8)
    expect(ladderDeviceSizes(360, 1).at(-1)).toBe(512)
  })

  it('rejects invalid physical viewport inputs', () => {
    expect(() => ladderDeviceSizes(0, 1)).toThrow('text ladder viewport height must be positive')
    expect(() => ladderDeviceSizes(360, 0)).toThrow('text ladder DPR must be positive')
  })
})

describe('paint word hue sequence', () => {
  it('gives adjacent words equal positive offsets around one circular sequence', () => {
    const hues = Array.from({ length: 8 }, (_, index) => paintWordHue(index, 8, 0, 50))
    const unwrapped = hues.map((hue, index) => hue + (index >= 7 ? 1 : 0))
    const offsets = unwrapped.slice(1).map((hue, index) => hue - unwrapped[index]!)
    expect(offsets.every((offset) => Math.abs(offset - offsets[0]!) < 1e-12)).toBe(true)
    expect(offsets[0]).toBeGreaterThan(0)
  })

  it('moves every word by the same shared phase', () => {
    const before = Array.from({ length: 5 }, (_, index) => paintWordHue(index, 5, 0.1, 25))
    const after = Array.from({ length: 5 }, (_, index) => paintWordHue(index, 5, 0.2, 25))
    expect(
      after.every((hue, index) => Math.abs(((hue - before[index]! + 1) % 1) - 0.1) < 1e-12),
    ).toBe(true)
  })
})
