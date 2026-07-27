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
      gpuFrameMs: 0.75,
      medianGpuMs: 0.75,
      p95GpuMs: 0.75,
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
      medianGpuMs: 1.25,
      p95GpuMs: 1.5,
      submitHistoryLength: 3,
      fpsHistoryLength: 3,
      gpuHistoryLength: 3,
    })
    expect(wrapped?.submitHistory).toBe(first?.submitHistory)
    expect(wrapped?.fpsHistory).toBe(first?.fpsHistory)
    expect(wrapped?.gpuHistory).toBe(first?.gpuHistory)
  })

  it('rejects invalid configuration and measurements', () => {
    expect(() => createLiveFrameTelemetry({ capacity: 0 })).toThrow(RangeError)
    expect(() => createLiveFrameTelemetry({ reportIntervalMs: Number.NaN })).toThrow(RangeError)
    const telemetry = createLiveFrameTelemetry()
    expect(() => telemetry.recordGpu(-1)).toThrow(RangeError)
    expect(() => telemetry.recordSubmit(Number.NaN, 1)).toThrow(RangeError)
    expect(() => telemetry.recordSubmit(performance.now(), -1)).toThrow(RangeError)
  })
})
