import { describe, expect, it } from 'vitest';

import { createTextUpdateTelemetry } from './text-update-telemetry';

describe('text update telemetry', () => {
  it('defers summary work until read and reuses an unchanged summary', () => {
    const telemetry = createTextUpdateTelemetry();
    const empty = telemetry.summary();

    telemetry.record(1, 2, 3, 4);
    expect(telemetry.summary()).toEqual({
      sampleCount: 1,
      medianScheduleMs: 1,
      medianReadyMs: 2,
      medianSceneMs: 3,
      medianTotalMs: 4,
      p95ScheduleMs: 1,
      p95ReadyMs: 2,
      p95SceneMs: 3,
      p95TotalMs: 4,
    });
    const current = telemetry.summary();
    expect(telemetry.summary()).toBe(current);
    expect(current).not.toBe(empty);
  });

  it('reports nearest-rank quantiles from the retained 64-sample window', () => {
    const telemetry = createTextUpdateTelemetry();
    for (let value = 1; value <= 70; value += 1) telemetry.record(value, value * 2, value * 3, value * 4);

    expect(telemetry.summary()).toEqual({
      sampleCount: 64,
      medianScheduleMs: 38,
      medianReadyMs: 76,
      medianSceneMs: 114,
      medianTotalMs: 152,
      p95ScheduleMs: 67,
      p95ReadyMs: 134,
      p95SceneMs: 201,
      p95TotalMs: 268,
    });
  });
});
