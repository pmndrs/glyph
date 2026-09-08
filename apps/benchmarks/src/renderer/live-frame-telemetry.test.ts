import { describe, expect, it } from 'vitest';

import {
  bindLiveFrameTelemetryCaptureRequests,
  createLiveFrameTelemetry,
  requestLiveFrameTelemetryCapture,
} from './live-frame-telemetry';

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

  it('resets scene-local histories without reusing delayed GPU frame identities', () => {
    const telemetry = createLiveFrameTelemetry({ capacity: 4, refreshRateHz: 60, reportIntervalMs: 1 });
    const staleFrame = telemetry.beginFrame(0);
    telemetry.endFrame(staleFrame, 100);

    telemetry.reset();
    expect(telemetry.recordGpu(staleFrame, 100)).toBe(false);

    const freshFrame = telemetry.beginFrame(16);
    telemetry.recordGpu(freshFrame, 2);
    const snapshot = telemetry.endFrame(freshFrame, 3);
    expect(freshFrame).toBeGreaterThan(staleFrame);
    expect(snapshot).toMatchObject({
      frameCount: 2,
      medianSubmitMs: 3,
      medianGpuMs: 2,
      submitHistoryLength: 1,
    });
  });

  it('captures exact post-start CPU frames and finite GPU query completions', async () => {
    const telemetry = createLiveFrameTelemetry({ capacity: 2, refreshRateHz: 60, reportIntervalMs: 1 });
    const warmupFrame = telemetry.beginFrame(0);
    telemetry.endFrame(warmupFrame, 100);

    const capturePromise = telemetry.capture({ cpuSampleCount: 3, gpuSampleCount: 2 });
    telemetry.recordGpu(warmupFrame, 100);
    const firstFrame = telemetry.beginFrame(16);
    telemetry.endFrame(firstFrame, 3);
    const secondFrame = telemetry.beginFrame(32);
    telemetry.endFrame(secondFrame, 1);
    telemetry.recordGpu(secondFrame, 4);
    const thirdFrame = telemetry.beginFrame(48);
    telemetry.endFrame(thirdFrame, 2);
    telemetry.discardGpu(thirdFrame);

    let settled = false;
    void capturePromise.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    const fourthFrame = telemetry.beginFrame(64);
    telemetry.recordGpu(fourthFrame, 2);
    telemetry.endFrame(fourthFrame, 99);
    const capture = await capturePromise;
    expect(capture.startedAfterFrameId).toBe(warmupFrame);
    expect([...capture.cpuMs]).toEqual([3, 1, 2]);
    expect([...capture.gpuMs]).toEqual([4, 2]);
  });

  it('captures beyond ring saturation without using rolling history length as progress', async () => {
    const telemetry = createLiveFrameTelemetry({
      capacity: 2,
      gpuTimingSupported: false,
      refreshRateHz: 60,
      reportIntervalMs: 1,
    });
    const capturePromise = telemetry.capture({ cpuSampleCount: 5, gpuSampleCount: 0 });
    for (let index = 0; index < 5; index += 1) {
      const frameId = telemetry.beginFrame(index * 16);
      telemetry.endFrame(frameId, index + 1);
    }

    const capture = await capturePromise;
    expect([...capture.cpuMs]).toEqual([1, 2, 3, 4, 5]);
    expect(capture.gpuMs).toHaveLength(0);
  });

  it('serves explicit capture requests without changing rolling statistics', async () => {
    const telemetry = createLiveFrameTelemetry({ capacity: 4, refreshRateHz: 60, reportIntervalMs: 1 });
    const target = new EventTarget();
    const unbind = bindLiveFrameTelemetryCaptureRequests(target, telemetry);
    const capturePromise = requestLiveFrameTelemetryCapture(target, { cpuSampleCount: 1, gpuSampleCount: 1 });
    const frameId = telemetry.beginFrame(0);
    telemetry.recordGpu(frameId, 7);
    const snapshot = telemetry.endFrame(frameId, 5);

    await expect(capturePromise).resolves.toMatchObject({
      startedAfterFrameId: 0,
      cpuMs: new Float64Array([5]),
      gpuMs: new Float64Array([7]),
    });
    expect(snapshot).toMatchObject({ medianSubmitMs: 5, medianGpuMs: 7, gpuHistoryLength: 1 });

    unbind();
    await expect(
      requestLiveFrameTelemetryCapture(target, { cpuSampleCount: 1, gpuSampleCount: 0 }),
    ).rejects.toMatchObject({ name: 'NotFoundError' });
  });

  it('rejects an in-flight capture on scene reset and keeps frame IDs unique', async () => {
    const telemetry = createLiveFrameTelemetry({ capacity: 2, refreshRateHz: 60, reportIntervalMs: 1 });
    const firstFrame = telemetry.beginFrame(0);
    telemetry.endFrame(firstFrame, 1);
    const capturePromise = telemetry.capture({ cpuSampleCount: 2, gpuSampleCount: 0 });
    telemetry.reset();

    await expect(capturePromise).rejects.toMatchObject({ name: 'AbortError' });
    const nextFrame = telemetry.beginFrame(16);
    expect(nextFrame).toBeGreaterThan(firstFrame);
  });

  it('aborts capture deterministically and refuses concurrent windows', async () => {
    const telemetry = createLiveFrameTelemetry({ gpuTimingSupported: false });
    const controller = new AbortController();
    const capturePromise = telemetry.capture({ cpuSampleCount: 2, gpuSampleCount: 0, signal: controller.signal });
    expect(() => telemetry.capture({ cpuSampleCount: 1, gpuSampleCount: 0 })).toThrow(
      expect.objectContaining({ name: 'InvalidStateError' }),
    );

    const rejection = capturePromise.then(
      () => undefined,
      (reason: unknown) => reason,
    );
    controller.abort();
    await expect(rejection).resolves.toMatchObject({ name: 'AbortError' });

    const recoveryCapture = telemetry.capture({ cpuSampleCount: 1, gpuSampleCount: 0 });
    const frameId = telemetry.beginFrame(0);
    telemetry.endFrame(frameId, 3);
    await expect(recoveryCapture).resolves.toMatchObject({ cpuMs: new Float64Array([3]) });
  });

  it('rejects capture requests that cannot produce their requested finite window', () => {
    const telemetry = createLiveFrameTelemetry({ gpuTimingSupported: false });
    expect(() => telemetry.capture({ cpuSampleCount: 0, gpuSampleCount: 0 })).toThrow(RangeError);
    expect(() => telemetry.capture({ cpuSampleCount: 1, gpuSampleCount: 1 })).toThrow(
      expect.objectContaining({ name: 'NotSupportedError' }),
    );
  });
});
