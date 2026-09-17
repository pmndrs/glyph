import { describe, expect, it } from 'vitest';

import {
  sampleAnimationPerformance,
  sampleFrameTimes,
  summarizeDurations,
  summarizeFrameTimes,
  type AnimationFrameTarget,
} from './frame-time';

describe('frame-time sampling', () => {
  it('summarizes consecutive frame intervals with one shared schema', () => {
    expect(summarizeFrameTimes(new Float64Array([10, 20, 30, 40]))).toEqual({
      framesPerSecond: 40,
      maxMs: 40,
      meanMs: 25,
      p50Ms: 20,
      p95Ms: 40,
      sampleCount: 4,
    });
  });

  it('excludes warm-up intervals from a fixed-size sample', async () => {
    const timestamps = [0, 4, 9, 19, 31];
    let warmupCompletions = 0;
    const target: AnimationFrameTarget = {
      requestAnimationFrame(callback) {
        const timestamp = timestamps.shift();
        if (timestamp === undefined) throw new Error('frame sampler requested an unexpected frame');
        queueMicrotask(() => callback(timestamp));
        return timestamps.length;
      },
    };

    const sample = await sampleFrameTimes(target, {
      onWarmupComplete: () => {
        warmupCompletions += 1;
      },
      warmupFrames: 2,
      sampleFrames: 2,
    });

    expect([...sample.frameTimesMs]).toEqual([10, 12]);
    expect(sample.summary.sampleCount).toBe(2);
    expect(warmupCompletions).toBe(1);
  });

  it('rejects empty and invalid samples', () => {
    expect(() => summarizeFrameTimes(new Float64Array())).toThrow(RangeError);
    expect(() => summarizeFrameTimes(new Float64Array([0]))).toThrow(RangeError);
    expect(() => summarizeFrameTimes(new Float64Array([16, Number.NaN]))).toThrow(RangeError);
    expect(summarizeDurations(new Float64Array([0, 2])).p50Ms).toBe(0);
  });

  it('aligns one fixed-size CPU capture with the measured frame window', async () => {
    const timestamps = [0, 4, 9, 19, 31];
    const target: AnimationFrameTarget = {
      requestAnimationFrame(callback) {
        queueMicrotask(() => callback(timestamps.shift()!));
        return timestamps.length;
      },
    };
    const requested: number[] = [];

    const sample = await sampleAnimationPerformance(
      target,
      (sampleFrames) => {
        requested.push(sampleFrames);
        return Promise.resolve(new Float64Array([2, 3]));
      },
      { warmupFrames: 2, sampleFrames: 2 },
    );

    expect(requested).toEqual([2]);
    expect([...sample.frameTimesMs]).toEqual([10, 12]);
    expect(sample.cpuTime).toMatchObject({ meanMs: 2.5, sampleCount: 2 });
  });
});
