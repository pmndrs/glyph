import { describe, expect, it, vi } from 'vitest';

import { createWebGl2FrameTimer, createWebGpuFrameTimer } from './gpu-frame-timer';

describe('WebGPU frame timer', () => {
  it('queues a resolved duration under the frame that initiated resolution', async () => {
    const resolution = deferred<number | undefined>();
    const resolveTimestampsAsync = vi.fn<() => Promise<number | undefined>>(() => resolution.promise);
    const timer = createWebGpuFrameTimer(
      { resolveTimestampsAsync },
      { onError: vi.fn<(error: unknown) => void>(), supported: true },
    );

    timer.beginFrame(41);
    timer.endFrame();
    expect(timer.poll()).toEqual([]);
    resolution.resolve(1.25);
    await resolution.promise;
    await Promise.resolve();

    expect(resolveTimestampsAsync).toHaveBeenCalledOnce();
    expect(timer.poll()).toEqual([{ frameId: 41, durationMs: 1.25 }]);
    expect(timer.poll()).toEqual([]);
  });

  it('waits for an outstanding resolution during disposal and drops its result', async () => {
    const resolution = deferred<number | undefined>();
    const resolveTimestampsAsync = vi.fn<() => Promise<number | undefined>>(() => resolution.promise);
    const timer = createWebGpuFrameTimer(
      { resolveTimestampsAsync },
      { onError: vi.fn<(error: unknown) => void>(), supported: true },
    );

    timer.beginFrame(1);
    timer.endFrame();
    timer.beginFrame(2);
    timer.endFrame();
    let disposed = false;
    const disposal = timer.dispose().then(() => {
      disposed = true;
    });
    await Promise.resolve();
    expect(disposed).toBe(false);
    resolution.resolve(0.5);
    await disposal;

    expect(resolveTimestampsAsync).toHaveBeenCalledOnce();
    expect(disposed).toBe(true);
    expect(timer.poll()).toEqual([]);
  });

  it("attributes a coalesced timestamp to Three.js's latest resolved renderer frame", async () => {
    const resolution = deferred<number | undefined>();
    const info = { frame: 10 };
    const timestampFrames = [10, 11];
    const timer = createWebGpuFrameTimer(
      {
        backend: { getTimestampFrames: () => timestampFrames },
        info,
        resolveTimestampsAsync: () => resolution.promise,
      },
      { onError: vi.fn<(error: unknown) => void>(), supported: true },
    );

    timer.beginFrame(101);
    timer.endFrame();
    info.frame = 11;
    timer.beginFrame(102);
    timer.endFrame();
    resolution.resolve(0.75);
    await resolution.promise;
    await Promise.resolve();

    expect(timer.poll()).toEqual([{ frameId: 102, durationMs: 0.75 }]);
  });

  it('turns an invalid resolved duration into an explicit discarded sample', async () => {
    const onError = vi.fn<(error: unknown) => void>();
    const timer = createWebGpuFrameTimer(
      { resolveTimestampsAsync: async () => Number.NaN },
      { onError, supported: true },
    );

    timer.beginFrame(3);
    timer.endFrame();
    await Promise.resolve();
    await Promise.resolve();

    expect(onError).toHaveBeenCalledOnce();
    expect(timer.poll()).toEqual([{ frameId: 3, durationMs: undefined }]);
  });
});

describe('WebGL frame timer', () => {
  it('publishes available queries only from explicit poll calls without scheduling timers', () => {
    const harness = webGlHarness();
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    const timer = createWebGl2FrameTimer(harness.context, {
      onError: vi.fn<(error: unknown) => void>(),
    });

    timer.beginFrame(7);
    timer.endFrame();
    expect(timer.poll()).toEqual([]);
    harness.complete(0, 2_500_000);
    expect(timer.poll()).toEqual([{ frameId: 7, durationMs: 2.5 }]);
    expect(timeout).not.toHaveBeenCalled();
    timeout.mockRestore();
  });

  it('discards pending results when the timer becomes disjoint', () => {
    const harness = webGlHarness();
    const timer = createWebGl2FrameTimer(harness.context, {
      onError: vi.fn<(error: unknown) => void>(),
    });

    timer.beginFrame(12);
    timer.endFrame();
    harness.disjoint = true;

    expect(timer.poll()).toEqual([{ frameId: 12, durationMs: undefined }]);
    expect(harness.deleted).toEqual([harness.queries[0]]);
  });

  it('reports unsupported contexts without allocating queries', () => {
    const harness = webGlHarness({ extension: false });
    const timer = createWebGl2FrameTimer(harness.context, {
      onError: vi.fn<(error: unknown) => void>(),
    });

    timer.beginFrame(1);
    timer.endFrame();

    expect(timer.supported).toBe(false);
    expect(timer.poll()).toEqual([]);
    expect(harness.queries).toEqual([]);
  });

  it('turns query allocation failure into an explicit discarded sample', () => {
    const harness = webGlHarness({ allocation: false });
    const onError = vi.fn<(error: unknown) => void>();
    const timer = createWebGl2FrameTimer(harness.context, { onError });

    timer.beginFrame(15);
    timer.endFrame();

    expect(onError).toHaveBeenCalledOnce();
    expect(timer.poll()).toEqual([{ frameId: 15, durationMs: undefined }]);
  });
});

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve = (_value: T): void => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function webGlHarness(options?: { readonly allocation?: boolean; readonly extension?: boolean }): {
  readonly context: WebGL2RenderingContext;
  readonly deleted: WebGLQuery[];
  readonly queries: WebGLQuery[];
  disjoint: boolean;
  complete(index: number, nanoseconds: number): void;
} {
  const extension = {
    GPU_DISJOINT_EXT: 0x8fbb,
    TIME_ELAPSED_EXT: 0x88bf,
  };
  const queries: WebGLQuery[] = [];
  const deleted: WebGLQuery[] = [];
  const available = new Map<WebGLQuery, number>();
  const harness = {
    disjoint: false,
    context: undefined as unknown as WebGL2RenderingContext,
    queries,
    deleted,
    complete(index: number, nanoseconds: number) {
      const query = queries[index];
      if (query === undefined) throw new RangeError('query index is out of range');
      available.set(query, nanoseconds);
    },
  };
  harness.context = {
    QUERY_RESULT: 0x8866,
    QUERY_RESULT_AVAILABLE: 0x8867,
    getExtension: vi.fn<() => typeof extension | null>(() => (options?.extension === false ? null : extension)),
    createQuery: vi.fn<() => WebGLQuery | null>(() => {
      if (options?.allocation === false) return null;
      const query = { index: queries.length } as unknown as WebGLQuery;
      queries.push(query);
      return query;
    }),
    beginQuery: vi.fn<(target: number, query: WebGLQuery) => void>(),
    endQuery: vi.fn<(target: number) => void>(),
    deleteQuery: vi.fn<(query: WebGLQuery | null) => void>((query) => {
      if (query !== null) deleted.push(query);
    }),
    getParameter: vi.fn<(parameter: number) => unknown>(() => harness.disjoint),
    getQueryParameter: vi.fn<(query: WebGLQuery, parameter: number) => unknown>((query, parameter) => {
      if (parameter === 0x8867) return available.has(query);
      if (parameter === 0x8866) return available.get(query);
      throw new RangeError('unexpected query parameter');
    }),
  } as unknown as WebGL2RenderingContext;
  return harness;
}
