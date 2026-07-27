import { describe, expect, it } from 'vitest'

import { createLiveFrameTelemetry } from './live-frame-telemetry'

describe('live frame telemetry', () => {
  it('reuses fixed histories while reporting CPU, FPS, and GPU quantiles', () => {
    const telemetry = createLiveFrameTelemetry({ capacity: 3, reportIntervalMs: 1 })
    const startedAt = performance.now()
    telemetry.recordGpu(0.75)
    const first = telemetry.recordSubmit(startedAt + 10, 0.25)
    expect(first).toMatchObject({
      frameCount: 1,
      medianSubmitMs: 0.25,
      p95SubmitMs: 0.25,
      minimumSubmitMs: 0.25,
      maximumSubmitMs: 0.25,
      gpuFrameMs: 0.75,
      medianGpuMs: 0.75,
      p95GpuMs: 0.75,
      minimumGpuMs: 0.75,
      maximumGpuMs: 0.75,
      submitHistoryLength: 1,
      fpsHistoryLength: 1,
      gpuHistoryLength: 1,
    })

    telemetry.recordGpu(1.25)
    telemetry.recordSubmit(startedAt + 20, 0.5)
    telemetry.recordGpu(1)
    telemetry.recordSubmit(startedAt + 30, 0.75)
    telemetry.recordGpu(1.5)
    const wrapped = telemetry.recordSubmit(startedAt + 40, 1)
    expect(wrapped).toMatchObject({
      frameCount: 4,
      medianSubmitMs: 0.75,
      p95SubmitMs: 1,
      minimumSubmitMs: 0.5,
      maximumSubmitMs: 1,
      medianGpuMs: 1.25,
      p95GpuMs: 1.5,
      minimumGpuMs: 1,
      maximumGpuMs: 1.5,
      submitHistoryLength: 3,
      fpsHistoryLength: 3,
      gpuHistoryLength: 3,
    })
    expect(wrapped?.submitHistory).toBe(first?.submitHistory)
    expect(wrapped?.fpsHistory).toBe(first?.fpsHistory)
    expect(wrapped?.gpuHistory).toBe(first?.gpuHistory)
    expect(wrapped?.submitHistoryCursor).toBe(first?.submitHistoryCursor)
    expect(wrapped?.submitHistoryCursor).toEqual({ length: 3, nextIndex: 1 })
    expect(wrapped?.gpuHistoryCursor).toBe(first?.gpuHistoryCursor)
    expect(wrapped?.minimumFramesPerSecond).toBeLessThanOrEqual(
      wrapped?.maximumFramesPerSecond ?? 0,
    )
  })

  it('rejects invalid configuration and measurements', () => {
    expect(() => createLiveFrameTelemetry({ capacity: 0 })).toThrow(RangeError)
    expect(() => createLiveFrameTelemetry({ reportIntervalMs: Number.NaN })).toThrow(RangeError)
    const telemetry = createLiveFrameTelemetry()
    expect(() => telemetry.recordGpu(-1)).toThrow(RangeError)
    expect(() => telemetry.recordSubmit(Number.NaN, 1)).toThrow(RangeError)
    expect(() => telemetry.recordSubmit(performance.now(), -1)).toThrow(RangeError)
  })

  it('advances the shared RAF cursor between React-facing reports', () => {
    const telemetry = createLiveFrameTelemetry({ capacity: 4, reportIntervalMs: 1_000 })
    const startedAt = performance.now()
    const reported = telemetry.recordSubmit(startedAt + 1_000, 0.25)
    expect(reported?.submitHistoryCursor).toEqual({ length: 1, nextIndex: 1 })
    expect(telemetry.recordSubmit(startedAt + 1_001, 0.5)).toBeUndefined()
    expect(reported?.submitHistoryCursor).toEqual({ length: 2, nextIndex: 2 })
    expect(reported?.submitHistory[1]).toBe(0.5)
  })
})
