import * as THREE from 'three/webgpu';

import type { RendererBackend } from './webgpu-renderer';

export interface GpuFrameMeasurement {
  readonly frameId: number;
  readonly durationMs: number | undefined;
}

export interface GpuFrameTimerDiagnostics {
  readonly activeFrameId: number | undefined;
  readonly latestFrameId: number | undefined;
  readonly oldestPendingFrameId: number | undefined;
  readonly pendingCount: number;
}

export interface GpuFrameTimer {
  readonly supported: boolean;
  beginFrame(frameId: number): void;
  endFrame(): void;
  poll(): readonly GpuFrameMeasurement[];
  diagnostics(): GpuFrameTimerDiagnostics;
  dispose(): Promise<void>;
}

interface TimestampResolver {
  readonly backend?: object;
  readonly info?: {
    frame?: number;
  };
  resolveTimestampsAsync(type: THREE.TimestampQuery): Promise<number | undefined>;
}

interface FrameTimerOptions {
  readonly onError: (error: unknown) => void;
}

const EMPTY_GPU_FRAME_MEASUREMENTS: readonly GpuFrameMeasurement[] = Object.freeze([]);
const MAX_PENDING_WEBGL_QUERIES = 1_024;
const GPU_FRAME_TIMER_DIAGNOSTICS_EVENT = 'pmndrs-gpu-frame-timer-diagnostics';

interface GpuFrameTimerDiagnosticsRequest {
  diagnostics: GpuFrameTimerDiagnostics | undefined;
}

export function requestGpuFrameTimerDiagnostics(target: EventTarget): GpuFrameTimerDiagnostics {
  const detail: GpuFrameTimerDiagnosticsRequest = { diagnostics: undefined };
  target.dispatchEvent(new CustomEvent<GpuFrameTimerDiagnosticsRequest>(GPU_FRAME_TIMER_DIAGNOSTICS_EVENT, { detail }));
  if (detail.diagnostics === undefined) throw new DOMException('no GPU frame timer is bound', 'NotFoundError');
  return detail.diagnostics;
}

export function bindGpuFrameTimerDiagnosticsRequests(target: EventTarget, timer: GpuFrameTimer): () => void {
  const inspect: EventListener = (event) => {
    if (!(event instanceof CustomEvent)) return;
    const detail: unknown = event.detail;
    if (typeof detail !== 'object' || detail === null || !Object.hasOwn(detail, 'diagnostics')) return;
    (detail as GpuFrameTimerDiagnosticsRequest).diagnostics = timer.diagnostics();
  };
  target.addEventListener(GPU_FRAME_TIMER_DIAGNOSTICS_EVENT, inspect);
  return () => target.removeEventListener(GPU_FRAME_TIMER_DIAGNOSTICS_EVENT, inspect);
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
  let resolutionFrameId: number | undefined;
  let resolutionRendererFrameId: number | undefined;
  let disposed = false;
  let completed: GpuFrameMeasurement[] = [];
  let latestFrameId: number | undefined;

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
      latestFrameId = frameId;
      const rendererFrameId = resolver.info?.frame;
      if (!options.supported || resolution !== undefined) return;

      resolutionFrameId = frameId;
      resolutionRendererFrameId = rendererFrameId;

      resolution = resolver
        .resolveTimestampsAsync(THREE.TimestampQuery.RENDER)
        .then((durationMs) => {
          if (disposed) return;
          const backend = resolver.backend as { getTimestampFrames?(type: THREE.TimestampQuery): number[] } | undefined;
          const resolvedRendererFrameId = backend?.getTimestampFrames?.(THREE.TimestampQuery.RENDER).at(-1);
          const frameIdForDuration = resolutionFrameId ?? frameId;
          if (resolvedRendererFrameId !== undefined && resolvedRendererFrameId !== resolutionRendererFrameId) {
            completed.push({ frameId: frameIdForDuration, durationMs: undefined });
            return;
          }
          if (durationMs === undefined) {
            completed.push({ frameId: frameIdForDuration, durationMs: undefined });
            return;
          }
          if (!Number.isFinite(durationMs) || durationMs < 0) {
            options.onError(new RangeError('GPU frame duration must be finite and nonnegative'));
            completed.push({ frameId: frameIdForDuration, durationMs: undefined });
            return;
          }
          completed.push({ frameId: frameIdForDuration, durationMs });
        })
        .catch((error: unknown) => {
          if (!disposed) {
            options.onError(error);
            completed.push({ frameId, durationMs: undefined });
          }
        })
        .finally(() => {
          resolution = undefined;
          resolutionFrameId = undefined;
          resolutionRendererFrameId = undefined;
        });
    },
    poll() {
      if (disposed || completed.length === 0) return EMPTY_GPU_FRAME_MEASUREMENTS;
      const measurements = completed;
      completed = [];
      return measurements;
    },
    diagnostics() {
      return {
        activeFrameId,
        latestFrameId,
        oldestPendingFrameId: resolutionFrameId,
        pendingCount: resolution === undefined ? 0 : 1,
      };
    },
    async dispose() {
      disposed = true;
      activeFrameId = undefined;
      completed = [];
      resolution = undefined;
      resolutionFrameId = undefined;
      resolutionRendererFrameId = undefined;
    },
  };
}

export function createWebGl2FrameTimer(context: WebGL2RenderingContext, options: FrameTimerOptions): GpuFrameTimer {
  const extension = context.getExtension('EXT_disjoint_timer_query_webgl2');
  if (extension === null) return unsupportedFrameTimer();

  let active: { readonly frameId: number; readonly query: WebGLQuery } | undefined;
  // Fixed ring scratch bounds a stalled driver without adding steady-state allocations.
  let pending: Array<{ readonly frameId: number; readonly query: WebGLQuery }> = [];
  let pendingScratch: Array<{ readonly frameId: number; readonly query: WebGLQuery }> = [];
  const releasedPending = new Uint8Array(MAX_PENDING_WEBGL_QUERIES);
  let nextEvictionIndex = 0;
  let failed: GpuFrameMeasurement[] = [];
  let disposed = false;
  let latestFrameId: number | undefined;

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
      latestFrameId = measurement.frameId;
      try {
        context.endQuery(extension.TIME_ELAPSED_EXT);
        if (pending.length < MAX_PENDING_WEBGL_QUERIES) {
          pending.push(measurement);
        } else {
          const expired = pending[nextEvictionIndex]!;
          context.deleteQuery(expired.query);
          failed.push({ frameId: expired.frameId, durationMs: undefined });
          pending[nextEvictionIndex] = measurement;
          nextEvictionIndex = (nextEvictionIndex + 1) % pending.length;
        }
      } catch (error) {
        context.deleteQuery(measurement.query);
        options.onError(error);
        failed.push({ frameId: measurement.frameId, durationMs: undefined });
      }
    },
    poll() {
      if (disposed) return EMPTY_GPU_FRAME_MEASUREMENTS;
      const rejected = failed.length === 0 ? EMPTY_GPU_FRAME_MEASUREMENTS : failed;
      if (failed.length !== 0) failed = [];
      if (pending.length === 0) return rejected;
      if (context.getParameter(extension.GPU_DISJOINT_EXT) === true) {
        const discarded: GpuFrameMeasurement[] = [];
        for (let offset = 0; offset < pending.length; offset += 1) {
          const { frameId, query } = pending[(nextEvictionIndex + offset) % pending.length]!;
          discarded.push({ frameId, durationMs: undefined });
          context.deleteQuery(query);
        }
        pending = [];
        nextEvictionIndex = 0;
        if (rejected.length === 0) return discarded;
        failed.push(...rejected, ...discarded);
        const measurements = failed;
        failed = [];
        return measurements;
      }

      let completed: GpuFrameMeasurement[] | undefined;
      let releasedCount = 0;
      const head = pending.length === MAX_PENDING_WEBGL_QUERIES ? nextEvictionIndex : 0;
      for (let offset = 0; offset < pending.length; offset += 1) {
        const index = (head + offset) % pending.length;
        const measurement = pending[index]!;
        try {
          if (context.getQueryParameter(measurement.query, context.QUERY_RESULT_AVAILABLE) !== true) {
            break;
          }
          const nanoseconds: unknown = context.getQueryParameter(measurement.query, context.QUERY_RESULT);
          context.deleteQuery(measurement.query);
          releasedPending[index] = 1;
          releasedCount += 1;
          if (typeof nanoseconds !== 'number' || !Number.isFinite(nanoseconds) || nanoseconds < 0) {
            options.onError(new RangeError('WebGL GPU timer result must be finite and nonnegative'));
            (completed ??= []).push({ frameId: measurement.frameId, durationMs: undefined });
            continue;
          }
          (completed ??= []).push({ frameId: measurement.frameId, durationMs: nanoseconds / 1e6 });
        } catch (error) {
          context.deleteQuery(measurement.query);
          releasedPending[index] = 1;
          releasedCount += 1;
          options.onError(error);
          (completed ??= []).push({ frameId: measurement.frameId, durationMs: undefined });
        }
      }
      if (releasedCount !== 0) {
        pendingScratch.length = 0;
        for (let offset = 0; offset < pending.length; offset += 1) {
          const index = (head + offset) % pending.length;
          if (releasedPending[index] === 0) {
            pendingScratch.push(pending[index]!);
          } else {
            releasedPending[index] = 0;
          }
        }
        const previousPending = pending;
        pending = pendingScratch;
        pendingScratch = previousPending;
        pendingScratch.length = 0;
        nextEvictionIndex = 0;
      }
      if (completed === undefined) return rejected;
      if (rejected.length === 0) return completed;
      completed.unshift(...rejected);
      return completed;
    },
    diagnostics() {
      const head = pending.length === MAX_PENDING_WEBGL_QUERIES ? nextEvictionIndex : 0;
      const oldestPendingFrameId = pending[head]?.frameId;
      return { activeFrameId: active?.frameId, latestFrameId, oldestPendingFrameId, pendingCount: pending.length };
    },
    async dispose() {
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
      pendingScratch = [];
      nextEvictionIndex = 0;
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
    poll: () => EMPTY_GPU_FRAME_MEASUREMENTS,
    diagnostics: () => ({
      activeFrameId: undefined,
      latestFrameId: undefined,
      oldestPendingFrameId: undefined,
      pendingCount: 0,
    }),
    async dispose() {},
  };
}

function assertFrameId(frameId: number): void {
  if (!Number.isSafeInteger(frameId) || frameId < 0) {
    throw new RangeError('GPU frame ID must be a nonnegative safe integer');
  }
}
