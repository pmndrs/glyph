import { describe, expect, it } from 'vitest'

import {
  comparisonWorkloadUpdateKind,
  ladderCssSizes,
  paintWordHue,
  type ComparisonWorkloadConfiguration,
} from './comparison-workload'

const baseConfiguration: ComparisonWorkloadConfiguration = {
  amount: 50,
  animationEnabled: true,
  animationSpeed: 50,
  fontFixture: 'inter',
  fontSize: 20,
  layoutWidthRatio: 0.8,
  paintOpacity: 1,
  paintShadowEnabled: true,
  paintStrokeWidth: 0.5,
  showGrid: true,
  showLayoutBounds: true,
  workload: 'paint-effects',
}

describe('comparison workload updates', () => {
  it('retains the scene for animation and paint controls', () => {
    for (const update of [
      { animationEnabled: false },
      { animationSpeed: 75 },
      { amount: 80 },
      { paintOpacity: 0.5 },
      { paintShadowEnabled: false },
      { paintStrokeWidth: 0.75 },
      { showGrid: false },
      { showLayoutBounds: false },
    ] satisfies readonly Partial<ComparisonWorkloadConfiguration>[]) {
      expect(
        comparisonWorkloadUpdateKind(baseConfiguration, { ...baseConfiguration, ...update }),
      ).toBe('retained')
    }
  })

  it('rebuilds only for dimensions that change text layout', () => {
    expect(
      comparisonWorkloadUpdateKind(baseConfiguration, { ...baseConfiguration, fontSize: 32 }),
    ).toBe('rebuild')
    expect(
      comparisonWorkloadUpdateKind(baseConfiguration, {
        ...baseConfiguration,
        layoutWidthRatio: 0.6,
      }),
    ).toBe('rebuild')
    expect(comparisonWorkloadUpdateKind(baseConfiguration, baseConfiguration, true)).toBe('rebuild')
  })
})

describe('text ladder scale selection', () => {
  it('fills a tall viewport with the complete ordered scale', () => {
    expect(ladderCssSizes(1_700)).toEqual([
      8, 10, 12, 14, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128, 160, 192, 256, 512,
    ])
  })

  it('keeps the complete CSS-pixel range on a small viewport', () => {
    expect(ladderCssSizes(360).at(0)).toBe(8)
    expect(ladderCssSizes(360).at(-1)).toBe(512)
  })

  it('rejects invalid viewport inputs', () => {
    expect(() => ladderCssSizes(0)).toThrow('text ladder viewport height must be positive')
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
