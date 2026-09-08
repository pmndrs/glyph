import { createContext, use, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

import { RuntimeCanvasSettings, useRuntimeWorld } from '../benchmark/runtime-world';
import type { CanvasViewController } from './canvas-view-controller';
import {
  createPersistentRenderHost,
  type PersistentRenderHost,
  type PersistentRenderJob,
  type PersistentRenderScene,
  type PersistentRenderSceneLease,
} from './persistent-render-host';
import type { RendererBackend } from './webgpu-renderer';

interface CanvasInteractionBinding {
  dispose(): void;
  reset(): void;
}

interface CanvasSettingsSnapshot {
  readonly controller: CanvasViewController | undefined;
  readonly panEnabled: boolean;
  readonly zoomEnabled: boolean;
}

interface PersistentRenderSurfaceSettings {
  readonly controller: RefObject<CanvasViewController | undefined>;
  readonly label: string;
  readonly pan: boolean;
  readonly zoom: boolean;
}

interface PersistentRenderSurfaceRequest extends PersistentRenderSurfaceSettings {
  readonly anchor: HTMLElement;
  readonly scene: PersistentRenderScene;
}

interface PersistentRenderSurfaceLease {
  release(): Promise<void>;
}

interface PersistentRenderHostContextValue {
  activateSurface(request: PersistentRenderSurfaceRequest, signal?: AbortSignal): Promise<PersistentRenderSurfaceLease>;
  configureSurface(settings: PersistentRenderSurfaceSettings): void;
  runExclusiveJob<T>(job: PersistentRenderJob<T>, signal?: AbortSignal): Promise<Awaited<T>>;
}

const PersistentRenderHostContext = createContext<PersistentRenderHostContextValue | undefined>(undefined);

export function PersistentRenderHostProvider({
  backend,
  children,
  dpr,
  onError,
}: {
  readonly backend: RendererBackend;
  readonly children: ReactNode;
  readonly dpr: number;
  readonly onError: (error: unknown) => void;
}) {
  const runtimeWorld = useRuntimeWorld();
  const [canvas] = useState(() => document.createElement('canvas'));
  const canvasRef = useRef(canvas);
  const dprRef = useRef(dpr);
  const hostRef = useRef<PersistentRenderHost | undefined>(undefined);
  const hostPromiseRef = useRef<Promise<PersistentRenderHost> | undefined>(undefined);
  const activeAnchorRef = useRef<HTMLElement | undefined>(undefined);
  const interactionRef = useRef<CanvasInteractionBinding | undefined>(undefined);
  const surfaceGenerationRef = useRef(0);
  const ensureHost = async (width: number, height: number): Promise<PersistentRenderHost> => {
    let host = hostRef.current;
    if (host !== undefined) return host;
    if (hostPromiseRef.current === undefined) {
      hostPromiseRef.current = createPersistentRenderHost({
        backend,
        canvas: canvasRef.current,
        dpr: dprRef.current,
        height,
        width,
        onError,
      });
    }
    host = await hostPromiseRef.current;
    hostRef.current = host;
    return host;
  };

  const configureSurface = (settings: PersistentRenderSurfaceSettings): void => {
    runtimeWorld.set(RuntimeCanvasSettings, {
      controller: settings.controller.current,
      label: settings.label,
      panEnabled: settings.pan,
      zoomEnabled: settings.zoom,
    });
    prepareCanvas(canvas, settings);
  };

  useEffect(() => {
    dprRef.current = dpr;
    const host = hostRef.current;
    const anchor = activeAnchorRef.current;
    if (host !== undefined && anchor !== undefined) {
      host.resize(Math.max(1, anchor.clientWidth), Math.max(1, anchor.clientHeight), dpr);
    }
  }, [dpr]);

  useEffect(
    () => () => {
      interactionRef.current?.dispose();
      interactionRef.current = undefined;
      canvas.remove();
      runtimeWorld.set(RuntimeCanvasSettings, {
        controller: undefined,
        label: 'Text rendering canvas',
        panEnabled: false,
        zoomEnabled: false,
      });
      const host = hostRef.current;
      hostRef.current = undefined;
      hostPromiseRef.current = undefined;
      if (host !== undefined) void host.dispose().catch(onError);
    },
    [canvas, onError, runtimeWorld],
  );

  const activateSurface = async (
    request: PersistentRenderSurfaceRequest,
    signal?: AbortSignal,
  ): Promise<PersistentRenderSurfaceLease> => {
    signal?.throwIfAborted();
    const generation = ++surfaceGenerationRef.current;
    activeAnchorRef.current = request.anchor;
    configureSurface(request);
    if (interactionRef.current === undefined) {
      interactionRef.current = bindCanvasInteraction(canvas, () => runtimeWorld.get(RuntimeCanvasSettings));
    }
    interactionRef.current.reset();
    request.anchor.prepend(canvas);

    const width = Math.max(1, request.anchor.clientWidth);
    const height = Math.max(1, request.anchor.clientHeight);
    const host = await ensureHost(width, height);
    signal?.throwIfAborted();
    if (surfaceGenerationRef.current !== generation) {
      throw new DOMException('persistent render surface was superseded', 'AbortError');
    }
    host.resize(width, height, dprRef.current);

    const observer = new ResizeObserver(() => {
      if (surfaceGenerationRef.current !== generation) return;
      host.resize(Math.max(1, request.anchor.clientWidth), Math.max(1, request.anchor.clientHeight), dprRef.current);
    });
    observer.observe(request.anchor);
    let sceneLease: PersistentRenderSceneLease;
    try {
      sceneLease = await host.replaceScene(request.scene, signal);
    } catch (error) {
      observer.disconnect();
      throw error;
    }
    return createSurfaceLease(sceneLease, observer, generation, surfaceGenerationRef, activeAnchorRef, runtimeWorld);
  };

  const runExclusiveJob = async <T,>(job: PersistentRenderJob<T>, signal?: AbortSignal): Promise<Awaited<T>> => {
    signal?.throwIfAborted();
    const anchor = activeAnchorRef.current;
    const host = await ensureHost(Math.max(1, anchor?.clientWidth ?? 1), Math.max(1, anchor?.clientHeight ?? 1));
    signal?.throwIfAborted();
    return host.runExclusiveJob(job, signal);
  };

  const value: PersistentRenderHostContextValue = { activateSurface, configureSurface, runExclusiveJob };
  // React Compiler retains this context value and its functions. Manual memoization makes React Doctor reject the
  // provider, while the generic JSX lint rule cannot observe the compiler transform.
  // oxlint-disable-next-line react/jsx-no-constructed-context-values
  return <PersistentRenderHostContext value={value}>{children}</PersistentRenderHostContext>;
}

export function usePersistentRenderHost(): PersistentRenderHostContextValue {
  const value = use(PersistentRenderHostContext);
  if (value === undefined) throw new Error('persistent render host is missing its provider');
  return value;
}

function createSurfaceLease(
  sceneLease: PersistentRenderSceneLease,
  observer: ResizeObserver,
  generation: number,
  surfaceGenerationRef: RefObject<number>,
  activeAnchorRef: RefObject<HTMLElement | undefined>,
  runtimeWorld: ReturnType<typeof useRuntimeWorld>,
): PersistentRenderSurfaceLease {
  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      observer.disconnect();
      await sceneLease.release();
      if (surfaceGenerationRef.current !== generation) return;
      activeAnchorRef.current = undefined;
      // Keep the provider-owned canvas attached while a replacement effect activates. Its last complete frame is a
      // better handoff than a DOM detach/reattach flash; provider teardown and anchor removal still detach it.
      runtimeWorld.set(RuntimeCanvasSettings, {
        controller: undefined,
        label: 'Text rendering canvas',
        panEnabled: false,
        zoomEnabled: false,
      });
    },
  };
}

function prepareCanvas(canvas: HTMLCanvasElement, settings: PersistentRenderSurfaceSettings): void {
  canvas.ariaLabel = settings.label;
  canvas.className = `absolute inset-0 size-full touch-none bg-background ${settings.pan ? 'cursor-grab active:cursor-grabbing' : ''}`;
  canvas.style.backgroundColor = '#070709';
  canvas.dataset.panEnabled = String(settings.pan);
  canvas.dataset.panX = '0';
  canvas.dataset.panY = '0';
  canvas.dataset.touchPan = settings.pan ? 'two-finger' : 'disabled';
  canvas.dataset.zoom = '1';
  canvas.dataset.zoomEnabled = String(settings.zoom);
}

function bindCanvasInteraction(
  canvas: HTMLCanvasElement,
  readSettings: () => CanvasSettingsSnapshot | undefined,
): CanvasInteractionBinding {
  const pointers = new Map<number, { readonly x: number; readonly y: number }>();
  let gesture: { readonly centerX: number; readonly centerY: number; readonly distance?: number } | undefined;
  let panX = 0;
  let panY = 0;
  let zoomScale = 1;

  const publish = (): void => {
    canvas.dataset.panX = String(panX);
    canvas.dataset.panY = String(panY);
    canvas.dataset.zoom = String(zoomScale);
  };
  const snapshot = (): typeof gesture => {
    const positions = [...pointers.values()];
    if (positions.length === 0) return undefined;
    const first = positions[0]!;
    if (positions.length === 1) return { centerX: first.x, centerY: first.y };
    const second = positions[1]!;
    return {
      centerX: (first.x + second.x) / 2,
      centerY: (first.y + second.y) / 2,
      distance: Math.hypot(second.x - first.x, second.y - first.y),
    };
  };
  const pointerDown = (event: PointerEvent): void => {
    const settings = readSettings();
    if (settings === undefined || (!settings.panEnabled && !settings.zoomEnabled)) return;
    if (event.pointerType !== 'touch' && event.button !== 0) return;
    if (event.isTrusted) canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    gesture = snapshot();
  };
  const pointerMove = (event: PointerEvent): void => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const previous = gesture;
    const next = snapshot();
    gesture = next;
    if (previous === undefined || next === undefined) return;
    const settings = readSettings();
    if (settings?.panEnabled === true && (event.pointerType !== 'touch' || pointers.size >= 2)) {
      const deltaX = next.centerX - previous.centerX;
      const deltaY = next.centerY - previous.centerY;
      const applied = settings.controller?.panBy(deltaX, deltaY);
      panX += applied?.deltaX ?? deltaX;
      panY += applied?.deltaY ?? deltaY;
    }
    if (
      settings?.zoomEnabled === true &&
      previous.distance !== undefined &&
      next.distance !== undefined &&
      previous.distance > 0
    ) {
      const factor = next.distance / previous.distance;
      zoomScale *= factor;
      settings.controller?.zoomBy?.(factor);
    }
    publish();
  };
  const pointerEnd = (event: PointerEvent): void => {
    if (!pointers.delete(event.pointerId)) return;
    gesture = snapshot();
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  const resetState = (): void => {
    pointers.clear();
    gesture = undefined;
    panX = 0;
    panY = 0;
    zoomScale = 1;
    publish();
  };
  const resetView = (): void => {
    resetState();
    readSettings()?.controller?.resetView();
  };
  const wheel = (event: WheelEvent): void => {
    const settings = readSettings();
    if (settings?.zoomEnabled !== true) return;
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.0015);
    zoomScale *= factor;
    settings.controller?.zoomBy?.(factor);
    publish();
  };

  canvas.addEventListener('dblclick', resetView);
  canvas.addEventListener('pointercancel', pointerEnd);
  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerEnd);
  canvas.addEventListener('wheel', wheel, { passive: false });
  return {
    dispose() {
      canvas.removeEventListener('dblclick', resetView);
      canvas.removeEventListener('pointercancel', pointerEnd);
      canvas.removeEventListener('pointerdown', pointerDown);
      canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', pointerEnd);
      canvas.removeEventListener('wheel', wheel);
    },
    reset: resetState,
  };
}
