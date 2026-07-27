import * as THREE from 'three/webgpu'

export type RendererBackend = 'webgpu' | 'webgl2'

export interface RendererOptions {
  readonly alpha?: boolean
  readonly backend: RendererBackend
  readonly canvas: HTMLCanvasElement
  readonly dpr: number
  readonly width: number
  readonly height: number
  readonly initialClearColor?: number
  readonly trackGpuTimestamps?: boolean
}

export interface RendererViewportState {
  readonly pixelRatio: number
  readonly drawingBufferWidth: number
  readonly drawingBufferHeight: number
}

export async function createConfiguredRenderer(
  options: RendererOptions,
): Promise<THREE.WebGPURenderer> {
  const renderer = new THREE.WebGPURenderer({
    canvas: options.canvas,
    antialias: false,
    alpha: options.alpha ?? false,
    forceWebGL: options.backend === 'webgl2',
    trackTimestamp: options.trackGpuTimestamps ?? false,
  })
  try {
    renderer.setPixelRatio(options.dpr)
    renderer.setSize(options.width, options.height, false)
    renderer.setClearColor(options.initialClearColor ?? 0x070709, 1)
    renderer.toneMapping = THREE.NoToneMapping
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace
    await renderer.init()
    assertRendererBackend(renderer, options.backend)
    renderer.clear()
    return renderer
  } catch (error) {
    await renderer.dispose()
    throw error
  }
}

export function assertRendererBackend(
  renderer: THREE.WebGPURenderer,
  expected: RendererBackend,
): void {
  const matches =
    expected === 'webgpu'
      ? renderer.backend instanceof THREE.WebGPUBackend
      : renderer.backend instanceof THREE.WebGLBackend
  if (!matches) {
    throw new Error(
      `WebGPURenderer initialized ${rendererBackendName(renderer)} instead of ${expected}`,
    )
  }
}

export function rendererBackendName(renderer: THREE.WebGPURenderer): string {
  if (renderer.backend instanceof THREE.WebGPUBackend) return 'webgpu'
  if (renderer.backend instanceof THREE.WebGLBackend) return 'webgl2'
  return renderer.backend.constructor.name
}

export function readRendererViewportState(renderer: THREE.WebGPURenderer): RendererViewportState {
  const drawingBufferSize = renderer.getDrawingBufferSize(new THREE.Vector2())
  const pixelRatio = renderer.getPixelRatio()
  if (!Number.isFinite(pixelRatio) || pixelRatio <= 0) {
    throw new RangeError('renderer pixel ratio must be positive and finite')
  }
  if (
    !Number.isSafeInteger(drawingBufferSize.x) ||
    drawingBufferSize.x <= 0 ||
    !Number.isSafeInteger(drawingBufferSize.y) ||
    drawingBufferSize.y <= 0
  ) {
    throw new RangeError('renderer drawing buffer dimensions must be positive safe integers')
  }
  return {
    pixelRatio,
    drawingBufferWidth: drawingBufferSize.x,
    drawingBufferHeight: drawingBufferSize.y,
  }
}
