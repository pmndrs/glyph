import { describe, expect, it } from 'vitest'

import { snapshotCircularSeries } from './product-result'

describe('live benchmark capture', () => {
  it('copies wrapped telemetry rings into immutable chronological arrays', () => {
    const values = new Float32Array([3, 4, 1, 2])
    const capture = snapshotCircularSeries(values, 4, 2)
    expect(capture).toEqual([1, 2, 3, 4])
    expect(snapshotCircularSeries(new Float32Array([60, 59, 0, 0]), 2, 2)).toEqual([60, 59])
    expect(snapshotCircularSeries(new Float32Array(4), 0, 0)).toEqual([])

    values.fill(99)
    expect(capture).toEqual([1, 2, 3, 4])
  })
})
