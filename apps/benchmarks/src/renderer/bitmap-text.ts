import {
  createParagraphEngine,
  createRuntimeShaper,
  FontRegistry,
  type GlyphPaint,
  type Paragraph,
  type RuntimeShaper,
  type RegisteredFont,
} from '@pmndrs/text'
import {
  bitmap,
  bitmapRasterKey,
  type BitmapDrawBatch,
  type BitmapResource,
} from '@pmndrs/text/raster/bitmap'
import shaperWasmUrl from '@pmndrs/text/text-shaper.wasm?url'
import * as THREE from 'three/webgpu'

import bitmapFontUrl from '../../fixtures/rendering/inter-bitmap-16.font.glb?url'
import type { BenchmarkTarget, TargetRunOutput } from '../benchmark/contracts'
import { compactRgba8Readback } from './tsl-baseline'
import { createConfiguredRenderer, type RendererBackend } from './webgpu-renderer'

const WIDTH = 320
const HEIGHT = 96
const bitmapRequest = bitmap({ strikes: [16] as const })

interface BitmapTextResources {
  readonly backend: RendererBackend
  readonly dpr: number
  readonly renderer: THREE.WebGPURenderer
  readonly target: THREE.RenderTarget
  readonly scene: THREE.Scene
  readonly camera: THREE.OrthographicCamera
  readonly font: RegisteredFont
  readonly shaper: RuntimeShaper
  readonly paragraph: Paragraph
  readonly bitmap: BitmapResource
  readonly batch: BitmapDrawBatch
  readonly atlasGpuBytes: number
}

type BitmapTextState =
  | { readonly kind: 'empty' }
  | { readonly kind: 'ready'; readonly resources: BitmapTextResources }

export function createBitmapTextTarget(backend: RendererBackend): BenchmarkTarget {
  let state: BitmapTextState = { kind: 'empty' }
  return {
    id: `bitmap-text-${backend}`,
    label: backend === 'webgpu' ? 'Bitmap text · WebGPU' : 'Bitmap text · WebGL2 fallback',
    detail: 'Inter GLB · HarfRust layout · R8 KTX2 · instanced TSL',
    color: backend === 'webgpu' ? 'cyan' : 'amber',
    capabilities: new Set([
      'deterministic',
      'font-bytes',
      'wasm',
      'shaping',
      'paragraph',
      'raster',
    ]),
    status: () => 'ready',
    load: async (controls) => {
      if (state.kind === 'ready') return
      state = { kind: 'ready', resources: await createResources(backend, controls.dpr) }
    },
    run: async () => {
      if (state.kind !== 'ready') throw new Error('bitmap text target was not loaded')
      return renderBitmapText(state.resources)
    },
    dispose: async () => {
      if (state.kind !== 'ready') return
      const resources = state.resources
      state = { kind: 'empty' }
      resources.batch.dispose()
      bitmapRequest.module.dispose(resources.bitmap)
      resources.paragraph.dispose()
      resources.shaper.dispose()
      resources.font.dispose()
      resources.target.dispose()
      await resources.renderer.dispose()
    },
  }
}

async function createResources(
  backend: RendererBackend,
  dpr: number,
): Promise<BitmapTextResources> {
  const canvas = document.createElement('canvas')
  canvas.width = WIDTH
  canvas.height = HEIGHT
  const renderer = await createConfiguredRenderer({
    canvas,
    width: WIDTH,
    height: HEIGHT,
    backend,
    dpr,
  })
  let target: THREE.RenderTarget | undefined
  let font: RegisteredFont | undefined
  let shaper: RuntimeShaper | undefined
  let paragraph: Paragraph | undefined
  let resource: BitmapResource | undefined
  let batch: BitmapDrawBatch | undefined
  try {
    const [fontResponse, shaperResponse] = await Promise.all([
      fetch(bitmapFontUrl),
      fetch(shaperWasmUrl),
    ])
    if (!fontResponse.ok)
      throw new Error(`Unable to load bitmap font fixture (${fontResponse.status})`)
    if (!shaperResponse.ok)
      throw new Error(`Unable to load text shaper Wasm (${shaperResponse.status})`)
    const [fontBytes, shaperWasm] = await Promise.all([
      fontResponse.arrayBuffer(),
      shaperResponse.arrayBuffer(),
    ])
    const registry = new FontRegistry()
    font = await registry.registerAsset(new Uint8Array(fontBytes))
    shaper = await createRuntimeShaper({ registry, wasm: shaperWasm })
    paragraph = createParagraphEngine({ shaper }).create({
      text: 'pmndrs text',
      font: font.handle,
      style: {
        fontSize: 48,
        lineHeight: 1,
        language: 'en',
        direction: 'ltr',
        features: [],
      },
    })
    const layout = paragraph.layout()
    const raster = await font.loadRaster({
      rasterKey: await bitmapRasterKey({ strikes: [16] as const }),
      kind: 'bitmap',
    })
    resource = await bitmapRequest.module.decode(font, raster)
    await bitmapRequest.module.prepare(layout, resource, 0)
    const paint: GlyphPaint = {
      paintIndices: new Uint16Array(layout.glyphIds.length),
      palette: [{ color: [1, 1, 1, 1] }],
    }
    batch = bitmapRequest.module.buildBatches(layout, resource, 0, paint)
    batch.object.position.set(12, -12, 0)

    const scene = new THREE.Scene()
    scene.add(batch.object)
    const camera = new THREE.OrthographicCamera(0, WIDTH, 0, -HEIGHT, 0.1, 10)
    camera.position.z = 1
    camera.updateProjectionMatrix()
    target = new THREE.RenderTarget(Math.round(WIDTH * dpr), Math.round(HEIGHT * dpr), {
      depthBuffer: false,
      stencilBuffer: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
    })
    target.texture.colorSpace = THREE.NoColorSpace
    target.texture.generateMipmaps = false
    return {
      backend,
      dpr,
      renderer,
      target,
      scene,
      camera,
      font,
      shaper,
      paragraph,
      bitmap: resource,
      batch,
      atlasGpuBytes: resource.strikes.reduce(
        (strikeBytes, strike) =>
          strikeBytes +
          strike.pages.reduce((pageBytes, page) => pageBytes + page.width * page.height, 0),
        0,
      ),
    }
  } catch (error) {
    batch?.dispose()
    if (resource !== undefined) bitmapRequest.module.dispose(resource)
    paragraph?.dispose()
    shaper?.dispose()
    font?.dispose()
    target?.dispose()
    await renderer.dispose()
    throw error
  }
}

async function renderBitmapText(resources: BitmapTextResources): Promise<TargetRunOutput> {
  const { renderer, target, scene, camera } = resources
  const physicalWidth = Math.round(WIDTH * resources.dpr)
  const physicalHeight = Math.round(HEIGHT * resources.dpr)
  renderer.setRenderTarget(target)
  renderer.setClearColor(0x000000, 1)
  renderer.clear()
  const renderStarted = performance.now()
  renderer.render(scene, camera)
  const renderMs = performance.now() - renderStarted
  const pixels = await renderer.readRenderTargetPixelsAsync(
    target,
    0,
    0,
    physicalWidth,
    physicalHeight,
  )
  renderer.setRenderTarget(null)
  const bytes = compactRgba8Readback(
    new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength),
    physicalWidth,
    physicalHeight,
    resources.backend === 'webgl2' ? 'bottom-to-top' : 'top-to-bottom',
  )
  const quality = assertBitmapTextPixels(bytes, physicalWidth, physicalHeight)
  return {
    bytes: bytes.byteLength,
    hash: await sha256(bytes),
    metrics: {
      backendWebGpu: resources.backend === 'webgpu' ? 1 : 0,
      backendWebGl2: resources.backend === 'webgl2' ? 1 : 0,
      dpr: resources.dpr,
      glyphCount: resources.batch.glyphCount,
      drawCount: resources.batch.drawCount,
      atlasGpuBytes: resources.atlasGpuBytes,
      renderTargetGpuBytes: bytes.byteLength,
      totalGpuBytes: resources.atlasGpuBytes + bytes.byteLength,
      litPixels: quality.litPixels,
      inkPixels: quality.inkPixels,
      inkMinX: quality.inkMinX,
      inkMinY: quality.inkMinY,
      inkMaxX: quality.inkMaxX,
      inkMaxY: quality.inkMaxY,
      renderMs,
    },
  }
}

export function assertBitmapTextPixels(
  bytes: Uint8Array,
  width: number,
  height: number,
): {
  readonly litPixels: number
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
  readonly inkPixels: number
  readonly inkMinX: number
  readonly inkMinY: number
  readonly inkMaxX: number
  readonly inkMaxY: number
} {
  if (bytes.byteLength !== width * height * 4) {
    throw new Error('bitmap text readback length does not match its target')
  }
  let litPixels = 0
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  let inkPixels = 0
  let inkMinX = width
  let inkMinY = height
  let inkMaxX = -1
  let inkMaxY = -1
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4
    const coverage = Math.max(bytes[offset] ?? 0, bytes[offset + 1] ?? 0, bytes[offset + 2] ?? 0)
    if (coverage === 0) continue
    litPixels += 1
    const x = pixel % width
    const y = Math.floor(pixel / width)
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) {
      throw new Error('bitmap text touches the render boundary')
    }
    if (coverage >= 128) {
      inkPixels += 1
      inkMinX = Math.min(inkMinX, x)
      inkMinY = Math.min(inkMinY, y)
      inkMaxX = Math.max(inkMaxX, x)
      inkMaxY = Math.max(inkMaxY, y)
    }
  }
  if (litPixels < 100) throw new Error('bitmap text did not produce enough visible coverage')
  if (inkPixels < 100) throw new Error('bitmap text did not produce enough half-coverage ink')
  return {
    litPixels,
    minX,
    minY,
    maxX,
    maxY,
    inkPixels,
    inkMinX,
    inkMinY,
    inkMaxX,
    inkMaxY,
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice())
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}
