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
import { BENCHMARK_IPSUM_TEXT } from '../benchmark/benchmark-ipsum'
import type { BenchmarkTarget, TargetRunOutput } from '../benchmark/contracts'
import { compactRgba8Readback } from './tsl-baseline'
import { createConfiguredRenderer, type RendererBackend } from './webgpu-renderer'

const WIDTH = 384
const HEIGHT = 128
const BITMAP_FONT_SIZE = 16
const bitmapRequest = bitmap({ strikes: [16] as const })

interface BitmapTextResources {
  readonly backend: RendererBackend
  readonly dpr: number
  readonly renderer: THREE.WebGPURenderer
  readonly target: THREE.RenderTarget
  readonly scene: THREE.Scene
  readonly camera: THREE.OrthographicCamera
  readonly runtime: BitmapFontRuntime
  readonly line: BitmapLine
}

interface BitmapFontRuntime {
  readonly font: RegisteredFont
  readonly shaper: RuntimeShaper
  readonly bitmap: BitmapResource
  readonly atlasGpuBytes: number
}

interface BitmapLine {
  readonly paragraph: Paragraph
  readonly batch: BitmapDrawBatch
  readonly height: number
  readonly width: number
  readonly cssFontSize: number
  readonly missingGlyphCount: number
}

export interface BitmapTextLiveStats {
  readonly backend: RendererBackend
  readonly dpr: number
  readonly frameCount: number
  readonly framesPerSecond: number
  readonly medianSubmitMs: number
  readonly p95SubmitMs: number
  readonly glyphCount: number
  readonly missingGlyphCount: number
  readonly drawCount: number
  readonly strikePpem: number
  readonly cssFontSize: number
  readonly renderedPpem: number
  readonly scaleRatio: number
  readonly atlasGpuBytes: number
  readonly framebufferGpuBytes: number
  readonly totalGpuBytes: number
}

export interface BitmapTextPreview {
  resize(width: number, height: number): void
  dispose(): Promise<void>
}

export interface BitmapTextPreviewOptions {
  readonly backend: RendererBackend
  readonly canvas: HTMLCanvasElement
  readonly dpr: number
  readonly fontSize: number
  readonly height: number
  readonly text: string
  readonly width: number
  readonly signal?: AbortSignal
  readonly onError: (error: unknown) => void
  readonly onStats: (stats: BitmapTextLiveStats) => void
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
      disposeBitmapLine(resources.line)
      disposeBitmapRuntime(resources.runtime)
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
  let runtime: BitmapFontRuntime | undefined
  let line: BitmapLine | undefined
  try {
    runtime = await loadBitmapRuntime()
    line = await createBitmapLine(runtime, BENCHMARK_IPSUM_TEXT, BITMAP_FONT_SIZE / dpr)
    line.batch.object.position.set(
      Math.max(4, (WIDTH - line.width) / 2),
      -Math.max(4, (HEIGHT - line.height) / 2),
      0,
    )

    const scene = new THREE.Scene()
    scene.add(line.batch.object)
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
      runtime,
      line,
    }
  } catch (error) {
    if (line !== undefined) disposeBitmapLine(line)
    if (runtime !== undefined) disposeBitmapRuntime(runtime)
    target?.dispose()
    await renderer.dispose()
    throw error
  }
}

async function loadBitmapRuntime(signal?: AbortSignal): Promise<BitmapFontRuntime> {
  signal?.throwIfAborted()
  let font: RegisteredFont | undefined
  let shaper: RuntimeShaper | undefined
  let resource: BitmapResource | undefined
  try {
    const [fontResponse, shaperResponse] = await Promise.all([
      fetch(bitmapFontUrl, signal === undefined ? undefined : { signal }),
      fetch(shaperWasmUrl, signal === undefined ? undefined : { signal }),
    ])
    if (!fontResponse.ok)
      throw new Error(`Unable to load bitmap font fixture (${fontResponse.status})`)
    if (!shaperResponse.ok)
      throw new Error(`Unable to load text shaper Wasm (${shaperResponse.status})`)
    const [fontBytes, shaperWasm] = await Promise.all([
      fontResponse.arrayBuffer(),
      shaperResponse.arrayBuffer(),
    ])
    signal?.throwIfAborted()
    const registry = new FontRegistry()
    font = await registry.registerAsset(new Uint8Array(fontBytes))
    signal?.throwIfAborted()
    shaper = await createRuntimeShaper({ registry, wasm: shaperWasm })
    const raster = await font.loadRaster({
      rasterKey: await bitmapRasterKey({ strikes: [16] as const }),
      kind: 'bitmap',
    })
    resource = await bitmapRequest.module.decode(font, raster, signal)
    signal?.throwIfAborted()
    return {
      font,
      shaper,
      bitmap: resource,
      atlasGpuBytes: resource.strikes.reduce(
        (strikeBytes, strike) =>
          strikeBytes +
          strike.pages.reduce((pageBytes, page) => pageBytes + page.width * page.height, 0),
        0,
      ),
    }
  } catch (error) {
    if (resource !== undefined) bitmapRequest.module.dispose(resource)
    shaper?.dispose()
    font?.dispose()
    throw error
  }
}

async function createBitmapLine(
  runtime: BitmapFontRuntime,
  text: string,
  fontSize: number,
  signal?: AbortSignal,
): Promise<BitmapLine> {
  signal?.throwIfAborted()
  const paragraph = createParagraphEngine({ shaper: runtime.shaper }).create({
    text,
    font: runtime.font.handle,
    style: {
      fontSize,
      lineHeight: 1,
      language: 'en',
      direction: 'ltr',
      features: [],
    },
  })
  let batch: BitmapDrawBatch | undefined
  try {
    const layout = paragraph.layout()
    const missingGlyphCount = layout.glyphIds.reduce(
      (count, glyphId) => count + (glyphId === 0 ? 1 : 0),
      0,
    )
    if (missingGlyphCount !== 0) {
      throw new Error(`benchmark ipsum contains ${missingGlyphCount} glyphs missing from Inter`)
    }
    await bitmapRequest.module.prepare(layout, runtime.bitmap, 0, signal)
    signal?.throwIfAborted()
    const paint: GlyphPaint = {
      paintIndices: new Uint16Array(layout.glyphIds.length),
      palette: [{ color: [1, 1, 1, 1] }],
    }
    batch = bitmapRequest.module.buildBatches(layout, runtime.bitmap, 0, paint)
    return {
      paragraph,
      batch,
      height: layout.height,
      width: layout.width,
      cssFontSize: fontSize,
      missingGlyphCount,
    }
  } catch (error) {
    batch?.dispose()
    paragraph.dispose()
    throw error
  }
}

function disposeBitmapLine(line: BitmapLine): void {
  line.batch.dispose()
  line.paragraph.dispose()
}

function disposeBitmapRuntime(runtime: BitmapFontRuntime): void {
  bitmapRequest.module.dispose(runtime.bitmap)
  runtime.shaper.dispose()
  runtime.font.dispose()
}

export async function createBitmapTextPreview(
  options: BitmapTextPreviewOptions,
): Promise<BitmapTextPreview> {
  const { backend, canvas, dpr, fontSize, height, signal, text, onError, onStats } = options
  let width = positiveViewportSize(options.width, 'bitmap preview width')
  let viewportHeight = positiveViewportSize(height, 'bitmap preview height')
  const renderer = await createConfiguredRenderer({
    alpha: true,
    backend,
    canvas,
    dpr,
    height: viewportHeight,
    width,
  })
  let runtime: BitmapFontRuntime | undefined
  let line: BitmapLine | undefined
  try {
    runtime = await loadBitmapRuntime(signal)
    signal?.throwIfAborted()
    const scene = new THREE.Scene()
    line = await createBitmapLine(runtime, text, fontSize, signal)
    const activeRuntime = runtime
    const activeLine = line
    scene.add(activeLine.batch.object)
    const camera = new THREE.OrthographicCamera(0, width, 0, -viewportHeight, 0.1, 10)
    camera.position.z = 1
    camera.updateProjectionMatrix()
    renderer.setClearColor(0x000000, 0)

    const positionLine = (): void => {
      activeLine.batch.object.position.set(
        Math.max(12, (width - activeLine.width) / 2),
        -Math.max(12, (viewportHeight - activeLine.height) / 2),
        0,
      )
    }
    positionLine()

    const submitDurations: number[] = []
    const glyphCount = activeLine.batch.glyphCount
    const drawCount = activeLine.batch.drawCount
    let frameCount = 0
    let reportedAt = 0
    let reportedFrame = 0
    let disposed = false
    const renderFrame = (timestamp: number): void => {
      if (disposed) return
      try {
        const started = performance.now()
        renderer.setRenderTarget(null)
        renderer.clear()
        renderer.render(scene, camera)
        submitDurations.push(performance.now() - started)
        if (submitDurations.length > 120) submitDurations.shift()
        frameCount += 1
        const elapsed = timestamp - reportedAt
        if (reportedAt !== 0 && elapsed < 250) return
        const sorted = [...submitDurations].sort((left, right) => left - right)
        const physicalWidth = Math.round(width * dpr)
        const physicalHeight = Math.round(viewportHeight * dpr)
        const framebufferGpuBytes = physicalWidth * physicalHeight * 4
        onStats({
          backend,
          dpr,
          frameCount,
          framesPerSecond:
            reportedAt === 0 || elapsed <= 0 ? 0 : ((frameCount - reportedFrame) * 1000) / elapsed,
          medianSubmitMs: quantile(sorted, 0.5),
          p95SubmitMs: quantile(sorted, 0.95),
          glyphCount,
          missingGlyphCount: activeLine.missingGlyphCount,
          drawCount,
          strikePpem: activeLine.batch.strikePpem,
          cssFontSize: activeLine.cssFontSize,
          renderedPpem: activeLine.cssFontSize * dpr,
          scaleRatio: (activeLine.cssFontSize * dpr) / activeLine.batch.strikePpem,
          atlasGpuBytes: activeRuntime.atlasGpuBytes,
          framebufferGpuBytes,
          totalGpuBytes: activeRuntime.atlasGpuBytes + framebufferGpuBytes,
        })
        reportedAt = timestamp
        reportedFrame = frameCount
      } catch (error) {
        onError(error)
      }
    }
    await renderer.setAnimationLoop(renderFrame)
    return {
      resize(nextWidth, nextHeight) {
        if (disposed) return
        width = positiveViewportSize(nextWidth, 'bitmap preview width')
        viewportHeight = positiveViewportSize(nextHeight, 'bitmap preview height')
        renderer.setSize(width, viewportHeight, false)
        camera.right = width
        camera.bottom = -viewportHeight
        camera.updateProjectionMatrix()
        positionLine()
      },
      async dispose() {
        if (disposed) return
        disposed = true
        await renderer.setAnimationLoop(null)
        disposeBitmapLine(activeLine)
        disposeBitmapRuntime(activeRuntime)
        await renderer.dispose()
      },
    }
  } catch (error) {
    if (line !== undefined) disposeBitmapLine(line)
    if (runtime !== undefined) disposeBitmapRuntime(runtime)
    await renderer.dispose()
    throw error
  }
}

function positiveViewportSize(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be positive`)
  return value
}

function quantile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)
  return sorted[index] ?? 0
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
      glyphCount: resources.line.batch.glyphCount,
      missingGlyphCount: resources.line.missingGlyphCount,
      drawCount: resources.line.batch.drawCount,
      strikePpem: resources.line.batch.strikePpem,
      cssFontSize: resources.line.cssFontSize,
      renderedPpem: resources.line.cssFontSize * resources.dpr,
      scaleRatio: (resources.line.cssFontSize * resources.dpr) / resources.line.batch.strikePpem,
      atlasGpuBytes: resources.runtime.atlasGpuBytes,
      renderTargetGpuBytes: bytes.byteLength,
      totalGpuBytes: resources.runtime.atlasGpuBytes + bytes.byteLength,
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
