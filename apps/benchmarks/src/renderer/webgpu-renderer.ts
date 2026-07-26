import * as THREE from 'three/webgpu'

export type RendererBackend = 'webgpu' | 'webgl2'

export interface RendererOptions {
  readonly alpha?: boolean
  readonly backend: RendererBackend
  readonly canvas: HTMLCanvasElement
  readonly dpr: number
  readonly width: number
  readonly height: number
}

export async function createConfiguredRenderer(
  options: RendererOptions,
): Promise<THREE.WebGPURenderer> {
  const renderer = new THREE.WebGPURenderer({
    canvas: options.canvas,
    antialias: false,
    alpha: options.alpha ?? false,
    forceWebGL: options.backend === 'webgl2',
  })
  try {
    renderer.setPixelRatio(options.dpr)
    renderer.setSize(options.width, options.height, false)
    renderer.toneMapping = THREE.NoToneMapping
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace
    await renderer.init()
    assertRendererBackend(renderer, options.backend)
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
