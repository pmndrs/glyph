import { describe, expect, it } from 'vitest'

import {
  sparklineAnimatedSampleX,
  sparklineCanvasMetrics,
  sparklineMotionProgress,
  sparklineSampleX,
  sparklineSampleY,
} from './sparkline'

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

describe('sparkline animation', () => {
  it('eases every series through the same normalized phase', () => {
    expect(sparklineMotionProgress(0, 250)).toBe(0)
    expect(sparklineMotionProgress(125, 250)).toBe(0.5)
    expect(sparklineMotionProgress(250, 250)).toBe(1)
  })

  it('slides a newly aligned row in by exactly one history slot', () => {
    expect(sparklineAnimatedSampleX(2, 4, 4, 300, 0)).toBe(300)
    expect(sparklineAnimatedSampleX(2, 4, 4, 300, 1)).toBe(200)
  })

  it('uses a fixed domain and clips missed budgets to the chart ceiling', () => {
    expect(sparklineSampleY(0, 16, 42)).toBe(40)
    expect(sparklineSampleY(8, 16, 42)).toBe(21)
    expect(sparklineSampleY(32, 16, 42)).toBe(2)
  })
})
