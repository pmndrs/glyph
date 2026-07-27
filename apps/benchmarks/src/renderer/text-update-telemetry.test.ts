import { describe, expect, it } from 'vitest'

import { createTextUpdateTelemetry } from './text-update-telemetry'

describe('text update telemetry', () => {
  it('summarizes committed update phases without recording frame allocations', () => {
    const telemetry = createTextUpdateTelemetry()
    telemetry.record({
      scheduleMs: 1,
      readyMs: 2,
      sceneMs: 3,
      totalMs: 6,
    })
    telemetry.record({
      scheduleMs: 2,
      readyMs: 4,
      sceneMs: 6,
      totalMs: 12,
    })

    expect(telemetry.summary()).toEqual({
      sampleCount: 2,
      medianScheduleMs: 1,
      medianReadyMs: 2,
      medianSceneMs: 3,
      medianTotalMs: 6,
      p95ScheduleMs: 2,
      p95ReadyMs: 4,
      p95SceneMs: 6,
      p95TotalMs: 12,
    })
  })
})
