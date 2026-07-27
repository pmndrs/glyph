import { describe, expect, it } from 'vitest'

import type { BitmapTextLiveStats } from '../renderer/bitmap-text'
import { captureLiveTextStats, snapshotCircularSeries } from './product-result'

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

  it('captures the live cursor state instead of stale published scalar aliases', () => {
    const stats = {
      technique: 'bitmap',
      submitHistory: new Float32Array([6, 7, 4, 5]),
      submitHistoryLength: 2,
      submitHistoryNextIndex: 0,
      submitHistoryCursor: { length: 4, nextIndex: 2 },
      fpsHistory: new Float32Array([60, 59, 0, 0]),
      fpsHistoryLength: 0,
      fpsHistoryNextIndex: 0,
      fpsHistoryCursor: { length: 2, nextIndex: 2 },
      gpuHistory: new Float32Array([2, 3, 1, 1.5]),
      gpuHistoryLength: 1,
      gpuHistoryNextIndex: 0,
      gpuHistoryCursor: { length: 4, nextIndex: 2 },
      medianSubmitMs: 999,
      p95SubmitMs: 999,
      minimumSubmitMs: 999,
      maximumSubmitMs: 999,
      minimumFramesPerSecond: 999,
      maximumFramesPerSecond: 999,
      gpuFrameMs: 999,
      medianGpuMs: 999,
      p95GpuMs: 999,
      minimumGpuMs: 999,
      maximumGpuMs: 999,
    } as unknown as BitmapTextLiveStats

    const capture = captureLiveTextStats(stats)

    expect(capture.submitHistory).toEqual([4, 5, 6, 7])
    expect(capture.fpsHistory).toEqual([60, 59])
    expect(capture.gpuHistory).toEqual([1, 1.5, 2, 3])
    expect(capture.medianSubmitMs).toBe(5)
    expect(capture.p95SubmitMs).toBe(7)
    expect(capture.minimumGpuMs).toBe(1)
    expect(capture.maximumGpuMs).toBe(3)
    expect('submitHistoryCursor' in capture).toBe(false)
  })
})
