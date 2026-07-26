import {
  FontRegistry,
  Text,
  type FontFeature,
  type JsonValue,
  type ParagraphLayout,
  type RegisteredFont,
} from '@pmndrs/text'
import {
  bitmap,
  bitmapRasterKey,
  captureBitmapGlyphPositions,
  createBitmapGlyphPositionTransition,
  type BitmapGlyphPositionSnapshot,
  type BitmapGlyphPositionTransition,
  type BitmapResource,
} from '@pmndrs/text/raster/bitmap'
import * as THREE from 'three/webgpu'

import amiriBitmapFontUrl from '../../fixtures/rendering/amiri-bitmap-16.font.glb?url'
import dotGothicBitmapFontUrl from '../../fixtures/rendering/dot-gothic-16-bitmap-16.font.glb?url'
import bitmapFontUrl from '../../fixtures/rendering/inter-bitmap-16.font.glb?url'
import devanagariBitmapFontUrl from '../../fixtures/rendering/noto-sans-devanagari-bitmap-16.font.glb?url'
import type { AdvancedShapingFontFixture } from '../benchmark/advanced-shaping'
import { BENCHMARK_IPSUM_CONFORMANCE_TEXT } from '../benchmark/benchmark-ipsum'
import type { BenchmarkTarget, TargetRunOutput } from '../benchmark/contracts'
import { compactRgba8Readback } from './tsl-baseline'
import { createConfiguredRenderer, type RendererBackend } from './webgpu-renderer'

const WIDTH = 384
const HEIGHT = 128
const CLIPPED_WIDTH = 192
const CLIPPED_HEIGHT = 64
const BITMAP_FONT_SIZE = 16
const HISTORY_CAPACITY = 120
const bitmapRequest = bitmap({ strikes: [16] as const })
const bitmapFontUrls: Readonly<Record<AdvancedShapingFontFixture, string>> = {
  inter: bitmapFontUrl,
  amiri: amiriBitmapFontUrl,
  'noto-sans-devanagari': devanagariBitmapFontUrl,
  'dot-gothic-16': dotGothicBitmapFontUrl,
}

interface BitmapTextResources {
  readonly backend: RendererBackend
  readonly dpr: number
  readonly renderer: THREE.WebGPURenderer
  readonly target: THREE.RenderTarget
  readonly scene: THREE.Scene
  readonly camera: THREE.OrthographicCamera
  readonly font: RegisteredFont
  readonly line: BitmapLine
  readonly reference: BitmapReferenceResource
  readonly referencePixels: Uint8Array
  readonly atlasGpuBytes: number
  readonly firstDrawMs: number
}

interface BitmapReferencePage {
  readonly width: number
  readonly height: number
  readonly texels: Uint8Array
}

interface BitmapReferenceStrike {
  readonly ppem: number
  readonly planeUnitsPerEm: number
  readonly records: Uint8Array
  readonly pages: readonly BitmapReferencePage[]
}

interface BitmapReferenceResource {
  readonly strikes: readonly BitmapReferenceStrike[]
}

interface BitmapLine {
  readonly object: Text
  readonly layout: ParagraphLayout
  readonly height: number
  readonly width: number
  readonly cssFontSize: number
  readonly glyphCount: number
  readonly missingGlyphCount: number
  readonly drawCount: number
  readonly strikePpem: number
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
  readonly layoutWidth: number
  readonly layoutHeight: number
  readonly lineCount: number
  readonly strikePpem: number
  readonly cssFontSize: number
  readonly renderedPpem: number
  readonly scaleRatio: number
  readonly atlasGpuBytes: number
  readonly framebufferGpuBytes: number
  readonly totalGpuBytes: number
  readonly artifactBytes: number
  readonly rendererInitMs: number
  readonly fontLoadMs: number
  readonly textReadyMs: number
  readonly firstDrawMs: number
  readonly startupMs: number
  readonly gpuTimingSupported: boolean
  readonly gpuFrameMs: number | undefined
  readonly medianGpuMs: number | undefined
  readonly p95GpuMs: number | undefined
  readonly submitHistory: Float32Array
  readonly submitHistoryLength: number
  readonly submitHistoryNextIndex: number
  readonly fpsHistory: Float32Array
  readonly fpsHistoryLength: number
  readonly fpsHistoryNextIndex: number
  readonly gpuHistory: Float32Array
  readonly gpuHistoryLength: number
  readonly gpuHistoryNextIndex: number
}

export interface BitmapTextConformanceCapture {
  readonly width: number
  readonly height: number
  readonly candidate: Uint8Array
  readonly reference: Uint8Array
  readonly difference: Uint8Array
  readonly mismatchBytes: number
  readonly litPixels: number
  readonly inkPixels: number
  readonly renderSubmitMs: number
}

export interface BitmapTextPreview {
  resize(width: number, height: number): void
  update(options: BitmapTextPreviewUpdate): Promise<BitmapTextPreviewSnapshot>
  setPresentationProgress(revision: number, progress: number): BitmapTextPreviewSnapshot
  finishPresentation(revision: number): BitmapTextPreviewSnapshot
  dispose(): Promise<void>
}

export interface BitmapTextPreviewUpdate {
  readonly fontSize: number
  readonly layoutWidthRatio: number
  readonly text: string
  readonly language: string
  readonly direction: 'ltr' | 'rtl'
  readonly features: readonly FontFeature[]
}

export interface BitmapTextPreviewSnapshot {
  readonly revision: number
  readonly presentationProgress: number
  readonly matchedGlyphs: number
  readonly targetGlyphs: number
  readonly glyphCount: number
  readonly lineCount: number
  readonly layoutWidth: number
  readonly layoutHeight: number
}

type BitmapTextPresentation =
  | {
      readonly kind: 'transitioning'
      readonly revision: number
      readonly controllers: readonly BitmapGlyphPositionTransition[]
      readonly fromX: number
      readonly fromY: number
      readonly toX: number
      readonly toY: number
      readonly matchedGlyphs: number
      readonly targetGlyphs: number
      progress: number
    }
  | {
      readonly kind: 'settled'
      readonly revision: number
      readonly matchedGlyphs: number
      readonly targetGlyphs: number
    }

export interface BitmapTextPreviewOptions {
  readonly backend: RendererBackend
  readonly canvas: HTMLCanvasElement
  readonly dpr: number
  readonly fontSize: number
  readonly height: number
  readonly layoutWidth: number
  readonly expectedGlyphCount?: number
  readonly fontFixture?: AdvancedShapingFontFixture
  readonly language?: string
  readonly direction?: 'ltr' | 'rtl'
  readonly features?: readonly FontFeature[]
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
  let line: BitmapLine | undefined
  try {
    const loadedFont = await loadBitmapFont()
    font = loadedFont.font
    line = await createBitmapLine(font, BENCHMARK_IPSUM_CONFORMANCE_TEXT, BITMAP_FONT_SIZE / dpr)
    line.object.position.set(
      quarterDevicePosition(Math.max(4, (WIDTH - line.width) / 2), dpr),
      quarterDevicePosition(-Math.max(4, (HEIGHT - line.height) / 2), dpr),
      0,
    )

    const scene = new THREE.Scene()
    scene.add(line.object)
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
    renderer.setRenderTarget(target)
    renderer.setClearColor(0x000000, 1)
    renderer.clear()
    const firstDrawStarted = performance.now()
    renderer.render(scene, camera)
    const firstDrawMs = performance.now() - firstDrawStarted
    renderer.setRenderTarget(null)
    const { atlasGpuBytes, reference } = await loadBitmapReferenceSnapshot(font)
    const referencePixels = composeBitmapReference(line, reference, dpr, WIDTH, HEIGHT)
    return {
      backend,
      dpr,
      renderer,
      target,
      scene,
      camera,
      font,
      line,
      reference,
      referencePixels,
      atlasGpuBytes,
      firstDrawMs,
    }
  } catch (error) {
    if (line !== undefined) disposeBitmapLine(line)
    font?.dispose()
    target?.dispose()
    await renderer.dispose()
    throw error
  }
}

async function loadBitmapFont(
  signal?: AbortSignal,
  fixture: AdvancedShapingFontFixture = 'inter',
): Promise<{ readonly artifactBytes: number; readonly font: RegisteredFont }> {
  signal?.throwIfAborted()
  let font: RegisteredFont | undefined
  try {
    const fontResponse = await fetch(
      bitmapFontUrls[fixture],
      signal === undefined ? undefined : { signal },
    )
    if (!fontResponse.ok)
      throw new Error(`Unable to load bitmap font fixture (${fontResponse.status})`)
    const fontBytes = await fontResponse.arrayBuffer()
    signal?.throwIfAborted()
    const registry = new FontRegistry()
    font = await registry.registerAsset(new Uint8Array(fontBytes))
    signal?.throwIfAborted()
    return { artifactBytes: fontBytes.byteLength, font }
  } catch (error) {
    font?.dispose()
    throw error
  }
}

async function createBitmapLine(
  font: RegisteredFont,
  text: string,
  fontSize: number,
  signal?: AbortSignal,
  layoutWidth?: number,
  shaping: {
    readonly language: string
    readonly direction: 'ltr' | 'rtl'
    readonly features: readonly FontFeature[]
  } = { language: 'en', direction: 'ltr', features: [] },
): Promise<BitmapLine> {
  signal?.throwIfAborted()
  const object = new Text({
    text,
    font,
    raster: bitmapRequest,
    fontSize,
    lineHeight: 1,
    language: shaping.language,
    direction: shaping.direction,
    features: shaping.features,
    ...(layoutWidth === undefined
      ? {}
      : { width: layoutWidth, wrap: 'word' as const, overflow: 'visible' as const }),
  })
  try {
    await object.ready
    signal?.throwIfAborted()
    const layout = object.layout
    if (layout === undefined) throw new Error('public Text did not commit a bitmap layout')
    const missingGlyphCount = layout.glyphIds.reduce(
      (count, glyphId) => count + (glyphId === 0 ? 1 : 0),
      0,
    )
    if (missingGlyphCount !== 0) {
      throw new Error(`benchmark ipsum contains ${missingGlyphCount} glyphs missing from Inter`)
    }
    return {
      object,
      layout,
      height: layout.height,
      width: layout.width,
      cssFontSize: fontSize,
      glyphCount: countRenderedGlyphs(object),
      missingGlyphCount,
      drawCount: countDraws(object),
      strikePpem: BITMAP_FONT_SIZE,
    }
  } catch (error) {
    object.dispose()
    throw error
  }
}

function disposeBitmapLine(line: BitmapLine): void {
  line.object.dispose()
}

async function loadBitmapReferenceSnapshot(
  font: RegisteredFont,
  signal?: AbortSignal,
): Promise<{
  readonly atlasGpuBytes: number
  readonly reference: BitmapReferenceResource
}> {
  // The registry caches this handle for the font and releases it from font.dispose().
  // The decoded GPU textures are a separate lease and must be released immediately.
  const raster = await font.loadRaster(
    {
      rasterKey: await bitmapRasterKey({ strikes: [16] as const }),
      kind: 'bitmap',
    },
    signal === undefined ? undefined : { signal },
  )
  const resource = await bitmapRequest.module.decode(font, raster, signal)
  try {
    return {
      atlasGpuBytes: bitmapAtlasBytes(resource),
      reference: snapshotBitmapReference(resource),
    }
  } finally {
    bitmapRequest.module.dispose(resource)
  }
}

async function registeredBitmapAtlasBytes(font: RegisteredFont): Promise<number> {
  const rasterKey = await bitmapRasterKey({ strikes: [16] as const })
  const raster = font.getRaster(rasterKey)
  if (raster === undefined) throw new Error('bitmap Text did not retain its registered raster')
  const extension = jsonObject(raster.extensionData, 'bitmap extension')
  const strikes = jsonArray(extension.strikes, 'bitmap strikes')
  let bytes = 0
  for (const [strikeIndex, strikeValue] of strikes.entries()) {
    const strike = jsonObject(strikeValue, `bitmap strike ${strikeIndex}`)
    for (const [pageIndex, pageValue] of jsonArray(
      strike.pages,
      `bitmap strike ${strikeIndex} pages`,
    ).entries()) {
      const page = jsonObject(pageValue, `bitmap strike ${strikeIndex} page ${pageIndex}`)
      bytes +=
        jsonPositiveInteger(page.width, 'bitmap page width') *
        jsonPositiveInteger(page.height, 'bitmap page height')
    }
  }
  return bytes
}

function jsonObject(
  value: JsonValue | undefined,
  name: string,
): Readonly<Record<string, JsonValue>> {
  if (!isJsonObject(value)) throw new TypeError(`${name} must be an object`)
  return value
}

function isJsonObject(
  value: JsonValue | undefined,
): value is { readonly [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function jsonArray(value: JsonValue | undefined, name: string): readonly JsonValue[] {
  if (!Array.isArray(value)) throw new TypeError(`${name} must be an array`)
  return value
}

function jsonPositiveInteger(value: JsonValue | undefined, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`)
  }
  return value
}

function bitmapAtlasBytes(resource: BitmapResource): number {
  return resource.strikes.reduce(
    (strikeBytes, strike) =>
      strikeBytes +
      strike.pages.reduce((pageBytes, page) => pageBytes + page.width * page.height, 0),
    0,
  )
}

function snapshotBitmapReference(resource: BitmapResource): BitmapReferenceResource {
  return {
    strikes: resource.strikes.map((strike) => ({
      ppem: strike.ppem,
      planeUnitsPerEm: strike.planeUnitsPerEm,
      records: strike.records.slice(),
      pages: strike.pages.map((page) => {
        const texels = page.texture.image.data
        if (!(texels instanceof Uint8Array)) {
          throw new TypeError('bitmap reference page is not backed by unsigned-byte coverage')
        }
        return { width: page.width, height: page.height, texels: texels.slice() }
      }),
    })),
  }
}

function countDraws(object: THREE.Object3D): number {
  let count = 0
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) count += 1
  })
  return count
}

function countRenderedGlyphs(object: THREE.Object3D): number {
  let count = 0
  object.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry instanceof THREE.InstancedBufferGeometry) {
      count += child.geometry.instanceCount
    }
  })
  return count
}

function countMissingGlyphs(layout: ParagraphLayout): number {
  return layout.glyphIds.reduce((count, glyphId) => count + (glyphId === 0 ? 1 : 0), 0)
}

export async function createBitmapTextPreview(
  options: BitmapTextPreviewOptions,
): Promise<BitmapTextPreview> {
  const {
    backend,
    canvas,
    dpr,
    expectedGlyphCount,
    fontFixture = 'inter',
    fontSize,
    height,
    layoutWidth,
    signal,
    text,
    language = 'en',
    direction = 'ltr',
    features = [],
    onError,
    onStats,
  } = options
  const startupStarted = performance.now()
  let width = positiveViewportSize(options.width, 'bitmap preview width')
  let viewportHeight = positiveViewportSize(height, 'bitmap preview height')
  let currentFontSize = fontSize
  let layoutWidthRatio = layoutWidth / width
  const rendererStarted = performance.now()
  const renderer = await createConfiguredRenderer({
    alpha: true,
    backend,
    canvas,
    dpr,
    height: viewportHeight,
    trackGpuTimestamps: true,
    width,
  })
  const rendererInitMs = performance.now() - rendererStarted
  let font: RegisteredFont | undefined
  let line: BitmapLine | undefined
  try {
    const fontStarted = performance.now()
    const loadedFont = await loadBitmapFont(signal, fontFixture)
    font = loadedFont.font
    const fontLoadMs = performance.now() - fontStarted
    signal?.throwIfAborted()
    const scene = new THREE.Scene()
    const textStarted = performance.now()
    line = await createBitmapLine(font, text, fontSize, signal, layoutWidth, {
      language,
      direction,
      features,
    })
    if (expectedGlyphCount !== undefined && line.glyphCount !== expectedGlyphCount) {
      throw new Error(
        `live workload rendered ${line.glyphCount} glyphs; expected ${expectedGlyphCount}`,
      )
    }
    const textReadyMs = performance.now() - textStarted
    const startupMs = performance.now() - startupStarted
    const activeFont = font
    const activeLine = line
    const atlasGpuBytes = await registeredBitmapAtlasBytes(activeFont)
    scene.add(activeLine.object)
    const camera = new THREE.OrthographicCamera(0, width, 0, -viewportHeight, 0.1, 10)
    camera.position.z = 1
    camera.updateProjectionMatrix()
    renderer.setClearColor(0x000000, 0)

    const submitHistory = new Float32Array(HISTORY_CAPACITY)
    const submitQuantileScratch = new Float32Array(HISTORY_CAPACITY)
    const fpsHistory = new Float32Array(HISTORY_CAPACITY)
    const gpuHistory = new Float32Array(HISTORY_CAPACITY)
    const gpuQuantileScratch = new Float32Array(HISTORY_CAPACITY)
    let submitHistoryLength = 0
    let submitHistoryNextIndex = 0
    let fpsHistoryLength = 0
    let fpsHistoryNextIndex = 0
    let gpuHistoryLength = 0
    let gpuHistoryNextIndex = 0
    let gpuFrameMs: number | undefined
    let gpuTimestampRequest: number | undefined
    let gpuTimestampResolution: Promise<void> | undefined
    const gpuTimingSupported = renderer.hasFeature('timestamp-query')
    let frameCount = 0
    let reportedAt = performance.now()
    let reportedFrame = 0
    let closing = false
    let disposed = false
    let disposal: Promise<void> | undefined
    let layoutRevision = 0
    let firstDrawMs = 0
    const targetLinePosition = (): readonly [number, number] => {
      const layout = activeLine.object.layout
      const currentLayoutWidth = layout?.width ?? activeLine.width
      const layoutHeight = layout?.height ?? activeLine.height
      return [
        Math.max(12, (width - currentLayoutWidth) / 2),
        -Math.max(12, (viewportHeight - layoutHeight) / 2),
      ]
    }
    const initialPosition = targetLinePosition()
    activeLine.object.position.set(initialPosition[0], initialPosition[1], 0)
    let presentation: BitmapTextPresentation = {
      kind: 'settled',
      revision: 0,
      matchedGlyphs: 0,
      targetGlyphs: countRenderedGlyphs(activeLine.object),
    }
    const disposePresentation = (): void => {
      if (presentation.kind !== 'transitioning') return
      for (const controller of presentation.controllers) controller.dispose()
    }
    const presentationSnapshot = (): BitmapTextPreviewSnapshot => {
      const layout = activeLine.object.layout
      if (layout === undefined) throw new Error('bitmap preview lost its committed layout')
      return {
        revision: presentation.revision,
        presentationProgress: presentation.kind === 'settled' ? 1 : presentation.progress,
        matchedGlyphs: presentation.matchedGlyphs,
        targetGlyphs: presentation.targetGlyphs,
        glyphCount: countRenderedGlyphs(activeLine.object),
        lineCount: layout.lineGlyphCounts.length,
        layoutWidth: layout.width,
        layoutHeight: layout.height,
      }
    }
    const setPresentationProgress = (
      revision: number,
      progress: number,
    ): BitmapTextPreviewSnapshot => {
      if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
        throw new RangeError('bitmap preview presentation progress must be in [0, 1]')
      }
      if (closing || disposed || presentation.revision !== revision) {
        throw new DOMException('The bitmap preview presentation is stale', 'AbortError')
      }
      if (presentation.kind === 'settled') {
        if (progress !== 1) {
          throw new DOMException('The bitmap preview presentation is settled', 'InvalidStateError')
        }
        return presentationSnapshot()
      }
      for (const controller of presentation.controllers) controller.setProgress(progress)
      activeLine.object.position.set(
        presentation.fromX + (presentation.toX - presentation.fromX) * progress,
        presentation.fromY + (presentation.toY - presentation.fromY) * progress,
        0,
      )
      presentation.progress = progress
      if (progress === 1) {
        for (const controller of presentation.controllers) controller.finish()
        presentation = {
          kind: 'settled',
          revision: presentation.revision,
          matchedGlyphs: presentation.matchedGlyphs,
          targetGlyphs: presentation.targetGlyphs,
        }
      }
      return presentationSnapshot()
    }
    const reflowToViewport = (
      update?: Pick<BitmapTextPreviewUpdate, 'text' | 'language' | 'direction' | 'features'>,
    ): Promise<BitmapTextPreviewSnapshot> => {
      const revision = ++layoutRevision
      const previousSnapshots: readonly BitmapGlyphPositionSnapshot[] =
        activeLine.object.children.map((object) => captureBitmapGlyphPositions(object))
      const fromX = activeLine.object.position.x
      const fromY = activeLine.object.position.y
      disposePresentation()
      const dimensions = {
        fontSize: currentFontSize,
        width: Math.max(120, width * layoutWidthRatio),
      }
      if (update === undefined) activeLine.object.setProperties(dimensions)
      else activeLine.object.setProperties({ ...dimensions, ...update })
      return activeLine.object.ready.then(() => {
        if (closing || disposed || revision !== layoutRevision) {
          throw new DOMException('The bitmap preview update was superseded', 'AbortError')
        }
        const layout = activeLine.object.layout
        if (layout === undefined) throw new Error('bitmap preview update did not commit a layout')
        const targetPosition = targetLinePosition()
        const controllers: BitmapGlyphPositionTransition[] = []
        for (
          let batchIndex = 0;
          batchIndex < activeLine.object.children.length && batchIndex < previousSnapshots.length;
          batchIndex += 1
        ) {
          controllers.push(
            createBitmapGlyphPositionTransition(
              activeLine.object.children[batchIndex]!,
              previousSnapshots[batchIndex]!,
            ),
          )
        }
        for (const controller of controllers) controller.setProgress(0)
        activeLine.object.position.set(fromX, fromY, 0)
        presentation = {
          kind: 'transitioning',
          revision,
          controllers,
          fromX,
          fromY,
          toX: targetPosition[0],
          toY: targetPosition[1],
          matchedGlyphs: controllers.reduce(
            (count, controller) => count + controller.matchedGlyphs,
            0,
          ),
          targetGlyphs: countRenderedGlyphs(activeLine.object),
          progress: 0,
        }
        return presentationSnapshot()
      })
    }
    const scheduleGpuTimestamp = (): void => {
      if (
        !gpuTimingSupported ||
        gpuTimestampRequest !== undefined ||
        gpuTimestampResolution !== undefined ||
        closing ||
        disposed
      ) {
        return
      }
      gpuTimestampRequest = requestAnimationFrame(() => {
        gpuTimestampRequest = undefined
        if (disposed) return
        gpuTimestampResolution = renderer
          .resolveTimestampsAsync(THREE.TimestampQuery.RENDER)
          .then((duration) => {
            if (disposed || duration === undefined || !Number.isFinite(duration) || duration < 0) {
              return
            }
            gpuFrameMs = duration
            gpuHistory[gpuHistoryNextIndex] = duration
            gpuHistoryNextIndex = (gpuHistoryNextIndex + 1) % HISTORY_CAPACITY
            gpuHistoryLength = Math.min(gpuHistoryLength + 1, HISTORY_CAPACITY)
          })
          .catch((error: unknown) => {
            if (!closing && !disposed) onError(error)
          })
          .finally(() => {
            gpuTimestampResolution = undefined
          })
      })
    }
    const renderPreviewFrame = (timestamp: number): void => {
      if (disposed) return
      try {
        const started = performance.now()
        renderer.setRenderTarget(null)
        renderer.clear()
        renderer.render(scene, camera)
        if (closing) return
        const submitMs = performance.now() - started
        if (frameCount === 0) firstDrawMs = submitMs
        submitHistory[submitHistoryNextIndex] = submitMs
        submitHistoryNextIndex = (submitHistoryNextIndex + 1) % HISTORY_CAPACITY
        submitHistoryLength = Math.min(submitHistoryLength + 1, HISTORY_CAPACITY)
        frameCount += 1
        const elapsed = timestamp - reportedAt
        if (elapsed < 250) return
        submitQuantileScratch.set(submitHistory)
        for (let index = submitHistoryLength; index < HISTORY_CAPACITY; index += 1) {
          submitQuantileScratch[index] = Number.POSITIVE_INFINITY
        }
        submitQuantileScratch.sort()
        gpuQuantileScratch.set(gpuHistory)
        for (let index = gpuHistoryLength; index < HISTORY_CAPACITY; index += 1) {
          gpuQuantileScratch[index] = Number.POSITIVE_INFINITY
        }
        gpuQuantileScratch.sort()
        const physicalWidth = Math.round(width * dpr)
        const physicalHeight = Math.round(viewportHeight * dpr)
        const framebufferGpuBytes = physicalWidth * physicalHeight * 4
        const framesPerSecond = elapsed <= 0 ? 0 : ((frameCount - reportedFrame) * 1000) / elapsed
        fpsHistory[fpsHistoryNextIndex] = framesPerSecond
        fpsHistoryNextIndex = (fpsHistoryNextIndex + 1) % HISTORY_CAPACITY
        fpsHistoryLength = Math.min(fpsHistoryLength + 1, HISTORY_CAPACITY)
        scheduleGpuTimestamp()
        const layout = activeLine.object.layout
        if (layout === undefined) throw new Error('live bitmap Text lost its committed layout')
        onStats({
          backend,
          dpr,
          frameCount,
          framesPerSecond,
          medianSubmitMs: quantile(submitQuantileScratch, submitHistoryLength, 0.5),
          p95SubmitMs: quantile(submitQuantileScratch, submitHistoryLength, 0.95),
          glyphCount: countRenderedGlyphs(activeLine.object),
          missingGlyphCount: countMissingGlyphs(layout),
          drawCount: countDraws(activeLine.object),
          layoutWidth: layout.width,
          layoutHeight: layout.height,
          lineCount: layout.lineGlyphCounts.length,
          strikePpem: activeLine.strikePpem,
          cssFontSize: currentFontSize,
          renderedPpem: currentFontSize * dpr,
          scaleRatio: (currentFontSize * dpr) / activeLine.strikePpem,
          atlasGpuBytes,
          framebufferGpuBytes,
          totalGpuBytes: atlasGpuBytes + framebufferGpuBytes,
          artifactBytes: loadedFont.artifactBytes,
          rendererInitMs,
          fontLoadMs,
          textReadyMs,
          firstDrawMs,
          startupMs,
          gpuTimingSupported,
          gpuFrameMs,
          medianGpuMs:
            gpuHistoryLength === 0
              ? undefined
              : quantile(gpuQuantileScratch, gpuHistoryLength, 0.5),
          p95GpuMs:
            gpuHistoryLength === 0
              ? undefined
              : quantile(gpuQuantileScratch, gpuHistoryLength, 0.95),
          submitHistory,
          submitHistoryLength,
          submitHistoryNextIndex,
          fpsHistory,
          fpsHistoryLength,
          fpsHistoryNextIndex,
          gpuHistory,
          gpuHistoryLength,
          gpuHistoryNextIndex,
        })
        reportedAt = timestamp
        reportedFrame = frameCount
      } catch (error) {
        onError(error)
      }
    }
    await renderer.setAnimationLoop(renderPreviewFrame)
    return {
      resize(nextWidth, nextHeight) {
        if (closing || disposed) return
        width = positiveViewportSize(nextWidth, 'bitmap preview width')
        viewportHeight = positiveViewportSize(nextHeight, 'bitmap preview height')
        renderer.setSize(width, viewportHeight, false)
        camera.right = width
        camera.bottom = -viewportHeight
        camera.updateProjectionMatrix()
        void reflowToViewport()
          .then((snapshot) => setPresentationProgress(snapshot.revision, 1))
          .catch((error: unknown) => {
            if (
              !closing &&
              !disposed &&
              !(error instanceof DOMException && error.name === 'AbortError')
            ) {
              onError(error)
            }
          })
      },
      update(next) {
        if (closing || disposed) {
          return Promise.reject(new DOMException('The bitmap preview is disposed', 'AbortError'))
        }
        currentFontSize = positiveViewportSize(next.fontSize, 'bitmap preview font size')
        if (
          !Number.isFinite(next.layoutWidthRatio) ||
          next.layoutWidthRatio <= 0 ||
          next.layoutWidthRatio > 1
        ) {
          throw new RangeError('bitmap preview layout width ratio must be in (0, 1]')
        }
        layoutWidthRatio = next.layoutWidthRatio
        return reflowToViewport({
          text: next.text,
          language: next.language,
          direction: next.direction,
          features: next.features,
        })
      },
      setPresentationProgress,
      finishPresentation(revision) {
        return setPresentationProgress(revision, 1)
      },
      dispose() {
        if (disposal !== undefined) return disposal
        closing = true
        if (gpuTimestampRequest !== undefined) cancelAnimationFrame(gpuTimestampRequest)
        disposal = (async () => {
          await gpuTimestampResolution
          disposed = true
          await renderer.setAnimationLoop(null)
          disposePresentation()
          disposeBitmapLine(activeLine)
          activeFont.dispose()
          await renderer.dispose()
        })()
        return disposal
      },
    }
  } catch (error) {
    if (line !== undefined) disposeBitmapLine(line)
    font?.dispose()
    await renderer.dispose()
    throw error
  }
}

export async function captureBitmapTextConformance(options: {
  readonly backend: RendererBackend
  readonly dpr: number
  readonly signal?: AbortSignal
}): Promise<BitmapTextConformanceCapture> {
  options.signal?.throwIfAborted()
  const resources = await createResources(options.backend, options.dpr)
  try {
    options.signal?.throwIfAborted()
    const width = Math.round(WIDTH * options.dpr)
    const height = Math.round(HEIGHT * options.dpr)
    const rendered = await renderFrame(resources, width, height)
    options.signal?.throwIfAborted()
    const quality = assertBitmapTextPixels(rendered.bytes, width, height)
    const { bytes: difference, mismatchBytes } = differenceImage(
      rendered.bytes,
      resources.referencePixels,
    )
    return {
      width,
      height,
      candidate: rendered.bytes,
      reference: resources.referencePixels.slice(),
      difference,
      mismatchBytes,
      litPixels: quality.litPixels,
      inkPixels: quality.inkPixels,
      renderSubmitMs: rendered.renderMs,
    }
  } finally {
    disposeBitmapLine(resources.line)
    resources.font.dispose()
    resources.target.dispose()
    await resources.renderer.dispose()
  }
}

function differenceImage(
  candidate: Uint8Array,
  reference: Uint8Array,
): { readonly bytes: Uint8Array; readonly mismatchBytes: number } {
  if (candidate.byteLength !== reference.byteLength) {
    throw new Error('bitmap conformance images do not have matching dimensions')
  }
  const bytes = new Uint8Array(candidate.byteLength)
  let mismatchBytes = 0
  for (let offset = 0; offset < candidate.byteLength; offset += 4) {
    const red = Math.abs((candidate[offset] ?? 0) - (reference[offset] ?? 0))
    const green = Math.abs((candidate[offset + 1] ?? 0) - (reference[offset + 1] ?? 0))
    const blue = Math.abs((candidate[offset + 2] ?? 0) - (reference[offset + 2] ?? 0))
    if (red !== 0) mismatchBytes += 1
    if (green !== 0) mismatchBytes += 1
    if (blue !== 0) mismatchBytes += 1
    bytes[offset] = Math.max(red, green, blue)
    bytes[offset + 1] = 0
    bytes[offset + 2] = 0
    bytes[offset + 3] = 255
  }
  return { bytes, mismatchBytes }
}

function positiveViewportSize(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be positive`)
  return value
}

function quantile(sorted: Float32Array, length: number, fraction: number): number {
  if (length === 0) return 0
  const index = Math.min(length - 1, Math.ceil(length * fraction) - 1)
  return sorted[index] ?? 0
}

async function renderBitmapText(resources: BitmapTextResources): Promise<TargetRunOutput> {
  const { renderer, target, camera, line } = resources
  const physicalWidth = Math.round(WIDTH * resources.dpr)
  const physicalHeight = Math.round(HEIGHT * resources.dpr)
  const originalPosition = line.object.position.clone()
  const unsnappedOriginFraction = Math.max(
    devicePixelFraction(originalPosition.x * resources.dpr),
    devicePixelFraction(originalPosition.y * resources.dpr),
  )
  const full = await renderFrame(resources, physicalWidth, physicalHeight)
  const quality = assertBitmapTextPixels(
    full.bytes,
    physicalWidth,
    physicalHeight,
    resources.referencePixels,
  )
  const clippedPhysicalWidth = Math.round(CLIPPED_WIDTH * resources.dpr)
  const clippedPhysicalHeight = Math.round(CLIPPED_HEIGHT * resources.dpr)
  let clipped: Awaited<ReturnType<typeof renderFrame>>
  let clippedQuality: ReturnType<typeof assertBitmapTextPixels>
  try {
    renderer.setSize(CLIPPED_WIDTH, CLIPPED_HEIGHT, false)
    target.setSize(clippedPhysicalWidth, clippedPhysicalHeight)
    camera.right = CLIPPED_WIDTH
    camera.bottom = -CLIPPED_HEIGHT
    camera.updateProjectionMatrix()
    line.object.position.set(
      quarterDevicePosition(-40, resources.dpr),
      quarterDevicePosition(-4, resources.dpr),
      0,
    )
    const clippedReference = composeBitmapReference(
      line,
      resources.reference,
      resources.dpr,
      CLIPPED_WIDTH,
      CLIPPED_HEIGHT,
      true,
    )
    clipped = await renderFrame(resources, clippedPhysicalWidth, clippedPhysicalHeight)
    clippedQuality = assertBitmapTextPixels(
      clipped.bytes,
      clippedPhysicalWidth,
      clippedPhysicalHeight,
      clippedReference,
      true,
    )
    if (!clippedQuality.touchesBoundary || clippedQuality.inkPixels >= quality.inkPixels) {
      throw new Error('bitmap Text resize did not produce a smaller clipped frame')
    }
  } finally {
    line.object.position.copy(originalPosition)
    renderer.setSize(WIDTH, HEIGHT, false)
    target.setSize(physicalWidth, physicalHeight)
    camera.right = WIDTH
    camera.bottom = -HEIGHT
    camera.updateProjectionMatrix()
  }
  return {
    bytes: full.bytes.byteLength,
    hash: await sha256(full.bytes),
    metrics: {
      backendWebGpu: resources.backend === 'webgpu' ? 1 : 0,
      backendWebGl2: resources.backend === 'webgl2' ? 1 : 0,
      dpr: resources.dpr,
      glyphCount: line.glyphCount,
      missingGlyphCount: line.missingGlyphCount,
      drawCount: line.drawCount,
      strikePpem: line.strikePpem,
      cssFontSize: line.cssFontSize,
      renderedPpem: line.cssFontSize * resources.dpr,
      scaleRatio: (line.cssFontSize * resources.dpr) / line.strikePpem,
      atlasGpuBytes: resources.atlasGpuBytes,
      renderTargetGpuBytes: full.bytes.byteLength,
      totalGpuBytes: resources.atlasGpuBytes + full.bytes.byteLength,
      litPixels: quality.litPixels,
      inkPixels: quality.inkPixels,
      inkMinX: quality.inkMinX,
      inkMinY: quality.inkMinY,
      inkMaxX: quality.inkMaxX,
      inkMaxY: quality.inkMaxY,
      renderMs: full.renderMs,
      clippedRenderMs: clipped.renderMs,
      clippedInkPixels: clippedQuality.inkPixels,
      clippedTouchesBoundary: clippedQuality.touchesBoundary ? 1 : 0,
      resizedWidth: CLIPPED_WIDTH,
      resizedHeight: CLIPPED_HEIGHT,
      firstDrawMs: resources.firstDrawMs,
      referenceMismatchBytes: quality.referenceMismatchBytes,
      unsnappedOriginFraction,
    },
  }
}

async function renderFrame(
  resources: BitmapTextResources,
  physicalWidth: number,
  physicalHeight: number,
): Promise<{ readonly bytes: Uint8Array; readonly renderMs: number }> {
  const { renderer, target, scene, camera } = resources
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
  return {
    bytes: compactRgba8Readback(
      new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength),
      physicalWidth,
      physicalHeight,
      resources.backend === 'webgl2' ? 'bottom-to-top' : 'top-to-bottom',
    ),
    renderMs,
  }
}

export function assertBitmapTextPixels(
  bytes: Uint8Array,
  width: number,
  height: number,
  referenceBytes?: Uint8Array,
  allowBoundary = false,
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
  readonly touchesBoundary: boolean
  readonly referenceMismatchBytes: number
} {
  if (bytes.byteLength !== width * height * 4) {
    throw new Error('bitmap text readback length does not match its target')
  }
  const referenceMismatchBytes =
    referenceBytes === undefined ? 0 : assertExactReference(bytes, referenceBytes, width)
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
  let touchesBoundary = false
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
      touchesBoundary = true
      if (!allowBoundary) throw new Error('bitmap text touches the render boundary')
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
    touchesBoundary,
    referenceMismatchBytes,
  }
}

function composeBitmapReference(
  line: BitmapLine,
  resource: BitmapReferenceResource,
  dpr: number,
  cssWidth: number,
  cssHeight: number,
  allowClipping = false,
): Uint8Array {
  const physicalWidth = Math.round(cssWidth * dpr)
  const physicalHeight = Math.round(cssHeight * dpr)
  const output = new Uint8Array(physicalWidth * physicalHeight * 4)
  for (let alpha = 3; alpha < output.byteLength; alpha += 4) output[alpha] = 255

  const strike = resource.strikes.find(({ ppem }) => ppem === line.strikePpem)
  if (strike === undefined) throw new Error('bitmap reference is missing the selected strike')
  const records = new DataView(
    strike.records.buffer,
    strike.records.byteOffset,
    strike.records.byteLength,
  )
  const { layout } = line
  for (let glyphIndex = 0; glyphIndex < layout.glyphIds.length; glyphIndex += 1) {
    if (layout.glyphFontSlots[glyphIndex] !== 0) continue
    const glyphId = layout.glyphIds[glyphIndex]
    const fontSize = layout.glyphFontSizes[glyphIndex]
    if (glyphId === undefined || fontSize === undefined) continue
    const record = glyphId * 20
    const pageIndex = records.getUint16(record + 16, true)
    if (pageIndex === 0xffff) continue
    const page = strike.pages[pageIndex]
    if (page === undefined) throw new Error('bitmap reference record points to a missing page')
    const texels = page.texels
    const scale = fontSize / strike.planeUnitsPerEm
    if (scale * dpr !== 1) {
      throw new Error('exact bitmap reference requires one atlas texel per device pixel')
    }
    const planeLeft = records.getInt16(record, true)
    const planeTop = records.getInt16(record + 6, true)
    const atlasLeft = records.getUint16(record + 8, true)
    const atlasTop = records.getUint16(record + 10, true)
    const atlasRight = records.getUint16(record + 12, true)
    const atlasBottom = records.getUint16(record + 14, true)
    const left = Math.round(
      (line.object.position.x + layout.x[glyphIndex]! + planeLeft * scale) * dpr,
    )
    const top = Math.round(
      -(line.object.position.y - layout.y[glyphIndex]! + planeTop * scale) * dpr,
    )
    for (let atlasY = atlasTop; atlasY < atlasBottom; atlasY += 1) {
      for (let atlasX = atlasLeft; atlasX < atlasRight; atlasX += 1) {
        const x = left + atlasX - atlasLeft
        const y = top + atlasY - atlasTop
        if (x < 0 || y < 0 || x >= physicalWidth || y >= physicalHeight) {
          if (allowClipping) continue
          throw new Error('bitmap reference glyph exceeds the framebuffer')
        }
        const coverage = texels[atlasY * page.width + atlasX]!
        const destination = (y * physicalWidth + x) * 4
        const previous = output[destination]!
        const composed = coverage + Math.round((previous * (255 - coverage)) / 255)
        output[destination] = composed
        output[destination + 1] = composed
        output[destination + 2] = composed
      }
    }
  }
  return output
}

function assertExactReference(actual: Uint8Array, expected: Uint8Array, width: number): number {
  if (actual.byteLength !== expected.byteLength) {
    throw new Error('bitmap CPU reference length does not match the GPU readback')
  }
  const samples: string[] = []
  let mismatchBytes = 0
  let maximumDifference = 0
  for (let index = 0; index < actual.byteLength; index += 1) {
    if (actual[index] === expected[index]) continue
    mismatchBytes += 1
    maximumDifference = Math.max(maximumDifference, Math.abs(actual[index]! - expected[index]!))
    if (samples.length < 8) {
      const pixel = Math.floor(index / 4)
      samples.push(
        `(${String(pixel % width)},${String(Math.floor(pixel / width))},${String(index % 4)}):` +
          `${String(actual[index])}/${String(expected[index])}`,
      )
    }
  }
  if (mismatchBytes !== 0) {
    const actualBounds = coverageBounds(actual, width)
    const expectedBounds = coverageBounds(expected, width)
    throw new Error(
      `bitmap GPU readback differs from its CPU atlas reference in ${String(mismatchBytes)} bytes ` +
        `(max delta ${String(maximumDifference)}; actual bounds ${actualBounds}; ` +
        `expected bounds ${expectedBounds}; actual/expected ${samples.join(', ')})`,
    )
  }
  return mismatchBytes
}

function coverageBounds(bytes: Uint8Array, width: number): string {
  let minX = width
  let minY = Number.MAX_SAFE_INTEGER
  let maxX = -1
  let maxY = -1
  for (let pixel = 0; pixel < bytes.byteLength / 4; pixel += 1) {
    if ((bytes[pixel * 4] ?? 0) === 0) continue
    const x = pixel % width
    const y = Math.floor(pixel / width)
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  return `[${String(minX)},${String(minY)},${String(maxX)},${String(maxY)}]`
}

function devicePixelFraction(value: number): number {
  return Math.abs(value - Math.round(value))
}

function quarterDevicePosition(value: number, dpr: number): number {
  return (Math.floor(value * dpr) + 0.25) / dpr
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice())
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}
