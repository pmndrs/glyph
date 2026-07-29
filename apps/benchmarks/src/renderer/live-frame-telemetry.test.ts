import { describe, expect, it } from 'vitest';

import {
  createLiveFrameTelemetry,
  type LiveFrameTelemetry,
  type LiveFrameTelemetrySnapshot,
} from './live-frame-telemetry';

describe('live frame telemetry', () => {
  it('publishes CPU, FPS, and delayed GPU timing through one shared cursor', () => {
    const telemetry = createLiveFrameTelemetry({
      capacity: 3,
      refreshRateHz: 60,
      reportIntervalMs: 5,
    });
    const startedAt = performance.now();
    const first = recordGpuSample(telemetry, startedAt + 10, 0.25, 0.75);
    expect(first).toMatchObject({
      frameCount: 1,
      refreshRateHz: 60,
      frameBudgetMs: 1_000 / 60,
      medianSubmitMs: 0.25,
      gpuFrameMs: 0.75,
      submitHistoryLength: 1,
      fpsHistoryLength: 1,
      gpuHistoryLength: 1,
    });
    expect(first.submitHistoryCursor).toBe(first.fpsHistoryCursor);
    expect(first.submitHistoryCursor).toBe(first.gpuHistoryCursor);

    recordGpuSample(telemetry, startedAt + 20, 0.5, 1.25);
    recordGpuSample(telemetry, startedAt + 30, 0.75, 1);
    const wrapped = recordGpuSample(telemetry, startedAt + 40, 1, 1.5);
    expect(wrapped).toMatchObject({
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
    });
    expect(wrapped.submitHistory).toBe(first.submitHistory);
    expect(wrapped.fpsHistory).toBe(first.fpsHistory);
    expect(wrapped.gpuHistory).toBe(first.gpuHistory);
    expect(wrapped.submitHistoryCursor).toEqual({ length: 3, nextIndex: 1 });
  });

  it('waits for the exact delayed GPU frame and discards stale identities', () => {
    const telemetry = createLiveFrameTelemetry({ reportIntervalMs: 1 });
    const token = telemetry.beginFrame(performance.now() + 10);
    expect(token.measureGpu).toBe(true);
    expect(telemetry.endFrame(token, 0.5)).toBeUndefined();
    expect(telemetry.recordGpu(token.frameId + 1, 2)).toBe(false);
    expect(telemetry.beginFrame(performance.now() + 20).snapshot).toBeUndefined();
    expect(telemetry.recordGpu(token.frameId, 0.75)).toBe(true);
    const published = telemetry.beginFrame(performance.now() + 30).snapshot;
    expect(published?.gpuFrameMs).toBe(0.75);
    expect(telemetry.discardGpu(token.frameId)).toBe(false);
  });

  it('publishes aligned CPU/FPS rows without GPU timing', () => {
    const telemetry = createLiveFrameTelemetry({
      gpuTimingSupported: false,
      reportIntervalMs: 1,
    });
    const token = telemetry.beginFrame(performance.now() + 10);
    expect(token.measureGpu).toBe(false);
    const published = telemetry.endFrame(token, 0.5);
    expect(published).toMatchObject({
      gpuFrameMs: undefined,
      gpuHistoryLength: 0,
      submitHistoryLength: 1,
      fpsHistoryLength: 1,
    });
    expect(Number.isNaN(published?.gpuHistory[0])).toBe(true);
  });

  it('uses a monotonic observed refresh-rate high water when no API value exists', () => {
    const telemetry = createLiveFrameTelemetry({ gpuTimingSupported: false, reportIntervalMs: 5 });
    const startedAt = performance.now();
    const first = recordCpuSample(telemetry, startedAt + 10, 0.5);
    const second = recordCpuSample(telemetry, startedAt + 30, 0.5);
    expect(second.refreshRateHz).toBe(first.refreshRateHz);
    expect(second.frameBudgetMs).toBe(1_000 / first.refreshRateHz);
  });

  it('rejects invalid configuration and measurements', () => {
    expect(() => createLiveFrameTelemetry({ capacity: 0 })).toThrow(RangeError);
    expect(() => createLiveFrameTelemetry({ reportIntervalMs: Number.NaN })).toThrow(RangeError);
    expect(() => createLiveFrameTelemetry({ refreshRateHz: 0 })).toThrow(RangeError);
    const telemetry = createLiveFrameTelemetry({ reportIntervalMs: 1 });
    expect(() => telemetry.beginFrame(Number.NaN)).toThrow(RangeError);
    const token = telemetry.beginFrame(performance.now() + 10);
    expect(() => telemetry.endFrame(token, -1)).toThrow(RangeError);
    expect(() => telemetry.recordGpu(0, 1)).toThrow(RangeError);
    expect(() => telemetry.recordGpu(token.frameId, -1)).toThrow(RangeError);
    expect(() => telemetry.discardGpu(0)).toThrow(RangeError);
  });
});

function recordGpuSample(
  telemetry: LiveFrameTelemetry,
  timestamp: number,
  submitMs: number,
  gpuMs: number,
): LiveFrameTelemetrySnapshot {
  const token = telemetry.beginFrame(timestamp);
  if (!token.measureGpu) throw new Error('expected a GPU sample');
  telemetry.endFrame(token, submitMs);
  telemetry.recordGpu(token.frameId, gpuMs);
  const published = telemetry.beginFrame(timestamp + 0.1).snapshot;
  if (published === undefined) throw new Error('GPU sample did not publish');
  return published;
}

function recordCpuSample(
  telemetry: LiveFrameTelemetry,
  timestamp: number,
  submitMs: number,
): LiveFrameTelemetrySnapshot {
  const token = telemetry.beginFrame(timestamp);
  const published = telemetry.endFrame(token, submitMs);
  if (published === undefined) throw new Error('CPU sample did not publish');
  return published;
}
