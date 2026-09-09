import * as THREE from 'three/webgpu';

export type RendererBackend = 'webgpu' | 'webgl2';

export interface RendererOptions {
  readonly alpha?: boolean;
  readonly backend: RendererBackend;
  readonly canvas: HTMLCanvasElement;
  readonly dpr: number;
  readonly width: number;
  readonly height: number;
  readonly initialClearColor?: number;
  readonly trackGpuTimestamps?: boolean;
}

export interface RendererViewportState {
  readonly pixelRatio: number;
  readonly drawingBufferWidth: number;
  readonly drawingBufferHeight: number;
}

export interface ConfiguredRendererDiagnostics {
  readonly activeCount: number;
  readonly createdCount: number;
  readonly disposedCount: number;
  readonly peakActiveCount: number;
  readonly active: readonly {
    readonly backend: RendererBackend;
    readonly id: number;
  }[];
}

interface ActiveRenderer {
  readonly backend: RendererBackend;
  readonly id: number;
}

const activeRenderers = new Map<THREE.WebGPURenderer, ActiveRenderer>();
let createdRendererCount = 0;
let disposedRendererCount = 0;
let peakActiveRendererCount = 0;

export async function createConfiguredRenderer(options: RendererOptions): Promise<THREE.WebGPURenderer> {
  const renderer = new THREE.WebGPURenderer({
    canvas: options.canvas,
    antialias: false,
    alpha: options.alpha ?? false,
    forceWebGL: options.backend === 'webgl2',
    trackTimestamp: options.trackGpuTimestamps ?? false,
  });
  let initialized = false;
  try {
    renderer.setPixelRatio(options.dpr);
    renderer.setSize(options.width, options.height, false);
    renderer.setClearColor(options.initialClearColor ?? 0x070709, 1);
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
    await renderer.init();
    initialized = true;
    assertRendererBackend(renderer, options.backend);
    renderer.clear();
    registerConfiguredRenderer(renderer, options.backend);
    return renderer;
  } catch (error) {
    if (initialized) {
      await disposeConfiguredRenderer(renderer);
    } else {
      releaseFailedWebGlContext(renderer);
    }
    throw error;
  }
}

/** Disposes only after WebKit acknowledges WebGL context loss; Three.js disposal is synchronous but context release is not, and skipping this wait can exhaust the browser's context budget. */
export async function disposeConfiguredRenderer(renderer: THREE.WebGPURenderer): Promise<void> {
  const contextLoss = monitorWebGlContextLoss(renderer);
  try {
    renderer.dispose();
  } catch (error) {
    contextLoss.cancel();
    unregisterConfiguredRenderer(renderer);
    throw error;
  }
  try {
    await contextLoss.completion;
  } finally {
    unregisterConfiguredRenderer(renderer);
  }
}

export function configuredRendererDiagnostics(): ConfiguredRendererDiagnostics {
  return {
    activeCount: activeRenderers.size,
    createdCount: createdRendererCount,
    disposedCount: disposedRendererCount,
    peakActiveCount: peakActiveRendererCount,
    active: [...activeRenderers.values()],
  };
}

function registerConfiguredRenderer(renderer: THREE.WebGPURenderer, backend: RendererBackend): void {
  const id = ++createdRendererCount;
  activeRenderers.set(renderer, { backend, id });
  peakActiveRendererCount = Math.max(peakActiveRendererCount, activeRenderers.size);
  renderer.domElement.dataset.configuredRendererId = String(id);
  renderer.domElement.dataset.configuredRendererActive = 'true';
  publishConfiguredRendererDiagnostics();
}

function unregisterConfiguredRenderer(renderer: THREE.WebGPURenderer): void {
  if (!activeRenderers.delete(renderer)) return;
  disposedRendererCount += 1;
  renderer.domElement.dataset.configuredRendererActive = 'false';
  publishConfiguredRendererDiagnostics();
}

function publishConfiguredRendererDiagnostics(): void {
  if (typeof document === 'undefined') return;
  const diagnostics = configuredRendererDiagnostics();
  document.documentElement.dataset.activeConfiguredRenderers = String(diagnostics.activeCount);
  document.documentElement.dataset.peakConfiguredRenderers = String(diagnostics.peakActiveCount);
}

interface ContextLossMonitor {
  readonly completion: Promise<void>;
  cancel(): void;
}

function monitorWebGlContextLoss(renderer: THREE.WebGPURenderer): ContextLossMonitor {
  if (!(renderer.backend instanceof THREE.WebGLBackend)) return resolvedContextLossMonitor();
  const canvas = renderer.domElement;
  const context = canvas.getContext('webgl2');
  const loseContext = context?.getExtension('WEBGL_lose_context');
  if (context === null || loseContext === null || context.isContextLost()) {
    return resolvedContextLossMonitor();
  }

  let settle = (): void => undefined;
  const completion = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const finish = (): void => {
    canvas.removeEventListener('webglcontextlost', finish);
    settle();
  };
  canvas.addEventListener('webglcontextlost', finish);
  return {
    completion,
    cancel: finish,
  };
}

function resolvedContextLossMonitor(): ContextLossMonitor {
  return {
    completion: Promise.resolve(),
    cancel() {},
  };
}

function releaseFailedWebGlContext(renderer: THREE.WebGPURenderer): void {
  if (!(renderer.backend instanceof THREE.WebGLBackend)) return;
  renderer.domElement.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
}

export function assertRendererBackend(renderer: THREE.WebGPURenderer, expected: RendererBackend): void {
  const matches =
    expected === 'webgpu'
      ? renderer.backend instanceof THREE.WebGPUBackend
      : renderer.backend instanceof THREE.WebGLBackend;
  if (!matches) {
    throw new Error(`WebGPURenderer initialized ${rendererBackendName(renderer)} instead of ${expected}`);
  }
}

export function rendererBackendName(renderer: THREE.WebGPURenderer): string {
  if (renderer.backend instanceof THREE.WebGPUBackend) return 'webgpu';
  if (renderer.backend instanceof THREE.WebGLBackend) return 'webgl2';
  return renderer.backend.constructor.name;
}

export function readRendererViewportState(renderer: THREE.WebGPURenderer): RendererViewportState {
  const drawingBufferSize = renderer.getDrawingBufferSize(new THREE.Vector2());
  const pixelRatio = renderer.getPixelRatio();
  if (!Number.isFinite(pixelRatio) || pixelRatio <= 0) {
    throw new RangeError('renderer pixel ratio must be positive and finite');
  }
  if (
    !Number.isSafeInteger(drawingBufferSize.x) ||
    drawingBufferSize.x <= 0 ||
    !Number.isSafeInteger(drawingBufferSize.y) ||
    drawingBufferSize.y <= 0
  ) {
    throw new RangeError('renderer drawing buffer dimensions must be positive safe integers');
  }
  return {
    pixelRatio,
    drawingBufferWidth: drawingBufferSize.x,
    drawingBufferHeight: drawingBufferSize.y,
  };
}
