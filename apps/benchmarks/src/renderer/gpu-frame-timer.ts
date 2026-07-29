import * as THREE from 'three/webgpu';

import type { RendererBackend } from './webgpu-renderer';

export interface GpuFrameMeasurement {
  readonly frameId: number;
  readonly durationMs: number | undefined;
}

export interface GpuFrameTimer {
  readonly supported: boolean;
  beginFrame(frameId: number): void;
  endFrame(): void;
  poll(): readonly GpuFrameMeasurement[];
  dispose(): void;
}

interface TimestampResolver {
  resolveTimestampsAsync(type: THREE.TimestampQuery): Promise<number | undefined>;
}

interface FrameTimerOptions {
  readonly onError: (error: unknown) => void;
}

export function createGpuFrameTimer(options: {
  readonly backend: RendererBackend;
  readonly renderer: THREE.WebGPURenderer;
  readonly onError: (error: unknown) => void;
}): GpuFrameTimer {
  if (options.backend === 'webgpu') {
    return createWebGpuFrameTimer(options.renderer, {
      onError: options.onError,
      supported: options.renderer.hasFeature('timestamp-query'),
    });
  }

  const context = options.renderer.domElement.getContext('webgl2');
  if (context === null) throw new Error('the configured WebGL renderer lost its context');
  return createWebGl2FrameTimer(context, options);
}

export function createWebGpuFrameTimer(
  resolver: TimestampResolver,
  options: FrameTimerOptions & { readonly supported: boolean },
): GpuFrameTimer {
  let activeFrameId: number | undefined;
  let resolution: Promise<void> | undefined;
  let disposed = false;
  let completed: GpuFrameMeasurement[] = [];

  return {
    supported: options.supported,
    beginFrame(frameId) {
      assertFrameId(frameId);
      if (disposed) return;
      if (activeFrameId !== undefined) throw new Error('a GPU frame measurement is already active');
      activeFrameId = frameId;
    },
    endFrame() {
      if (disposed) return;
      if (activeFrameId === undefined) throw new Error('no GPU frame measurement is active');
      const frameId = activeFrameId;
      activeFrameId = undefined;
      if (!options.supported || resolution !== undefined) return;

      resolution = resolver
        .resolveTimestampsAsync(THREE.TimestampQuery.RENDER)
        .then((durationMs) => {
          if (disposed) return;
          if (durationMs === undefined) {
            completed.push({ frameId, durationMs: undefined });
            return;
          }
          if (!Number.isFinite(durationMs) || durationMs < 0) {
            options.onError(new RangeError('GPU frame duration must be finite and nonnegative'));
            completed.push({ frameId, durationMs: undefined });
            return;
          }
          completed.push({ frameId, durationMs });
        })
        .catch((error: unknown) => {
          if (!disposed) {
            options.onError(error);
            completed.push({ frameId, durationMs: undefined });
          }
        })
        .finally(() => {
          resolution = undefined;
        });
    },
    poll() {
      if (disposed || completed.length === 0) return [];
      const measurements = completed;
      completed = [];
      return measurements;
    },
    dispose() {
      disposed = true;
      activeFrameId = undefined;
      completed = [];
    },
  };
}

export function createWebGl2FrameTimer(context: WebGL2RenderingContext, options: FrameTimerOptions): GpuFrameTimer {
  const extension = context.getExtension('EXT_disjoint_timer_query_webgl2');
  if (extension === null) return unsupportedFrameTimer();

  let active: { readonly frameId: number; readonly query: WebGLQuery } | undefined;
  let pending: Array<{ readonly frameId: number; readonly query: WebGLQuery }> = [];
  let failed: GpuFrameMeasurement[] = [];
  let disposed = false;

  return {
    supported: true,
    beginFrame(frameId) {
      assertFrameId(frameId);
      if (disposed) return;
      if (active !== undefined) throw new Error('a GPU frame measurement is already active');
      const query = context.createQuery();
      if (query === null) {
        options.onError(new Error('WebGL could not allocate a GPU timer query'));
        failed.push({ frameId, durationMs: undefined });
        return;
      }
      try {
        context.beginQuery(extension.TIME_ELAPSED_EXT, query);
        active = { frameId, query };
      } catch (error) {
        context.deleteQuery(query);
        options.onError(error);
        failed.push({ frameId, durationMs: undefined });
      }
    },
    endFrame() {
      if (disposed) return;
      const measurement = active;
      active = undefined;
      if (measurement === undefined) return;
      try {
        context.endQuery(extension.TIME_ELAPSED_EXT);
        pending.push(measurement);
      } catch (error) {
        context.deleteQuery(measurement.query);
        options.onError(error);
        failed.push({ frameId: measurement.frameId, durationMs: undefined });
      }
    },
    poll() {
      if (disposed) return [];
      const rejected = failed;
      failed = [];
      if (pending.length === 0) return rejected;
      if (context.getParameter(extension.GPU_DISJOINT_EXT) === true) {
        const discarded = pending.map(({ frameId }) => ({ frameId, durationMs: undefined }));
        for (const { query } of pending) context.deleteQuery(query);
        pending = [];
        return [...rejected, ...discarded];
      }

      const completed: GpuFrameMeasurement[] = [];
      const waiting: typeof pending = [];
      for (const measurement of pending) {
        try {
          if (context.getQueryParameter(measurement.query, context.QUERY_RESULT_AVAILABLE) !== true) {
            waiting.push(measurement);
            continue;
          }
          const nanoseconds: unknown = context.getQueryParameter(measurement.query, context.QUERY_RESULT);
          context.deleteQuery(measurement.query);
          if (typeof nanoseconds !== 'number' || !Number.isFinite(nanoseconds) || nanoseconds < 0) {
            options.onError(new RangeError('WebGL GPU timer result must be finite and nonnegative'));
            completed.push({ frameId: measurement.frameId, durationMs: undefined });
            continue;
          }
          completed.push({ frameId: measurement.frameId, durationMs: nanoseconds / 1e6 });
        } catch (error) {
          context.deleteQuery(measurement.query);
          options.onError(error);
          completed.push({ frameId: measurement.frameId, durationMs: undefined });
        }
      }
      pending = waiting;
      return [...rejected, ...completed];
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (active !== undefined) {
        try {
          context.endQuery(extension.TIME_ELAPSED_EXT);
        } catch {
          // Context loss can invalidate the active query during teardown.
        }
        context.deleteQuery(active.query);
        active = undefined;
      }
      for (const { query } of pending) context.deleteQuery(query);
      pending = [];
      failed = [];
    },
  };
}

function unsupportedFrameTimer(): GpuFrameTimer {
  return {
    supported: false,
    beginFrame(frameId) {
      assertFrameId(frameId);
    },
    endFrame() {},
    poll: () => [],
    dispose() {},
  };
}

function assertFrameId(frameId: number): void {
  if (!Number.isSafeInteger(frameId) || frameId < 0) {
    throw new RangeError('GPU frame ID must be a nonnegative safe integer');
  }
}
