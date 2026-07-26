import * as THREE from 'three/webgpu'
import { float, mul, vec3 } from 'three/tsl'
import type Node from 'three/src/nodes/core/Node.js'

import type { BenchmarkTarget, TargetRunOutput } from '../benchmark/contracts'

const TARGET_SIZE = 4
const EXPECTED_PIXEL = [255, 0, 0, 255] as const

type RendererBackend = 'webgpu' | 'webgl2'
type MultiplyFloat = (left: Node<'float'>, right: number) => Node<'float'>

const multiplyFloat: MultiplyFloat = mul

interface BaselineResources {
  readonly backend: RendererBackend
  readonly renderer: THREE.WebGPURenderer
  readonly scene: THREE.Scene
  readonly camera: THREE.OrthographicCamera
  readonly target: THREE.RenderTarget
  readonly geometry: THREE.PlaneGeometry
  readonly material: THREE.MeshBasicNodeMaterial
}

type BaselineState =
  | { readonly kind: 'empty' }
  | { readonly kind: 'ready'; readonly resources: BaselineResources }

export function createTslBaselineTarget(backend: RendererBackend): BenchmarkTarget {
  let state: BaselineState = { kind: 'empty' }
  return {
    id: `tsl-${backend}-baseline`,
    label: backend === 'webgpu' ? 'TSL WebGPU baseline' : 'TSL WebGL2 fallback baseline',
    detail: 'WebGPURenderer · TSL · deterministic readback',
    color: backend === 'webgpu' ? 'cyan' : 'amber',
    capabilities: new Set(['deterministic', 'raster']),
    status: () => 'ready',
    load: async () => {
      if (state.kind === 'ready') return
      state = { kind: 'ready', resources: await createResources(backend) }
    },
    run: async () => {
      if (state.kind !== 'ready') throw new Error('TSL baseline target was not loaded')
      return renderBaseline(state.resources)
    },
    dispose: async () => {
      if (state.kind !== 'ready') return
      const resources = state.resources
      state = { kind: 'empty' }
      resources.target.dispose()
      resources.geometry.dispose()
      resources.material.dispose()
      await resources.renderer.dispose()
    },
  }
}

async function createResources(backend: RendererBackend): Promise<BaselineResources> {
  const canvas = document.createElement('canvas')
  canvas.width = TARGET_SIZE
  canvas.height = TARGET_SIZE
  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: false,
    alpha: false,
    forceWebGL: backend === 'webgl2',
  })
  let target: THREE.RenderTarget | undefined
  let geometry: THREE.PlaneGeometry | undefined
  let material: THREE.MeshBasicNodeMaterial | undefined
  try {
    renderer.setPixelRatio(1)
    renderer.setSize(TARGET_SIZE, TARGET_SIZE, false)
    renderer.toneMapping = THREE.NoToneMapping
    renderer.outputColorSpace = THREE.LinearSRGBColorSpace
    await renderer.init()
    assertBackend(renderer, backend)

    target = new THREE.RenderTarget(TARGET_SIZE, TARGET_SIZE, {
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
    })
    target.texture.colorSpace = THREE.NoColorSpace
    target.texture.generateMipmaps = false

    geometry = new THREE.PlaneGeometry(2, 2)
    material = new THREE.MeshBasicNodeMaterial({ depthTest: false, depthWrite: false })
    const half: Node<'float'> = float(0.5)
    const redChannel: Node<'float'> = multiplyFloat(half, 2)
    const red: Node<'vec3'> = vec3(redChannel, 0, 0)
    material.colorNode = red

    const scene = new THREE.Scene()
    scene.add(new THREE.Mesh(geometry, material))
    return {
      backend,
      renderer,
      scene,
      camera: new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1),
      target,
      geometry,
      material,
    }
  } catch (error) {
    target?.dispose()
    geometry?.dispose()
    material?.dispose()
    await renderer.dispose()
    throw error
  }
}

function assertBackend(renderer: THREE.WebGPURenderer, expected: RendererBackend): void {
  const matches =
    expected === 'webgpu'
      ? renderer.backend instanceof THREE.WebGPUBackend
      : renderer.backend instanceof THREE.WebGLBackend
  if (!matches) {
    throw new Error(`WebGPURenderer initialized ${backendName(renderer)} instead of ${expected}`)
  }
}

function backendName(renderer: THREE.WebGPURenderer): string {
  if (renderer.backend instanceof THREE.WebGPUBackend) return 'webgpu'
  if (renderer.backend instanceof THREE.WebGLBackend) return 'webgl2'
  return renderer.backend.constructor.name
}

async function renderBaseline(resources: BaselineResources): Promise<TargetRunOutput> {
  const { renderer, scene, camera, target } = resources
  renderer.setRenderTarget(target)
  renderer.setClearColor(0x000000, 1)
  renderer.clear()
  renderer.render(scene, camera)
  const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, TARGET_SIZE, TARGET_SIZE)
  renderer.setRenderTarget(null)
  const bytes = compactRgba8Readback(
    new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength),
    TARGET_SIZE,
    TARGET_SIZE,
  )
  assertTslBaselinePixels(bytes)
  return {
    bytes: bytes.byteLength,
    hash: await sha256(bytes),
    metrics: {
      backendWebGpu: resources.backend === 'webgpu' ? 1 : 0,
      backendWebGl2: resources.backend === 'webgl2' ? 1 : 0,
      pixelCount: TARGET_SIZE * TARGET_SIZE,
      exactRedPixels: TARGET_SIZE * TARGET_SIZE,
    },
  }
}

export function compactRgba8Readback(
  source: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const rowBytes = width * 4
  const compactLength = rowBytes * height
  if (source.byteLength === compactLength) return source.slice()
  const paddedRowBytes = Math.ceil(rowBytes / 256) * 256
  const paddedLength = (height - 1) * paddedRowBytes + rowBytes
  if (source.byteLength !== paddedLength) {
    throw new Error(
      `RGBA8 readback returned ${source.byteLength} bytes; expected ${compactLength} compact or ${paddedLength} WebGPU-padded bytes`,
    )
  }
  const compact = new Uint8Array(compactLength)
  for (let row = 0; row < height; row += 1) {
    const sourceOffset = row * paddedRowBytes
    compact.set(source.subarray(sourceOffset, sourceOffset + rowBytes), row * rowBytes)
  }
  return compact
}

export function assertTslBaselinePixels(bytes: Uint8Array): void {
  const expectedLength = TARGET_SIZE * TARGET_SIZE * EXPECTED_PIXEL.length
  if (bytes.byteLength !== expectedLength) {
    throw new Error(`TSL baseline returned ${bytes.byteLength} bytes instead of ${expectedLength}`)
  }
  for (let offset = 0; offset < bytes.byteLength; offset += EXPECTED_PIXEL.length) {
    for (let channel = 0; channel < EXPECTED_PIXEL.length; channel += 1) {
      if (bytes[offset + channel] !== EXPECTED_PIXEL[channel]) {
        throw new Error(
          `TSL baseline pixel ${offset / EXPECTED_PIXEL.length} channel ${channel} was ${String(bytes[offset + channel])} instead of ${String(EXPECTED_PIXEL[channel])}`,
        )
      }
    }
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice())
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}
