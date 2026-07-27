import { describe, expect, it } from 'vitest'

import { sparklineCanvasMetrics, sparklineSampleX } from './sparkline'

describe('sparklineCanvasMetrics', () => {
  it('maps a fractional CSS box exactly onto its physical backing store', () => {
    expect(sparklineCanvasMetrics(287.5, 42, 2)).toEqual({
      backingHeight: 84,
      backingWidth: 575,
      cssHeight: 42,
      cssWidth: 287.5,
      pixelRatio: 2,
      scaleX: 2,
      scaleY: 2,
    })
  })

  it('uses the effective rounded backing-store scale instead of stretching later', () => {
    const metrics = sparklineCanvasMetrics(287.25, 41.75, 2)

    expect(metrics.backingWidth).toBe(575)
    expect(metrics.backingHeight).toBe(84)
    expect(metrics.cssWidth * metrics.scaleX).toBe(575)
    expect(metrics.cssHeight * metrics.scaleY).toBe(84)
  })
})

describe('sparklineSampleX', () => {
  it('streams partial history in from the right without rescaling its width', () => {
    expect(sparklineSampleX(0, 1, 4, 300)).toBe(300)
    expect(sparklineSampleX(0, 2, 4, 300)).toBe(200)
    expect(sparklineSampleX(1, 2, 4, 300)).toBe(300)
  })

  it('uses the full fixed domain once the history window is full', () => {
    expect(sparklineSampleX(0, 4, 4, 300)).toBe(0)
    expect(sparklineSampleX(1, 4, 4, 300)).toBe(100)
    expect(sparklineSampleX(3, 4, 4, 300)).toBe(300)
  })
})
