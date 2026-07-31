import * as THREE from 'three/webgpu';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import type { GpuFrameTimer } from './gpu-frame-timer';
import { createLiveFrameTelemetry } from './live-frame-telemetry';
import {
  createPersistentRenderHost,
  type PersistentRenderFrameContext,
  type PersistentRenderScene,
  type PersistentRenderSceneDeactivation,
  type PersistentRenderSceneRenderer,
  type PersistentRenderViewport,
} from './persistent-render-host';
import type { RendererOptions } from './webgpu-renderer';

describe('persistent render host', () => {
  it('does not lend renderer lifecycle methods to scenes', () => {
    type BorrowedLifecycleMethod = Extract<
      keyof PersistentRenderSceneRenderer,
      'dispose' | 'setAnimationLoop' | 'setPixelRatio' | 'setSize'
    >;
    expectTypeOf<BorrowedLifecycleMethod>().toEqualTypeOf<never>();
  });

  it('owns one renderer loop, timer, and continuous telemetry across scene replacement', async () => {
    const harness = renderHostHarness();
    const first = sceneHarness('first');
    const second = sceneHarness('second');
    const snapshots: number[] = [];
    const host = await harness.create();
    host.subscribeTelemetry((snapshot) => snapshots.push(snapshot.frameCount));

    await host.replaceScene(first.scene);
    harness.frame(10);
    await host.replaceScene(second.scene);
    harness.frame(20);

    expect(harness.createRenderer).toHaveBeenCalledOnce();
    expect(harness.createFrameTimer).toHaveBeenCalledOnce();
    expect(harness.setAnimationLoop).toHaveBeenCalledTimes(1);
    expect(first.frames).toEqual([1]);
    expect(first.telemetryFrames).toEqual([1]);
    expect(first.deactivations).toEqual(['replaced']);
    expect(second.frames).toEqual([2]);
    expect(second.telemetryFrames).toEqual([2]);
    expect(snapshots).toEqual([1, 2]);
    expect(host.rendererInitMs).toBe(1);
    expect(first.rendererInitDurations).toEqual([1]);
    expect(second.rendererInitDurations).toEqual([1]);

    await host.dispose();
    expect(harness.setAnimationLoop).toHaveBeenLastCalledWith(null);
    expect(harness.disposeTimer).toHaveBeenCalledOnce();
    expect(harness.disposeRenderer).toHaveBeenCalledOnce();
  });

  it('pauses the retained live scene while an exclusive renderer job runs, then resumes it', async () => {
    const harness = renderHostHarness();
    const scene = sceneHarness('live');
    const jobStarted = deferred<void>();
    const finishJob = deferred<void>();
    const host = await harness.create();
    await host.replaceScene(scene.scene);

    const job = host.runExclusiveJob(async (context) => {
      expect(context.renderer).toBe(scene.renderers[0]);
      expect(context.viewport).toBe(host.viewport);
      jobStarted.resolve();
      await finishJob.promise;
      return 'captured';
    });
    await jobStarted.promise;
    harness.frame(10);

    expect(scene.frames).toEqual([]);
    expect(scene.telemetryFrames).toEqual([]);
    expect(scene.deactivations).toEqual([]);
    expect(harness.createRenderer).toHaveBeenCalledOnce();
    expect(harness.createFrameTimer).toHaveBeenCalledOnce();
    expect(harness.createTelemetry).toHaveBeenCalledOnce();
    expect(harness.setAnimationLoop).toHaveBeenCalledOnce();

    finishJob.resolve();
    await expect(job).resolves.toBe('captured');
    harness.frame(20);

    expect(scene.frames).toEqual([1]);
    expect(scene.telemetryFrames).toEqual([1]);
    expect(scene.deactivations).toEqual([]);
    await host.dispose();
  });

  it('resumes the retained live scene after an exclusive renderer job fails', async () => {
    const harness = renderHostHarness();
    const scene = sceneHarness('live');
    const host = await harness.create();
    await host.replaceScene(scene.scene);

    await expect(
      host.runExclusiveJob(() => {
        throw new Error('capture failed');
      }),
    ).rejects.toThrow('capture failed');
    harness.frame(10);

    expect(scene.frames).toEqual([1]);
    expect(scene.telemetryFrames).toEqual([1]);
    expect(scene.deactivations).toEqual([]);
    expect(harness.createRenderer).toHaveBeenCalledOnce();
    expect(harness.createTelemetry).toHaveBeenCalledOnce();
    expect(harness.setAnimationLoop).toHaveBeenCalledOnce();
    await host.dispose();
  });

  it('aborts an exclusive renderer job and resumes the retained live scene', async () => {
    const harness = renderHostHarness();
    const scene = sceneHarness('live');
    const controller = new AbortController();
    const jobStarted = deferred<void>();
    const failure = new DOMException('capture cancelled', 'AbortError');
    const host = await harness.create();
    await host.replaceScene(scene.scene);

    const job = host.runExclusiveJob(({ signal }) => {
      jobStarted.resolve();
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    }, controller.signal);
    await jobStarted.promise;
    harness.frame(10);
    controller.abort(failure);

    await expect(job).rejects.toBe(failure);
    harness.frame(20);
    expect(scene.frames).toEqual([1]);
    expect(scene.telemetryFrames).toEqual([1]);
    expect(scene.deactivations).toEqual([]);
    expect(harness.createRenderer).toHaveBeenCalledOnce();
    await host.dispose();
  });

  it('never overlaps queued exclusive renderer jobs', async () => {
    const harness = renderHostHarness();
    const firstStarted = deferred<void>();
    const finishFirst = deferred<void>();
    const order: string[] = [];
    const host = await harness.create();

    const first = host.runExclusiveJob(async () => {
      order.push('first:start');
      firstStarted.resolve();
      await finishFirst.promise;
      order.push('first:end');
    });
    const second = host.runExclusiveJob(() => {
      order.push('second:start');
    });
    await firstStarted.promise;
    expect(order).toEqual(['first:start']);

    finishFirst.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(['first:start', 'first:end', 'second:start']);
    expect(harness.createRenderer).toHaveBeenCalledOnce();
    await host.dispose();
  });

  it('serializes replacement and revokes a scene superseded during activation', async () => {
    const harness = renderHostHarness();
    const activation = deferred<void>();
    const first = sceneHarness('first', activation.promise);
    const second = sceneHarness('second');
    const host = await harness.create();

    const firstReplacement = host.replaceScene(first.scene);
    await Promise.resolve();
    const secondReplacement = host.replaceScene(second.scene);
    expect(first.activationSignals[0]?.aborted).toBe(true);
    expect(second.activations).toBe(0);

    activation.resolve();
    await expect(firstReplacement).rejects.toMatchObject({ name: 'AbortError' });
    const secondLease = await secondReplacement;
    harness.frame(30);

    expect(first.deactivations).toEqual(['superseded']);
    expect(second.activations).toBe(1);
    expect(second.frames).toEqual([1]);
    await secondLease.release();
    await host.dispose();
  });

  it('keeps the current scene rendering while its replacement activates', async () => {
    const harness = renderHostHarness();
    const first = sceneHarness('first');
    const activation = deferred<void>();
    const second = sceneHarness('second', activation.promise);
    const host = await harness.create();
    await host.replaceScene(first.scene);

    const replacement = host.replaceScene(second.scene);
    await Promise.resolve();
    harness.frame(10);

    expect(first.frames).toEqual([1]);
    expect(first.deactivations).toEqual([]);

    activation.resolve();
    await replacement;
    harness.frame(20);

    expect(first.deactivations).toEqual(['replaced']);
    expect(second.frames).toEqual([2]);
    await host.dispose();
  });

  it('makes stale leases unable to release the current generation', async () => {
    const harness = renderHostHarness();
    const first = sceneHarness('first');
    const second = sceneHarness('second');
    const host = await harness.create();
    const firstLease = await host.replaceScene(first.scene);
    const secondLease = await host.replaceScene(second.scene);

    await firstLease.release();
    harness.frame(12);
    expect(second.frames).toEqual([1]);
    expect(second.deactivations).toEqual([]);

    await secondLease.release();
    expect(second.deactivations).toEqual(['released']);
    await host.dispose();
  });

  it('owns DPR and size changes and publishes the physical viewport to the active scene', async () => {
    const harness = renderHostHarness();
    const scene = sceneHarness('scene');
    const host = await harness.create();
    await host.replaceScene(scene.scene);

    host.resize(320, 180, 2);

    expect(harness.setPixelRatio).toHaveBeenCalledWith(2);
    expect(harness.setSize).toHaveBeenLastCalledWith(320, 180, false);
    expect(host.viewport).toEqual({
      width: 320,
      height: 180,
      dpr: 2,
      drawingBufferWidth: 640,
      drawingBufferHeight: 360,
    });
    expect(scene.viewports.at(-1)).toEqual(host.viewport);
    await host.dispose();
  });

  it('cleans up a scene whose activation fails before admitting the next generation', async () => {
    const harness = renderHostHarness();
    const failed = sceneHarness('failed', Promise.reject(new Error('activation failed')));
    const recovered = sceneHarness('recovered');
    const host = await harness.create();

    await expect(host.replaceScene(failed.scene)).rejects.toThrow('activation failed');
    expect(failed.deactivations).toEqual(['failed']);
    await host.replaceScene(recovered.scene);
    harness.frame(10);
    expect(recovered.frames).toEqual([1]);
    await host.dispose();
  });
});

function renderHostHarness() {
  let width = 160;
  let height = 90;
  let dpr = 1;
  let loop: ((timestamp: number) => void) | null = null;
  let now = 0;
  const canvas = {} as HTMLCanvasElement;
  const setAnimationLoop = vi.fn<(callback: ((timestamp: number) => void) | null) => Promise<void>>(
    async (callback) => {
      loop = callback;
    },
  );
  const setPixelRatio = vi.fn<(value: number) => void>((value) => {
    dpr = value;
  });
  const setSize = vi.fn<(nextWidth: number, nextHeight: number, updateStyle?: boolean) => void>(
    (nextWidth, nextHeight) => {
      width = nextWidth;
      height = nextHeight;
    },
  );
  const renderer = {
    domElement: canvas,
    getDrawingBufferSize(target: THREE.Vector2) {
      return target.set(Math.round(width * dpr), Math.round(height * dpr));
    },
    getPixelRatio: () => dpr,
    setAnimationLoop,
    setPixelRatio,
    setSize,
  } as unknown as THREE.WebGPURenderer;
  const createRenderer = vi.fn<(_options: RendererOptions) => Promise<THREE.WebGPURenderer>>(async () => renderer);
  const disposeRenderer = vi.fn<(_renderer: THREE.WebGPURenderer) => Promise<void>>(async () => undefined);
  const disposeTimer = vi.fn<() => Promise<void>>(async () => undefined);
  const timer: GpuFrameTimer = {
    supported: false,
    beginFrame: vi.fn<GpuFrameTimer['beginFrame']>(),
    endFrame: vi.fn<GpuFrameTimer['endFrame']>(),
    poll: vi.fn<GpuFrameTimer['poll']>(() => []),
    dispose: disposeTimer,
  };
  const createFrameTimer = vi.fn<() => GpuFrameTimer>(() => timer);
  const createTelemetry = vi.fn<typeof createLiveFrameTelemetry>(() =>
    createLiveFrameTelemetry({ gpuTimingSupported: false, refreshRateHz: 60, reportIntervalMs: 1 }),
  );

  return {
    createFrameTimer,
    createRenderer,
    createTelemetry,
    disposeRenderer,
    disposeTimer,
    setAnimationLoop,
    setPixelRatio,
    setSize,
    async create() {
      return createPersistentRenderHost({
        backend: 'webgpu',
        canvas,
        dpr,
        height,
        width,
        onError: (error) => {
          throw error;
        },
        dependencies: {
          createFrameTimer,
          createRenderer,
          createTelemetry,
          disposeRenderer,
          now: () => now++,
        },
      });
    },
    frame(timestamp: number) {
      if (loop === null) throw new Error('render loop is not installed');
      loop(timestamp);
    },
  };
}

function sceneHarness(
  id: string,
  activation: Promise<void> = Promise.resolve(),
): {
  readonly scene: PersistentRenderScene;
  readonly activationSignals: AbortSignal[];
  readonly deactivations: PersistentRenderSceneDeactivation[];
  readonly frames: number[];
  readonly rendererInitDurations: number[];
  readonly renderers: PersistentRenderSceneRenderer[];
  readonly telemetryFrames: number[];
  readonly viewports: PersistentRenderViewport[];
  activations: number;
} {
  const result = {
    activations: 0,
    activationSignals: [] as AbortSignal[],
    deactivations: [] as PersistentRenderSceneDeactivation[],
    frames: [] as number[],
    rendererInitDurations: [] as number[],
    renderers: [] as PersistentRenderSceneRenderer[],
    telemetryFrames: [] as number[],
    viewports: [] as PersistentRenderViewport[],
    scene: undefined as unknown as PersistentRenderScene,
  };
  result.scene = {
    id,
    async activate(context) {
      result.activations += 1;
      result.activationSignals.push(context.signal);
      result.rendererInitDurations.push(context.rendererInitMs);
      result.renderers.push(context.renderer);
      result.viewports.push(context.viewport);
      await activation;
    },
    deactivate(reason) {
      result.deactivations.push(reason);
    },
    frame(context: PersistentRenderFrameContext) {
      result.frames.push(context.frameId);
    },
    telemetry(snapshot) {
      result.telemetryFrames.push(snapshot.frameCount);
    },
    resize(viewport) {
      result.viewports.push(viewport);
    },
  };
  return result;
}

function deferred<T>(): { readonly promise: Promise<T>; readonly resolve: (value: T) => void } {
  let resolve = (_value: T): void => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
