import { describe, expect, it } from 'vitest';

import { createLiveFrameTelemetry, type LiveFrameTelemetry } from './live-frame-telemetry';

describe('live frame telemetry', () => {
  it('advances timestamped CPU and FPS histories without waiting for delayed GPU timing', () => {
    const telemetry = createLiveFrameTelemetry({ capacity: 4, refreshRateHz: 60, reportIntervalMs: 100 });
    const first = recordCpuFrame(telemetry, 1_000, 0.25);
    const secondFrameId = telemetry.beginFrame(1_016);
    expect(telemetry.gpuTimingSupported).toBe(true);
    expect(telemetry.endFrame(secondFrameId, 0.5)).toBeUndefined();
    const thirdFrameId = telemetry.beginFrame(1_032);
    telemetry.endFrame(thirdFrameId, 0.75);

    expect(first.submitHistoryCursor).toEqual({ length: 3, nextIndex: 3 });
    expect([...first.frameTimestampHistory.slice(0, 3)]).toEqual([1_000, 1_016, 1_032]);
    expect([...first.submitHistory.slice(0, 3)]).toEqual([0.25, 0.5, 0.75]);
    expect(first.fpsHistory[1]).toBeCloseTo(62.5);
    expect(Number.isNaN(first.gpuHistory[0])).toBe(true);
  });

  it('backfills delayed GPU timing into the original RAF slot', () => {
    const telemetry = createLiveFrameTelemetry({ capacity: 4, refreshRateHz: 60, reportIntervalMs: 100 });
    const firstFrameId = telemetry.beginFrame(1_000);
    telemetry.endFrame(firstFrameId, 0.25);
    const secondFrameId = telemetry.beginFrame(1_016);
    telemetry.endFrame(secondFrameId, 0.5);

    expect(telemetry.recordGpu(firstFrameId, 0.75)).toBe(true);
    expect(telemetry.recordGpu(firstFrameId + 20, 2)).toBe(false);
    const reportFrameId = telemetry.beginFrame(1_112);
    const reported = telemetry.endFrame(reportFrameId, 1);

    expect(reported).toMatchObject({
      gpuFrameMs: 0.75,
      medianGpuMs: 0.75,
      minimumGpuMs: 0.75,
      maximumGpuMs: 0.75,
      gpuHistoryLength: 3,
    });
    expect([...reported!.gpuHistory.slice(0, 3)]).toEqual([0.75, 0.75, 0.75]);
  });

  it('forward-fills every later frame with the most recently resolved GPU duration', () => {
    const telemetry = createLiveFrameTelemetry({ capacity: 4, refreshRateHz: 60, reportIntervalMs: 100 });
    const firstFrameId = telemetry.beginFrame(1_000);
    const first = telemetry.endFrame(firstFrameId, 0.25);
    telemetry.recordGpu(firstFrameId, 0.75);
    const secondFrameId = telemetry.beginFrame(1_016);
    telemetry.endFrame(secondFrameId, 0.5);
    const thirdFrameId = telemetry.beginFrame(1_032);
    telemetry.endFrame(thirdFrameId, 0.75);

    expect([...first!.gpuHistory.slice(0, 3)]).toEqual([0.75, 0.75, 0.75]);
    telemetry.recordGpu(thirdFrameId, 1.25);
    expect([...first!.gpuHistory.slice(0, 3)]).toEqual([0.75, 1.25, 1.25]);
  });

  it('forgets delayed measurements after their frame slot is overwritten', () => {
    const telemetry = createLiveFrameTelemetry({ capacity: 2, reportIntervalMs: 100 });
    const first = telemetry.beginFrame(1_000);
    const snapshot = telemetry.endFrame(first, 0.25);
    const second = telemetry.beginFrame(1_016);
    telemetry.endFrame(second, 0.5);
    const third = telemetry.beginFrame(1_032);
    telemetry.endFrame(third, 0.75);

    expect(telemetry.recordGpu(first, 1)).toBe(false);
    expect(telemetry.recordGpu(second, 1.25)).toBe(true);
    expect(snapshot?.submitHistoryCursor).toEqual({ length: 2, nextIndex: 1 });
  });

  it('keeps GPU history empty when timing is unsupported', () => {
    const telemetry = createLiveFrameTelemetry({ gpuTimingSupported: false, reportIntervalMs: 100 });
    const first = telemetry.beginFrame(1_000);
    expect(telemetry.gpuTimingSupported).toBe(false);
    const reported = telemetry.endFrame(first, 0.5);
    const second = telemetry.beginFrame(1_016);
    telemetry.endFrame(second, 0.75);

    expect(reported).toMatchObject({
      gpuFrameMs: undefined,
      gpuHistoryLength: 0,
      submitHistoryLength: 1,
      fpsHistoryLength: 1,
    });
    expect(reported?.submitHistoryCursor.length).toBe(2);
    expect(Number.isNaN(reported?.gpuHistory[0])).toBe(true);
  });

  it('rate-limits React snapshots while their typed histories continue to update every frame', () => {
    const telemetry = createLiveFrameTelemetry({ gpuTimingSupported: false, reportIntervalMs: 100 });
    const first = recordCpuFrame(telemetry, 1_000, 0.25);
    const secondToken = telemetry.beginFrame(1_050);
    const withheldSnapshot = telemetry.endFrame(secondToken, 0.5);
    expect(withheldSnapshot).toBeUndefined();
    expect(first.submitHistoryCursor.length).toBe(2);

    const thirdToken = telemetry.beginFrame(1_100);
    const nextSnapshot = telemetry.endFrame(thirdToken, 0.75);
    expect(nextSnapshot).not.toBe(first);
    expect(nextSnapshot?.framesPerSecond).toBe(20);
  });

  it('rejects a short RAF outlier when estimating the display-rate ceiling', () => {
    const telemetry = createLiveFrameTelemetry({ capacity: 16, gpuTimingSupported: false, reportIntervalMs: 1 });
    const timestamps = [1_000, 1_001, 1_017.67, 1_034.34, 1_051.01, 1_067.68, 1_084.35, 1_101.02, 1_117.69];
    let snapshot = recordCpuFrame(telemetry, timestamps[0] ?? 0, 0.5);
    for (const timestamp of timestamps.slice(1)) snapshot = recordCpuFrame(telemetry, timestamp, 0.5);

    expect(snapshot.refreshRateHz).toBeCloseTo(60, 1);
    expect(snapshot.frameBudgetMs).toBeCloseTo(1_000 / 60, 1);
  });

  it('smooths the FPS history while the refresh estimator gathers a stable sample window', () => {
    const telemetry = createLiveFrameTelemetry({ gpuTimingSupported: false, reportIntervalMs: 1 });
    recordCpuFrame(telemetry, 1_000, 0.5);
    recordCpuFrame(telemetry, 1_016, 0.5);
    const third = recordCpuFrame(telemetry, 1_034, 0.5);

    expect(third.fpsHistory[1]).toBeCloseTo(62.5);
    expect(third.fpsHistory[2]).toBeGreaterThan(61);
    expect(third.fpsHistory[2]).toBeLessThan(62.5);
    expect(third.refreshRateHz).toBe(60);
  });

  it('rejects invalid configuration and measurements', () => {
    expect(() => createLiveFrameTelemetry({ capacity: 0 })).toThrow(RangeError);
    expect(() => createLiveFrameTelemetry({ reportIntervalMs: Number.NaN })).toThrow(RangeError);
    expect(() => createLiveFrameTelemetry({ refreshRateHz: 0 })).toThrow(RangeError);
    const telemetry = createLiveFrameTelemetry({ reportIntervalMs: 1 });
    expect(() => telemetry.beginFrame(Number.NaN)).toThrow(RangeError);
    const token = telemetry.beginFrame(1_000);
    expect(() => telemetry.endFrame(token, -1)).toThrow(RangeError);
    expect(() => telemetry.recordGpu(0, 1)).toThrow(RangeError);
    expect(() => telemetry.recordGpu(token, -1)).toThrow(RangeError);
    expect(() => telemetry.discardGpu(0)).toThrow(RangeError);
  });
});

function recordCpuFrame(telemetry: LiveFrameTelemetry, timestamp: number, submitMs: number) {
  const token = telemetry.beginFrame(timestamp);
  const snapshot = telemetry.endFrame(token, submitMs);
  if (snapshot === undefined) throw new Error('CPU sample did not publish');
  return snapshot;
}
