import type * as THREE from 'three/webgpu';
import { describe, expect, test, vi } from 'vitest';

import type { GpuFrameTimer } from './gpu-frame-timer';
import type { LiveFrameTelemetry } from './live-frame-telemetry';
import { createPersistentRenderHost, type PersistentRenderScene } from './persistent-render-host';

describe('persistent render host timing', () => {
  test('measures scene submission without GPU timer bookkeeping', async () => {
    const animationLoops: Array<((timestamp: number) => void) | null> = [];
    let clock = 0;
    let measuredDuration: number | undefined;
    const canvas = new EventTarget() as HTMLCanvasElement;
    const renderer = {
      getDrawingBufferSize(target: THREE.Vector2) {
        return target.set(640, 360);
      },
      getPixelRatio: () => 1,
      setAnimationLoop(loop: ((timestamp: number) => void) | null) {
        animationLoops.push(loop);
      },
    } as unknown as THREE.WebGPURenderer;
    const frameTimer: GpuFrameTimer = {
      supported: true,
      beginFrame() {
        clock += 7;
      },
      diagnostics: () => ({
        activeFrameId: undefined,
        latestFrameId: undefined,
        oldestPendingFrameId: undefined,
        pendingCount: 0,
      }),
      dispose: async () => undefined,
      endFrame() {
        clock += 11;
      },
      poll: () => [],
    };
    const telemetry: LiveFrameTelemetry = {
      gpuTimingSupported: true,
      beginFrame: () => 1,
      capture: () => Promise.reject(new Error('capture is not used by this test')),
      discardGpu: () => false,
      endFrame(_frameId, durationMs) {
        measuredDuration = durationMs;
        return undefined;
      },
      recordGpu: () => false,
      reset() {},
    };
    const host = await createPersistentRenderHost({
      backend: 'webgpu',
      canvas,
      dpr: 1,
      height: 360,
      onError: vi.fn<(error: unknown) => void>(),
      width: 640,
      dependencies: {
        createFrameTimer: () => frameTimer,
        createRenderer: async () => renderer,
        createTelemetry: () => telemetry,
        disposeRenderer: async () => undefined,
        now: () => clock,
      },
    });
    const scene: PersistentRenderScene = {
      activate() {},
      frame() {
        clock += 2;
      },
      id: 'timed-scene',
    };
    const lease = await host.replaceScene(scene);

    const animationLoop = animationLoops.at(-1);
    expect(animationLoop).toBeTypeOf('function');
    if (animationLoop === null || animationLoop === undefined) throw new Error('animation loop was not installed');
    animationLoop(16);

    expect(measuredDuration).toBe(2);
    await lease.release();
    await host.dispose();
  });
});
