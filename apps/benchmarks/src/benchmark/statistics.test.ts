import { describe, expect, it } from 'vitest'
import { median, percentile } from './statistics'

describe('benchmark statistics', () => {
  it('computes median without mutating the samples', () => {
    const values = [8, 2, 4, 6]
    expect(median(values)).toBe(5)
    expect(values).toEqual([8, 2, 4, 6])
  })

  it('uses nearest-rank percentiles', () => {
    expect(percentile([1, 2, 3, 4, 5], 0.95)).toBe(5)
    expect(percentile([], 0.95)).toBe(0)
  })
})
