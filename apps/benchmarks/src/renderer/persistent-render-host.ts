import * as THREE from 'three/webgpu';

import { createGpuFrameTimer, type GpuFrameTimer } from './gpu-frame-timer';
import { createLiveFrameTelemetry, type LiveFrameTelemetrySnapshot } from './live-frame-telemetry';
import {
  createConfiguredRenderer,
  disposeConfiguredRenderer,
  readRendererViewportState,
  type RendererBackend,
  type RendererOptions,
} from './webgpu-renderer';

type RendererLifecycleMethod = 'dispose' | 'setAnimationLoop' | 'setPixelRatio' | 'setSize';

/** A scene can issue render commands, but renderer lifecycle and viewport ownership stay with the host. */
export type PersistentRenderSceneRenderer = Omit<THREE.WebGPURenderer, RendererLifecycleMethod>;

export interface PersistentRenderViewport {
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly drawingBufferWidth: number;
  readonly drawingBufferHeight: number;
}

export interface PersistentRenderSceneContext {
  readonly renderer: PersistentRenderSceneRenderer;
  readonly rendererInitMs: number;
  readonly signal: AbortSignal;
  readonly viewport: PersistentRenderViewport;
}

export interface PersistentRenderFrameContext extends PersistentRenderSceneContext {
  readonly frameId: number;
  readonly timestamp: number;
}

export type PersistentRenderJob<T> = (context: PersistentRenderSceneContext) => T;

export type PersistentRenderSceneDeactivation = 'disposed' | 'failed' | 'released' | 'replaced' | 'superseded';

export interface PersistentRenderScene {
  readonly id: string;
  activate(context: PersistentRenderSceneContext): Promise<void> | void;
  frame(context: PersistentRenderFrameContext): void;
  telemetry?(snapshot: LiveFrameTelemetrySnapshot, viewport: PersistentRenderViewport): void;
  resize?(viewport: PersistentRenderViewport): void;
  deactivate?(reason: PersistentRenderSceneDeactivation): Promise<void> | void;
}

export interface PersistentRenderSceneLease {
  readonly generation: number;
  release(): Promise<void>;
}

export interface PersistentRenderHost {
  readonly backend: RendererBackend;
  readonly canvas: HTMLCanvasElement;
  readonly rendererInitMs: number;
  readonly viewport: PersistentRenderViewport;
  readonly latestTelemetry: LiveFrameTelemetrySnapshot | undefined;
  replaceScene(scene: PersistentRenderScene, signal?: AbortSignal): Promise<PersistentRenderSceneLease>;
  runExclusiveJob<T>(job: PersistentRenderJob<T>, signal?: AbortSignal): Promise<Awaited<T>>;
  resize(width: number, height: number, dpr?: number): void;
  subscribeTelemetry(listener: (snapshot: LiveFrameTelemetrySnapshot) => void): () => void;
  dispose(): Promise<void>;
}

interface ActiveScene {
  readonly controller: AbortController;
  readonly generation: number;
  readonly scene: PersistentRenderScene;
  readonly unlinkSignal: () => void;
}

interface PersistentRenderHostDependencies {
  readonly createRenderer: (options: RendererOptions) => Promise<THREE.WebGPURenderer>;
  readonly disposeRenderer: (renderer: THREE.WebGPURenderer) => Promise<void>;
  readonly createFrameTimer: typeof createGpuFrameTimer;
  readonly createTelemetry: typeof createLiveFrameTelemetry;
  readonly now: () => number;
}

export interface PersistentRenderHostOptions {
  readonly backend: RendererBackend;
  readonly canvas: HTMLCanvasElement;
  readonly dpr: number;
  readonly width: number;
  readonly height: number;
  readonly onError: (error: unknown) => void;
  /** Test seam for lifecycle collaborators; production callers should omit it. */
  readonly dependencies?: Partial<PersistentRenderHostDependencies>;
}

const DEFAULT_DEPENDENCIES: PersistentRenderHostDependencies = {
  createRenderer: createConfiguredRenderer,
  disposeRenderer: disposeConfiguredRenderer,
  createFrameTimer: createGpuFrameTimer,
  createTelemetry: createLiveFrameTelemetry,
  now: () => performance.now(),
};

export async function createPersistentRenderHost(options: PersistentRenderHostOptions): Promise<PersistentRenderHost> {
  const width = positive(options.width, 'persistent render-host width');
  const height = positive(options.height, 'persistent render-host height');
  const dpr = positive(options.dpr, 'persistent render-host DPR');
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...options.dependencies };
  const rendererStartedAt = dependencies.now();
  const renderer = await dependencies.createRenderer({
    backend: options.backend,
    canvas: options.canvas,
    dpr,
    height,
    trackGpuTimestamps: options.backend === 'webgpu',
    width,
  });
  const rendererInitMs = Math.max(0, dependencies.now() - rendererStartedAt);
  let frameTimer: GpuFrameTimer | undefined;
  try {
    frameTimer = dependencies.createFrameTimer({
      backend: options.backend,
      renderer,
      onError: options.onError,
    });
    const activeFrameTimer = frameTimer;
    const telemetry = dependencies.createTelemetry({ gpuTimingSupported: activeFrameTimer.supported });
    const borrowedRenderer = renderer as PersistentRenderSceneRenderer;
    const listeners = new Set<(snapshot: LiveFrameTelemetrySnapshot) => void>();
    let logicalWidth = width;
    let logicalHeight = height;
    let pixelRatio = dpr;
    let viewport = readViewport(renderer, logicalWidth, logicalHeight);
    let latestTelemetry: LiveFrameTelemetrySnapshot | undefined;
    let activeScene: ActiveScene | undefined;
    let latestRequest: ActiveScene | undefined;
    let generation = 0;
    let operationTail = Promise.resolve();
    let exclusiveJobActive = false;
    const jobControllers = new Set<AbortController>();
    let disposed = false;
    let disposal: Promise<void> | undefined;

    const publishTelemetry = (snapshot: LiveFrameTelemetrySnapshot): void => {
      latestTelemetry = snapshot;
      for (const listener of listeners) listener(snapshot);
    };

    const deactivate = async (record: ActiveScene, reason: PersistentRenderSceneDeactivation): Promise<void> => {
      record.controller.abort();
      record.unlinkSignal();
      await record.scene.deactivate?.(reason);
    };

    const frame = (timestamp: number): void => {
      if (disposed || exclusiveJobActive) return;
      try {
        for (const measurement of activeFrameTimer.poll()) {
          if (measurement.durationMs === undefined) telemetry.discardGpu(measurement.frameId);
          else telemetry.recordGpu(measurement.frameId, measurement.durationMs);
        }
        const current = activeScene;
        if (current === undefined || current.controller.signal.aborted) return;
        const frameId = telemetry.beginFrame(timestamp);
        const startedAt = dependencies.now();
        if (telemetry.gpuTimingSupported) activeFrameTimer.beginFrame(frameId);
        try {
          current.scene.frame({
            frameId,
            renderer: borrowedRenderer,
            rendererInitMs,
            signal: current.controller.signal,
            timestamp,
            viewport,
          });
        } finally {
          if (telemetry.gpuTimingSupported) activeFrameTimer.endFrame();
        }
        const snapshot = telemetry.endFrame(frameId, Math.max(0, dependencies.now() - startedAt));
        if (snapshot !== undefined) {
          publishTelemetry(snapshot);
          current.scene.telemetry?.(snapshot, viewport);
        }
      } catch (error) {
        options.onError(error);
      }
    };

    await renderer.setAnimationLoop(frame);

    const host: PersistentRenderHost = {
      backend: options.backend,
      canvas: options.canvas,
      rendererInitMs,
      get viewport() {
        return viewport;
      },
      get latestTelemetry() {
        return latestTelemetry;
      },
      replaceScene(scene, signal) {
        if (disposed) return Promise.reject(disposedError());
        const controller = new AbortController();
        const unlinkSignal = linkAbortSignal(signal, controller);
        if (latestRequest !== activeScene) latestRequest?.controller.abort();
        const request: ActiveScene = {
          controller,
          generation: ++generation,
          scene,
          unlinkSignal,
        };
        latestRequest = request;

        const replace = async (): Promise<PersistentRenderSceneLease> => {
          if (disposed) {
            unlinkSignal();
            throw disposedError();
          }
          if (latestRequest !== request || controller.signal.aborted) {
            unlinkSignal();
            throw supersededError();
          }
          const previous = activeScene;
          let sceneDeactivated = false;
          try {
            const activationViewport = viewport;
            await scene.activate({
              renderer: borrowedRenderer,
              rendererInitMs,
              signal: controller.signal,
              viewport: activationViewport,
            });
            if (disposed || latestRequest !== request || controller.signal.aborted) {
              await deactivate(request, 'superseded');
              sceneDeactivated = true;
              throw supersededError();
            }
            if (viewport !== activationViewport) scene.resize?.(viewport);
            activeScene = request;
          } catch (error) {
            if (!sceneDeactivated) {
              try {
                await deactivate(request, controller.signal.aborted ? 'superseded' : 'failed');
              } catch (cleanupError) {
                const failure = new AggregateError(
                  [error, cleanupError],
                  'persistent render scene activation and cleanup failed',
                );
                failure.cause = cleanupError;
                throw failure;
              }
            }
            throw error;
          }
          if (previous !== undefined && previous !== request) {
            try {
              await deactivate(previous, 'replaced');
            } catch (error) {
              options.onError(error);
            }
          }
          let released = false;
          return {
            generation: request.generation,
            release() {
              if (released) return Promise.resolve();
              released = true;
              controller.abort();
              const release = async (): Promise<void> => {
                if (activeScene !== request) return;
                activeScene = undefined;
                await deactivate(request, 'released');
              };
              const result = operationTail.then(release, release);
              operationTail = result.then(
                () => undefined,
                () => undefined,
              );
              return result;
            },
          };
        };
        const result = operationTail.then(replace, replace);
        operationTail = result.then(
          () => undefined,
          () => undefined,
        );
        return result;
      },
      runExclusiveJob(job, signal) {
        if (disposed) return Promise.reject(disposedError());
        const controller = new AbortController();
        const unlinkSignal = linkAbortSignal(signal, controller);
        jobControllers.add(controller);

        const run = async (): Promise<Awaited<ReturnType<typeof job>>> => {
          if (disposed) throw disposedError();
          if (controller.signal.aborted) throw abortedJobError(controller.signal);
          exclusiveJobActive = true;
          try {
            return await job({
              renderer: borrowedRenderer,
              rendererInitMs,
              signal: controller.signal,
              viewport,
            });
          } finally {
            exclusiveJobActive = false;
          }
        };
        const result = operationTail.then(run, run);
        operationTail = result.then(
          () => undefined,
          () => undefined,
        );
        const cleanUp = (): void => {
          jobControllers.delete(controller);
          unlinkSignal();
        };
        void result.then(cleanUp, cleanUp);
        return result;
      },
      resize(nextWidth, nextHeight, nextDpr = pixelRatio) {
        if (disposed) throw disposedError();
        logicalWidth = positive(nextWidth, 'persistent render-host width');
        logicalHeight = positive(nextHeight, 'persistent render-host height');
        const validatedDpr = positive(nextDpr, 'persistent render-host DPR');
        if (validatedDpr !== pixelRatio) {
          pixelRatio = validatedDpr;
          renderer.setPixelRatio(pixelRatio);
        }
        renderer.setSize(logicalWidth, logicalHeight, false);
        viewport = readViewport(renderer, logicalWidth, logicalHeight);
        activeScene?.scene.resize?.(viewport);
      },
      subscribeTelemetry(listener) {
        if (disposed) throw disposedError();
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      dispose() {
        if (disposal !== undefined) return disposal;
        disposed = true;
        latestRequest?.controller.abort();
        for (const controller of jobControllers) controller.abort(disposedError());
        disposal = (async () => {
          await renderer.setAnimationLoop(null);
          await operationTail;
          const current = activeScene;
          activeScene = undefined;
          if (current !== undefined) await deactivate(current, 'disposed');
          listeners.clear();
          await activeFrameTimer.dispose();
          await dependencies.disposeRenderer(renderer);
        })();
        return disposal;
      },
    };
    return host;
  } catch (error) {
    await frameTimer?.dispose();
    await dependencies.disposeRenderer(renderer);
    throw error;
  }
}

function readViewport(renderer: THREE.WebGPURenderer, width: number, height: number): PersistentRenderViewport {
  const state = readRendererViewportState(renderer);
  return {
    width,
    height,
    dpr: state.pixelRatio,
    drawingBufferWidth: state.drawingBufferWidth,
    drawingBufferHeight: state.drawingBufferHeight,
  };
}

function linkAbortSignal(signal: AbortSignal | undefined, controller: AbortController): () => void {
  if (signal === undefined) return () => undefined;
  const abort = (): void => controller.abort(signal.reason);
  if (signal.aborted) abort();
  else signal.addEventListener('abort', abort, { once: true });
  return () => signal.removeEventListener('abort', abort);
}

function positive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be positive`);
  return value;
}

function supersededError(): DOMException {
  return new DOMException('persistent render scene was superseded', 'AbortError');
}

function disposedError(): DOMException {
  return new DOMException('persistent render host is disposed', 'InvalidStateError');
}

function abortedJobError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('persistent render job was aborted', 'AbortError');
}
