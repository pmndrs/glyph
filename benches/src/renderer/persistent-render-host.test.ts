import type * as THREE from 'three/webgpu';
import { describe, expect, it, vi } from 'vitest';

import { waitForGpuFrameTimerRetirement, type GpuFrameTimer } from './gpu-frame-timer';
import { createPersistentRenderHost } from './persistent-render-host';

describe('persistent render host', () => {
  it('stops rendering and settles GPU timing before disposing the owned renderer', async () => {
    const events: string[] = [];
    const canvas = new EventTarget() as HTMLCanvasElement;
    const setAnimationLoop = vi.fn<(callback: unknown) => Promise<void>>(async (callback) => {
      events.push(callback === null ? 'stop-rendering' : 'start-rendering');
    });
    const renderer = {
      domElement: canvas,
      getDrawingBufferSize: (target: THREE.Vector2) => target.set(640, 360),
      getPixelRatio: () => 1,
      setAnimationLoop,
      setPixelRatio: () => undefined,
      setSize: () => undefined,
    } as unknown as THREE.WebGPURenderer;
    let markTimerDisposalStarted!: () => void;
    const timerDisposalStarted = new Promise<void>((resolve) => {
      markTimerDisposalStarted = resolve;
    });
    let settleTimer!: () => void;
    const timerSettled = new Promise<void>((resolve) => {
      settleTimer = resolve;
    });
    const frameTimer: GpuFrameTimer = {
      supported: false,
      beginFrame() {},
      endFrame() {},
      poll: () => [],
      diagnostics: () => ({
        activeFrameId: undefined,
        latestFrameId: 9,
        oldestPendingFrameId: 9,
        pendingCount: 1,
      }),
      dispose: vi.fn<() => Promise<void>>(() => {
        events.push('settle-timing');
        markTimerDisposalStarted();
        return timerSettled;
      }),
    };
    const host = await createPersistentRenderHost({
      backend: 'webgpu',
      canvas,
      dpr: 1,
      height: 360,
      width: 640,
      onError: () => undefined,
      dependencies: {
        createFrameTimer: () => frameTimer,
        createRenderer: async () => renderer,
        disposeRenderer: async () => {
          events.push('dispose-renderer');
        },
        now: () => 0,
      },
    });
    events.length = 0;

    const retirement = waitForGpuFrameTimerRetirement(canvas);
    const disposal = host.dispose();
    await timerDisposalStarted;

    await expect(retirement).resolves.toEqual({
      activeFrameId: undefined,
      latestFrameId: 9,
      oldestPendingFrameId: 9,
      pendingCount: 1,
    });
    expect(events).toEqual(['stop-rendering', 'settle-timing']);
    settleTimer();
    await disposal;
    expect(events).toEqual(['stop-rendering', 'settle-timing', 'dispose-renderer']);
    expect(setAnimationLoop).toHaveBeenCalledTimes(2);
  });
});
