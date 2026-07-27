import * as THREE from 'three/webgpu'
import type { Node } from 'three/webgpu'
import { float, mul, vec3 } from 'three/tsl'

import type { BenchmarkTarget, TargetRunOutput } from '../benchmark/contracts'
import { createConfiguredRenderer, type RendererBackend } from './webgpu-renderer'

const TARGET_SIZE = 4
const EXPECTED_PIXEL = [255, 0, 0, 255] as const

interface BaselineResources {
  readonly backend: RendererBackend
  readonly dpr: number
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
    load: async (controls) => {
      if (state.kind === 'ready') return
      state = { kind: 'ready', resources: await createResources(backend, controls.dpr) }
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

async function createResources(backend: RendererBackend, dpr: number): Promise<BaselineResources> {
  const canvas = document.createElement('canvas')
  canvas.width = TARGET_SIZE
  canvas.height = TARGET_SIZE
  const renderer = await createConfiguredRenderer({
    canvas,
    dpr,
    width: TARGET_SIZE,
    height: TARGET_SIZE,
    backend,
  })
  let target: THREE.RenderTarget | undefined
  let geometry: THREE.PlaneGeometry | undefined
  let material: THREE.MeshBasicNodeMaterial | undefined
  try {
    const physicalSize = Math.round(TARGET_SIZE * dpr)
    target = new THREE.RenderTarget(physicalSize, physicalSize, {
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
    const redChannel: Node<'float'> = mul(half, 2)
    const red: Node<'vec3'> = vec3(redChannel, 0, 0)
    material.colorNode = red

    const scene = new THREE.Scene()
    scene.add(new THREE.Mesh(geometry, material))
    return {
      backend,
      dpr,
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

async function renderBaseline(resources: BaselineResources): Promise<TargetRunOutput> {
  const { renderer, scene, camera, target } = resources
  const physicalSize = Math.round(TARGET_SIZE * resources.dpr)
  renderer.setRenderTarget(target)
  renderer.setClearColor(0x000000, 1)
  renderer.clear()
  renderer.render(scene, camera)
  const pixels = await renderer.readRenderTargetPixelsAsync(
    target,
    0,
    0,
    physicalSize,
    physicalSize,
  )
  renderer.setRenderTarget(null)
  const bytes = compactRgba8Readback(
    new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength),
    physicalSize,
    physicalSize,
    resources.backend === 'webgl2' ? 'bottom-to-top' : 'top-to-bottom',
  )
  assertTslBaselinePixels(bytes, physicalSize)
  return {
    bytes: bytes.byteLength,
    hash: await sha256(bytes),
    metrics: {
      backendWebGpu: resources.backend === 'webgpu' ? 1 : 0,
      backendWebGl2: resources.backend === 'webgl2' ? 1 : 0,
      dpr: resources.dpr,
      pixelCount: physicalSize * physicalSize,
      exactRedPixels: physicalSize * physicalSize,
      renderTargetGpuBytes: bytes.byteLength,
    },
  }
}

export function compactRgba8Readback(
  source: Uint8Array,
  width: number,
  height: number,
  rowOrder: 'top-to-bottom' | 'bottom-to-top' = 'top-to-bottom',
): Uint8Array {
  const rowBytes = width * 4
  const compactLength = rowBytes * height
  const sourceRowBytes =
    source.byteLength === compactLength ? rowBytes : Math.ceil(rowBytes / 256) * 256
  const expectedLength = (height - 1) * sourceRowBytes + rowBytes
  if (source.byteLength !== expectedLength) {
    throw new Error(
      `RGBA8 readback returned ${source.byteLength} bytes; expected ${compactLength} compact or ${expectedLength} aligned bytes`,
    )
  }
  const compact = new Uint8Array(compactLength)
  // WebGPU copies rows from the top-left; WebGL readPixels returns bottom-left rows.
  for (let row = 0; row < height; row += 1) {
    const sourceRow = rowOrder === 'bottom-to-top' ? height - row - 1 : row
    const sourceOffset = sourceRow * sourceRowBytes
    compact.set(source.subarray(sourceOffset, sourceOffset + rowBytes), row * rowBytes)
  }
  return compact
}

export function assertTslBaselinePixels(bytes: Uint8Array, physicalSize = TARGET_SIZE): void {
  const expectedLength = physicalSize * physicalSize * EXPECTED_PIXEL.length
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
