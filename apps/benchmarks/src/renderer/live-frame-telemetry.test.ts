import { describe, expect, it } from 'vitest';

import { createLiveFrameTelemetry } from './live-frame-telemetry';

describe('live frame telemetry', () => {
  it('reports nearest-rank statistics from the active circular window', () => {
    const telemetry = createLiveFrameTelemetry({ capacity: 4, refreshRateHz: 60, reportIntervalMs: 1 });
    const durations = [100, 100, 1, 3, 2, 4];
    let snapshot;
    for (const [index, duration] of durations.entries()) {
      const frameId = telemetry.beginFrame(index * 16);
      snapshot = telemetry.endFrame(frameId, duration);
    }

    expect(snapshot).toMatchObject({
      medianSubmitMs: 2,
      p95SubmitMs: 4,
      minimumSubmitMs: 1,
      maximumSubmitMs: 4,
      submitHistoryLength: 4,
    });
  });

  it('keeps unresolved GPU samples out of quantiles without allocating replacement histories', () => {
    const telemetry = createLiveFrameTelemetry({ capacity: 4, refreshRateHz: 60, reportIntervalMs: 1 });
    let snapshot;
    for (const [index, duration] of [8, 2, 6, 4].entries()) {
      const frameId = telemetry.beginFrame(index * 16);
      if (index % 2 === 0) telemetry.recordGpu(frameId, duration);
      snapshot = telemetry.endFrame(frameId, 1);
    }

    expect(snapshot).toMatchObject({
      medianGpuMs: 6,
      p95GpuMs: 8,
      minimumGpuMs: 6,
      maximumGpuMs: 8,
      gpuHistoryLength: 4,
    });
  });
});
