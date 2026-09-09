import { describe, expect, it } from 'vitest';

import { createWebGl2FrameTimer, createWebGpuFrameTimer } from './gpu-frame-timer';

describe('GPU frame timer', () => {
  it('keeps one WebGPU resolution identity while a timestamp readback is stalled', async () => {
    const resolutions: Array<(duration: number) => void> = [];
    const timestampFrames: number[] = [];
    const resolver = {
      backend: { getTimestampFrames: () => timestampFrames },
      info: { frame: 100 },
      resolveTimestampsAsync: () =>
        new Promise<number>((resolve) => {
          resolutions.push(resolve);
        }),
    };
    const timer = createWebGpuFrameTimer(resolver, { onError: () => undefined, supported: true });

    timer.beginFrame(10);
    timer.endFrame();
    for (let frame = 11; frame < 10_011; frame += 1) {
      resolver.info.frame += 1;
      timer.beginFrame(frame);
      timer.endFrame();
    }

    expect(timer.diagnostics()).toEqual({
      activeFrameId: undefined,
      latestFrameId: 10_010,
      oldestPendingFrameId: 10,
      pendingCount: 1,
    });
    timestampFrames.push(100);
    resolutions[0]!(2);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(timer.poll()).toEqual([{ frameId: 10, durationMs: 2 }]);

    timer.beginFrame(10_011);
    resolver.info.frame += 1;
    timer.endFrame();
    timestampFrames.length = 0;
    timestampFrames.push(resolver.info.frame);
    resolutions[1]!(3);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(timer.poll()).toEqual([{ frameId: 10_011, durationMs: 3 }]);

    timer.beginFrame(10_012);
    resolver.info.frame += 1;
    timer.endFrame();
    timestampFrames[0] = resolver.info.frame - 1;
    resolutions[2]!(4);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(timer.poll()).toEqual([{ frameId: 10_012, durationMs: undefined }]);
    await timer.dispose();
  });

  it('disposes without waiting for an uncancellable WebGPU readback', async () => {
    let resolveTimestamp!: (duration: number) => void;
    const timer = createWebGpuFrameTimer(
      {
        resolveTimestampsAsync: () =>
          new Promise<number>((resolve) => {
            resolveTimestamp = resolve;
          }),
      },
      { onError: () => undefined, supported: true },
    );
    timer.beginFrame(1);
    timer.endFrame();

    await expect(timer.dispose()).resolves.toBeUndefined();
    expect(timer.diagnostics()).toEqual({
      activeFrameId: undefined,
      latestFrameId: 1,
      oldestPendingFrameId: undefined,
      pendingCount: 0,
    });

    resolveTimestamp(2);
    await Promise.resolve();
    await Promise.resolve();
    expect(timer.poll()).toEqual([]);
  });

  it('bounds unavailable WebGL queries and recovers as newer queries complete', async () => {
    const queries: MockWebGlQuery[] = [];
    const deleted = new Set<MockWebGlQuery>();
    const extension = { GPU_DISJOINT_EXT: 1, TIME_ELAPSED_EXT: 2 };
    let available = false;
    let availabilityChecks = 0;
    const context = {
      QUERY_RESULT: 3,
      QUERY_RESULT_AVAILABLE: 4,
      beginQuery: () => undefined,
      createQuery: () => {
        const query = { id: queries.length };
        queries.push(query);
        return query;
      },
      deleteQuery: (query: MockWebGlQuery) => deleted.add(query),
      endQuery: () => undefined,
      getExtension: () => extension,
      getParameter: () => false,
      getQueryParameter: (_query: MockWebGlQuery, parameter: number) => {
        if (parameter !== 4) return 1_000_000;
        availabilityChecks += 1;
        return available;
      },
    } as unknown as WebGL2RenderingContext;
    const timer = createWebGl2FrameTimer(context, { onError: () => undefined });
    const expired: Array<{ readonly frameId: number; readonly durationMs: number | undefined }> = [];

    for (let frame = 0; frame < 1_100; frame += 1) {
      timer.beginFrame(frame);
      timer.endFrame();
      expired.push(...timer.poll());
    }
    expired.push(...timer.poll());

    expect(timer.diagnostics()).toEqual({
      activeFrameId: undefined,
      latestFrameId: 1_099,
      oldestPendingFrameId: 76,
      pendingCount: 1_024,
    });
    expect(deleted.size).toBe(76);
    expect(availabilityChecks).toBe(1_101);
    expect(expired).toEqual(Array.from({ length: 76 }, (_, frameId) => ({ frameId, durationMs: undefined })));

    available = true;
    const recovered = timer.poll();
    expect(recovered).toHaveLength(1_024);
    expect(recovered.map(({ frameId }) => frameId)).toEqual(Array.from({ length: 1_024 }, (_, index) => index + 76));
    expect(recovered.every(({ durationMs }) => durationMs === 1)).toBe(true);
    expect(timer.diagnostics()).toEqual({
      activeFrameId: undefined,
      latestFrameId: 1_099,
      oldestPendingFrameId: undefined,
      pendingCount: 0,
    });
    await timer.dispose();
  });
});

interface MockWebGlQuery {
  readonly id: number;
}
