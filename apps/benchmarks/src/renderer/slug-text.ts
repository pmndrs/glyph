import {
  FontRegistry,
  Text,
  defineRaster,
  type BakeProgressListener,
  type FontFeature,
  type ParagraphLayout,
  type RasterBakeArtifact,
  type RegisteredFont,
  type RuntimeRasterBakerModule,
} from '@pmndrs/text'
import {
  slug,
  slugDescriptorRasterKey,
  type SlugModule,
  type SlugResource,
} from '@pmndrs/text/raster/slug'
import * as THREE from 'three/webgpu'

import amiriCompressedFontUrl from '../../fixtures/rendering/amiri-slug.font.glb.gz?url'
import dancingScriptCompressedFontUrl from '../../fixtures/rendering/dancing-script-slug.font.glb.gz?url'
import dotGothicCompressedFontUrl from '../../fixtures/rendering/dot-gothic-16-slug.font.glb.gz?url'
import interCompressedFontUrl from '../../fixtures/rendering/inter-slug.font.glb.gz?url'
import devanagariCompressedFontUrl from '../../fixtures/rendering/noto-sans-devanagari-slug.font.glb.gz?url'
import notoCjkShowcaseCompressedFontUrl from '../../fixtures/rendering/noto-sans-cjk-showcase-slug.font.glb.gz?url'
import sourceSerifCompressedFontUrl from '../../fixtures/rendering/source-serif-4-slug.font.glb.gz?url'
import showcaseManifest from '../../fixtures/rendering/showcase-slug-fixtures-v0.json'
import { BENCHMARK_IPSUM_CONFORMANCE_TEXT } from '../benchmark/benchmark-ipsum'
import type { BenchmarkTarget, TargetRunOutput } from '../benchmark/contracts'
import { rasterConformanceSpecimen, type BenchmarkFontFixture } from '../benchmark/font-fixtures'
import type { FontDelivery } from '../benchmark/url-state'
import { createCanvasSurface } from './canvas-surface'
import { finiteCanvasDelta } from './canvas-view'
import {
  createFontDeliveryMetrics,
  loadRuntimeFont,
  type FontDeliveryMetrics,
} from './font-delivery'
import { createLiveFrameTelemetry, type LiveFrameHistoryCursor } from './live-frame-telemetry'
import {
  LIVE_TEXT_COLOR,
  LIVE_TEXT_LINE_HEIGHT,
  liveTextPosition,
  type LiveTextAnchor,
} from './live-text-style'
import { createTextUpdateTelemetry, type TextUpdateTimingSummary } from './text-update-telemetry'
import { compareRgba8Coverage } from './mtsdf-cpu-reference'
import { renderFlatSlugCpuReference } from './slug-cpu-reference'
import {
  captureSourceOutlineFidelity,
  type SourceOutlineFidelityCapture,
} from './source-outline-reference'
import { compactRgba8Readback } from './tsl-baseline'
import {
  createConfiguredRenderer,
  readRendererViewportState,
  type RendererBackend,
} from './webgpu-renderer'

const WIDTH = 512
const HEIGHT = 320
const FLAT_CONFORMANCE_HEIGHT = 512

interface SlugFixtureManifest {
  readonly fontFixture: BenchmarkFontFixture
  readonly compressed: { readonly bytes: number; readonly sha256: string }
  readonly uncompressed: { readonly bytes: number; readonly sha256: string }
}

const compressedFontUrls: Readonly<Record<BenchmarkFontFixture, string>> = {
  inter: interCompressedFontUrl,
  amiri: amiriCompressedFontUrl,
  'noto-sans-devanagari': devanagariCompressedFontUrl,
  'noto-sans-cjk-showcase': notoCjkShowcaseCompressedFontUrl,
  'dot-gothic-16': dotGothicCompressedFontUrl,
  'source-serif-4': sourceSerifCompressedFontUrl,
  'dancing-script': dancingScriptCompressedFontUrl,
}

const slugFixtureManifests = new Map(
  (showcaseManifest as { readonly artifacts: readonly SlugFixtureManifest[] }).artifacts.map(
    (artifact) => [artifact.fontFixture, artifact],
  ),
) as ReadonlyMap<BenchmarkFontFixture, SlugFixtureManifest>

export interface SlugRasterConfiguration {
  readonly planeUnitsPerEm: number
  readonly pageCount: number
  readonly curveTexelCount: number
  readonly curveGpuBytes: number
  readonly headerCount: number
  readonly headerGpuBytes: number
  readonly referenceCount: number
  readonly referenceGpuBytes: number
  readonly gpuBytes: number
}

interface SlugTextResources {
  readonly backend: RendererBackend
  readonly dpr: number
  readonly renderer: THREE.WebGPURenderer
  readonly target: THREE.RenderTarget
  readonly scene: THREE.Scene
  readonly camera: THREE.OrthographicCamera
  readonly font: RegisteredFont
  readonly lines: readonly Text[]
  readonly configuration: SlugRasterConfiguration
  readonly artifactBytes: number
  readonly compressedBytes: number
  readonly fontLoadMs: number
  readonly firstDrawMs: number
}

export interface SlugTextConformanceCapture {
  readonly width: number
  readonly height: number
  readonly candidate: Uint8Array
  readonly reference: Uint8Array
  readonly difference: Uint8Array
  readonly meanAbsoluteError: number
  readonly maximumError: number
  readonly errorPixels: number
  readonly severeErrorPixels: number
  readonly glyphCount: number
  readonly evaluatedCurves: number
  readonly renderSubmitMs: number
}

interface FlatSlugConformanceResources {
  readonly backend: RendererBackend
  readonly dpr: number
  readonly fontFixture: BenchmarkFontFixture
  readonly renderer: THREE.WebGPURenderer
  readonly target: THREE.RenderTarget
  readonly scene: THREE.Scene
  readonly camera: THREE.OrthographicCamera
  readonly font: RegisteredFont
  readonly line: Text
  readonly resource: SlugResource
}

export interface SlugTextLiveStats {
  readonly technique: 'slug'
  readonly backend: RendererBackend
  readonly dpr: number
  readonly renderedPpem: number
  readonly showGrid: boolean
  readonly frameCount: number
  readonly framesPerSecond: number
  readonly medianSubmitMs: number
  readonly p95SubmitMs: number
  readonly minimumSubmitMs: number
  readonly maximumSubmitMs: number
  readonly minimumFramesPerSecond: number
  readonly maximumFramesPerSecond: number
  readonly glyphCount: number
  readonly missingGlyphCount: number
  readonly drawCount: number
  readonly layoutWidth: number
  readonly layoutHeight: number
  readonly lineCount: number
  readonly slugPageCount: number
  readonly slugCurveTexelCount: number
  readonly slugCurveGpuBytes: number
  readonly slugHeaderCount: number
  readonly slugHeaderGpuBytes: number
  readonly slugReferenceCount: number
  readonly slugReferenceGpuBytes: number
  readonly slugGpuBytes: number
  readonly atlasGpuBytes: number
  readonly framebufferGpuBytes: number
  readonly totalGpuBytes: number
  readonly artifactBytes: number
  readonly delivery: FontDelivery
  readonly sourceFontBytes: number
  readonly coreArtifactBytes: number
  readonly coreBakeMs: number
  readonly rasterArtifactBytes: number
  readonly rasterBakeMs: number
  readonly rendererInitMs: number
  readonly fontLoadMs: number
  readonly textReadyMs: number
  readonly firstDrawMs: number
  readonly uploadFrameGpuMs?: number
  readonly uploadFrameCompleteMs?: number
  readonly startupMs: number
  readonly gpuTimingSupported: boolean
  readonly gpuFrameMs: number | undefined
  readonly medianGpuMs: number | undefined
  readonly p95GpuMs: number | undefined
  readonly minimumGpuMs: number | undefined
  readonly maximumGpuMs: number | undefined
  readonly textUpdateTimings: TextUpdateTimingSummary
  readonly submitHistory: Float32Array
  readonly submitHistoryLength: number
  readonly submitHistoryNextIndex: number
  readonly submitHistoryCursor: LiveFrameHistoryCursor
  readonly fpsHistory: Float32Array
  readonly fpsHistoryLength: number
  readonly fpsHistoryNextIndex: number
  readonly fpsHistoryCursor: LiveFrameHistoryCursor
  readonly gpuHistory: Float32Array
  readonly gpuHistoryLength: number
  readonly gpuHistoryNextIndex: number
  readonly gpuHistoryCursor: LiveFrameHistoryCursor
}

export interface SlugTextPreviewUpdate {
  readonly anchor: LiveTextAnchor
  readonly direction: 'ltr' | 'rtl'
  readonly features: readonly FontFeature[]
  readonly fontSize: number
  readonly language: string
  readonly layoutWidthRatio: number
  readonly text: string
  readonly textAlign: 'start' | 'center'
}

export interface SlugTextPreview {
  resize(width: number, height: number): void
  panBy(deltaX: number, deltaY: number): void
  resetView(): void
  setGridVisible(visible: boolean): void
  update(update: SlugTextPreviewUpdate): Promise<void>
  dispose(): Promise<void>
}

type SlugTextState =
  | { readonly kind: 'empty' }
  | { readonly kind: 'ready'; readonly resources: SlugTextResources }

export function createSlugTextTarget(backend: RendererBackend): BenchmarkTarget {
  let state: SlugTextState = { kind: 'empty' }
  return {
    id: `slug-text-${backend}`,
    label: backend === 'webgpu' ? 'Slug text · WebGPU' : 'Slug text · WebGL2 fallback',
    detail: 'Inter GLB · HarfRust layout · analytic curves · shared TSL graph',
    color: backend === 'webgpu' ? 'green' : 'amber',
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
      if (state.kind !== 'ready') throw new Error('Slug text target was not loaded')
      return renderSlugText(state.resources)
    },
    dispose: async () => {
      if (state.kind !== 'ready') return
      const resources = state.resources
      state = { kind: 'empty' }
      for (const line of resources.lines) line.dispose()
      resources.font.dispose()
      resources.target.dispose()
      await resources.renderer.dispose()
    },
  }
}

export function createSlugConformanceTarget(backend: RendererBackend): BenchmarkTarget {
  let resources: FlatSlugConformanceResources | undefined
  let fontFixture: BenchmarkFontFixture = 'inter'
  return {
    id: `slug-conformance-${backend}`,
    label:
      backend === 'webgpu'
        ? 'Slug sampling conformance · WebGPU'
        : 'Slug sampling conformance · WebGL2 fallback',
    detail: 'GPU TSL candidate · independent scalar CPU reconstruction · visual difference',
    color: backend === 'webgpu' ? 'green' : 'amber',
    capabilities: new Set([
      'deterministic',
      'font-bytes',
      'wasm',
      'shaping',
      'paragraph',
      'raster',
    ]),
    configure: (input) => {
      fontFixture = input.fontFixture ?? 'inter'
    },
    status: () => 'ready',
    load: async (controls) => {
      resources ??= await createFlatSlugConformanceResources(backend, controls.dpr, fontFixture)
    },
    run: async () => {
      if (resources === undefined) throw new Error('Slug conformance target was not loaded')
      const capture = await captureFlatSlugConformance(resources)
      return {
        bytes: capture.candidate.byteLength,
        hash: await sha256(capture.candidate),
        metrics: {
          backendWebGpu: backend === 'webgpu' ? 1 : 0,
          backendWebGl2: backend === 'webgl2' ? 1 : 0,
          dpr: resources.dpr,
          fixtureIsInter: fontFixture === 'inter' ? 1 : 0,
          fixtureIsDotGothic: fontFixture === 'dot-gothic-16' ? 1 : 0,
          pixelCount: capture.width * capture.height,
          glyphCount: capture.glyphCount,
          evaluatedCurves: capture.evaluatedCurves,
          meanAbsoluteError: capture.meanAbsoluteError,
          maximumError: capture.maximumError,
          errorPixels: capture.errorPixels,
          severeErrorPixels: capture.severeErrorPixels,
          renderMs: capture.renderSubmitMs,
        },
      }
    },
    dispose: async () => {
      const current = resources
      resources = undefined
      if (current !== undefined) await disposeFlatSlugConformanceResources(current)
    },
  }
}

export async function createSlugTextPreview(options: {
  readonly anchor?: LiveTextAnchor
  readonly backend: RendererBackend
  readonly canvas: HTMLCanvasElement
  readonly direction?: 'ltr' | 'rtl'
  readonly dpr: number
  readonly features?: readonly FontFeature[]
  readonly fontSize: number
  readonly fontFixture?: BenchmarkFontFixture
  readonly delivery?: FontDelivery
  readonly height: number
  readonly showGrid: boolean
  readonly language?: string
  readonly layoutWidth: number
  readonly signal?: AbortSignal
  readonly text: string
  readonly textAlign?: 'start' | 'center'
  readonly width: number
  readonly onError: (error: unknown) => void
  readonly onStats: (stats: SlugTextLiveStats) => void
  readonly onBakeProgress?: BakeProgressListener
}): Promise<SlugTextPreview> {
  const {
    backend,
    canvas,
    dpr,
    onError,
    onStats,
    onBakeProgress,
    signal,
    text,
    language = 'en',
    direction = 'ltr',
    features = [],
    textAlign = 'start',
    fontFixture = 'inter',
    delivery = 'baked',
  } = options
  signal?.throwIfAborted()
  const startupStarted = performance.now()
  let width = positiveViewportSize(options.width, 'Slug preview width')
  let height = positiveViewportSize(options.height, 'Slug preview height')
  let fontSize = positiveViewportSize(options.fontSize, 'Slug preview font size')
  let anchor = options.anchor ?? 'center'
  let layoutWidthRatio = options.layoutWidth / width
  assertLayoutWidthRatio(layoutWidthRatio)
  const rendererStarted = performance.now()
  const renderer = await createConfiguredRenderer({
    backend,
    canvas,
    dpr,
    height,
    trackGpuTimestamps: true,
    width,
  })
  let rendererViewport = readRendererViewportState(renderer)
  const canvasSurface = createCanvasSurface(renderer, width, height, options.showGrid)
  let gridVisible = options.showGrid
  const textUpdateTelemetry = createTextUpdateTelemetry()
  const rendererInitMs = performance.now() - rendererStarted
  let font: RegisteredFont | undefined
  let line: Text | undefined
  try {
    const fontStarted = performance.now()
    const loaded = await loadSlugFont(signal, fontFixture, delivery, onBakeProgress)
    font = loaded.font
    const fontLoadMs = performance.now() - fontStarted
    signal?.throwIfAborted()
    const activeFont = font
    const scene = new THREE.Scene()
    const textStarted = performance.now()
    line = new Text({
      text,
      font: activeFont,
      raster: loaded.raster,
      fontSize,
      rasterPixelRatio: rendererViewport.pixelRatio,
      lineHeight: LIVE_TEXT_LINE_HEIGHT,
      width: Math.max(120, width * layoutWidthRatio),
      wrap: 'word',
      language,
      direction,
      features,
      textAlign,
      color: LIVE_TEXT_COLOR,
    })
    const scheduledAt = performance.now()
    await line.ready
    const readyAt = performance.now()
    signal?.throwIfAborted()
    const activeLine = line
    const rasterConfiguration = await registeredSlugConfiguration(activeFont, signal)
    const textReadyMs = performance.now() - textStarted
    const startupMs = performance.now() - startupStarted
    const sceneStartedAt = performance.now()
    positionLiveLine(activeLine, width, height, anchor, layoutWidthRatio)
    scene.add(activeLine)
    const sceneFinishedAt = performance.now()
    textUpdateTelemetry.record({
      scheduleMs: scheduledAt - textStarted,
      readyMs: readyAt - scheduledAt,
      sceneMs: sceneFinishedAt - sceneStartedAt,
      totalMs: sceneFinishedAt - textStarted,
    })
    const camera = new THREE.OrthographicCamera(0, width, 0, -height, 0.1, 1_000)
    camera.position.z = 500
    camera.updateProjectionMatrix()
    const telemetry = createLiveFrameTelemetry()
    const gpuTimingSupported = renderer.hasFeature('timestamp-query')
    let firstDrawMs = 0
    let firstDrawRecorded = false
    let gpuTimestampRequest: number | undefined
    let gpuTimestampResolution: Promise<void> | undefined
    let closing = false
    let disposed = false
    let disposal: Promise<void> | undefined
    let updateRevision = 0

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
        if (closing || disposed) return
        gpuTimestampResolution = renderer
          .resolveTimestampsAsync(THREE.TimestampQuery.RENDER)
          .then((duration) => {
            if (closing || disposed || duration === undefined) return
            telemetry.recordGpu(duration)
          })
          .catch((error: unknown) => {
            if (!closing && !disposed) onError(error)
          })
          .finally(() => {
            gpuTimestampResolution = undefined
          })
      })
    }

    const renderFrame = (timestamp: number): void => {
      if (disposed) return
      try {
        const started = performance.now()
        canvasSurface.render(scene, camera)
        const submitMs = performance.now() - started
        if (!firstDrawRecorded) {
          firstDrawMs = submitMs
          firstDrawRecorded = true
        }
        if (closing) return
        const telemetrySnapshot = telemetry.recordSubmit(timestamp, submitMs)
        if (telemetrySnapshot === undefined) return
        scheduleGpuTimestamp()
        const layout = committedLayout(activeLine)
        const framebufferGpuBytes =
          rendererViewport.drawingBufferWidth * rendererViewport.drawingBufferHeight * 4
        onStats({
          technique: 'slug',
          backend,
          dpr: rendererViewport.pixelRatio,
          renderedPpem: fontSize * rendererViewport.pixelRatio,
          showGrid: gridVisible,
          ...telemetrySnapshot,
          glyphCount: renderedGlyphCount(activeLine),
          missingGlyphCount: missingGlyphCount(layout),
          drawCount: drawCount(activeLine),
          layoutWidth: layout.width,
          layoutHeight: layout.height,
          lineCount: layout.lineGlyphCounts.length,
          slugPageCount: rasterConfiguration.pageCount,
          slugCurveTexelCount: rasterConfiguration.curveTexelCount,
          slugCurveGpuBytes: rasterConfiguration.curveGpuBytes,
          slugHeaderCount: rasterConfiguration.headerCount,
          slugHeaderGpuBytes: rasterConfiguration.headerGpuBytes,
          slugReferenceCount: rasterConfiguration.referenceCount,
          slugReferenceGpuBytes: rasterConfiguration.referenceGpuBytes,
          slugGpuBytes: rasterConfiguration.gpuBytes,
          atlasGpuBytes: rasterConfiguration.gpuBytes,
          framebufferGpuBytes,
          totalGpuBytes: rasterConfiguration.gpuBytes + framebufferGpuBytes,
          artifactBytes: loaded.compressedBytes,
          delivery,
          sourceFontBytes: loaded.metrics.sourceFontBytes,
          coreArtifactBytes: loaded.metrics.coreArtifactBytes,
          coreBakeMs: loaded.metrics.coreBakeMs,
          rasterArtifactBytes: loaded.metrics.rasterArtifactBytes,
          rasterBakeMs: loaded.metrics.rasterBakeMs,
          rendererInitMs,
          fontLoadMs,
          textReadyMs,
          firstDrawMs,
          startupMs,
          gpuTimingSupported,
          textUpdateTimings: textUpdateTelemetry.summary(),
        })
      } catch (error) {
        onError(error)
      }
    }
    await renderer.setAnimationLoop(renderFrame)

    return {
      resize(nextWidth, nextHeight) {
        if (closing || disposed) return
        width = positiveViewportSize(nextWidth, 'Slug preview width')
        height = positiveViewportSize(nextHeight, 'Slug preview height')
        renderer.setSize(width, height, false)
        rendererViewport = readRendererViewportState(renderer)
        canvasSurface.resize(width, height)
        camera.right = width
        camera.bottom = -height
        camera.updateProjectionMatrix()
        const updateStartedAt = performance.now()
        const revision = ++updateRevision
        activeLine.setProperties({ width: Math.max(120, width * layoutWidthRatio) })
        const resizeScheduledAt = performance.now()
        void activeLine.ready
          .then(() => {
            if (closing || disposed || revision !== updateRevision) return
            const resizeSceneStartedAt = performance.now()
            positionLiveLine(activeLine, width, height, anchor, layoutWidthRatio)
            const finishedAt = performance.now()
            textUpdateTelemetry.record({
              scheduleMs: resizeScheduledAt - updateStartedAt,
              readyMs: resizeSceneStartedAt - resizeScheduledAt,
              sceneMs: finishedAt - resizeSceneStartedAt,
              totalMs: finishedAt - updateStartedAt,
            })
          })
          .catch((error: unknown) => {
            if (!closing && !disposed) onError(error)
          })
      },
      panBy(deltaX, deltaY) {
        if (closing || disposed) return
        scene.position.x += finiteCanvasDelta(deltaX, 'Slug preview horizontal pan')
        scene.position.y -= finiteCanvasDelta(deltaY, 'Slug preview vertical pan')
      },
      resetView() {
        scene.position.set(0, 0, 0)
      },
      setGridVisible(visible) {
        gridVisible = visible
        canvasSurface.setGridVisible(visible)
      },
      async update(next) {
        if (closing || disposed) {
          throw new DOMException('The Slug preview is disposed', 'AbortError')
        }
        const updateStartedAt = performance.now()
        fontSize = positiveViewportSize(next.fontSize, 'Slug preview font size')
        anchor = next.anchor
        assertLayoutWidthRatio(next.layoutWidthRatio)
        layoutWidthRatio = next.layoutWidthRatio
        const revision = ++updateRevision
        activeLine.setProperties({
          text: next.text,
          fontSize,
          width: Math.max(120, width * layoutWidthRatio),
          language: next.language,
          direction: next.direction,
          features: next.features,
          textAlign: next.textAlign,
        })
        const updateScheduledAt = performance.now()
        await activeLine.ready
        if (closing || disposed || revision !== updateRevision) {
          throw new DOMException('The Slug preview update was superseded', 'AbortError')
        }
        const updateSceneStartedAt = performance.now()
        positionLiveLine(activeLine, width, height, anchor, layoutWidthRatio)
        const finishedAt = performance.now()
        textUpdateTelemetry.record({
          scheduleMs: updateScheduledAt - updateStartedAt,
          readyMs: updateSceneStartedAt - updateScheduledAt,
          sceneMs: finishedAt - updateSceneStartedAt,
          totalMs: finishedAt - updateStartedAt,
        })
      },
      dispose() {
        if (disposal !== undefined) return disposal
        closing = true
        if (gpuTimestampRequest !== undefined) cancelAnimationFrame(gpuTimestampRequest)
        disposal = (async () => {
          await gpuTimestampResolution
          disposed = true
          await renderer.setAnimationLoop(null)
          activeLine.dispose()
          activeFont.dispose()
          canvasSurface.dispose()
          await renderer.dispose()
        })()
        return disposal
      },
    }
  } catch (error) {
    line?.dispose()
    font?.dispose()
    canvasSurface.dispose()
    await renderer.dispose()
    throw error
  }
}

async function createResources(backend: RendererBackend, dpr: number): Promise<SlugTextResources> {
  const canvas = document.createElement('canvas')
  const renderer = await createConfiguredRenderer({
    canvas,
    width: WIDTH,
    height: HEIGHT,
    backend,
    dpr,
  })
  let target: THREE.RenderTarget | undefined
  let font: RegisteredFont | undefined
  const lines: Text[] = []
  try {
    const fontStarted = performance.now()
    const loaded = await loadSlugFont()
    font = loaded.font
    const fontLoadMs = performance.now() - fontStarted
    const scene = new THREE.Scene()

    const resizeLine = new Text({
      text: BENCHMARK_IPSUM_CONFORMANCE_TEXT,
      font,
      raster: slug,
      fontSize: 18,
      lineHeight: 1.2,
      width: 280,
      wrap: 'word',
      color: 0xf2f5ff,
    })
    lines.push(resizeLine)
    await resizeLine.ready
    resizeLine.setProperties({ width: 476 })
    await resizeLine.ready
    resizeLine.position.set(18, -24, 0)
    scene.add(resizeLine)

    const smallLine = new Text({
      text: 'analytic 12 px  ffi  AV  0123456789',
      font,
      raster: slug,
      fontSize: 12,
      color: 0x7dd3fc,
    })
    lines.push(smallLine)
    await smallLine.ready
    smallLine.position.set(18, -142, 0)
    scene.add(smallLine)

    const transformLine = new Text({
      text: 'TRANSFORM / SLUG',
      font,
      raster: slug,
      fontSize: 30,
      color: 0xc4b5fd,
    })
    lines.push(transformLine)
    await transformLine.ready
    transformLine.position.set(252, -194, 0)
    transformLine.rotation.set(-0.2, 0.18, -0.1)
    transformLine.scale.setScalar(0.7)
    scene.add(transformLine)

    const opacityLine = new Text({
      text: 'Fill  Opacity',
      font,
      raster: slug,
      fontSize: 26,
      color: 0xf8fafc,
      opacity: 0.72,
    })
    lines.push(opacityLine)
    await opacityLine.ready
    opacityLine.position.set(18, -236, 0)
    scene.add(opacityLine)

    const configuration = await registeredSlugConfiguration(font)
    const camera = new THREE.OrthographicCamera(0, WIDTH, 0, -HEIGHT, 0.1, 1_000)
    camera.position.z = 500
    camera.updateProjectionMatrix()
    const physicalWidth = Math.round(WIDTH * dpr)
    const physicalHeight = Math.round(HEIGHT * dpr)
    target = new THREE.RenderTarget(physicalWidth, physicalHeight, {
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
    renderer.setClearColor(0x05070d, 1)
    renderer.clear()
    const firstDrawStarted = performance.now()
    renderer.render(scene, camera)
    const firstDrawMs = performance.now() - firstDrawStarted
    renderer.setRenderTarget(null)
    return {
      backend,
      dpr,
      renderer,
      target,
      scene,
      camera,
      font,
      lines,
      configuration,
      artifactBytes: loaded.artifactBytes,
      compressedBytes: loaded.compressedBytes,
      fontLoadMs,
      firstDrawMs,
    }
  } catch (error) {
    for (const line of lines) line.dispose()
    font?.dispose()
    target?.dispose()
    await renderer.dispose()
    throw error
  }
}

export async function captureSlugTextConformance(options: {
  readonly backend: RendererBackend
  readonly delivery?: FontDelivery
  readonly dpr: number
  readonly fontFixture?: BenchmarkFontFixture
  readonly signal?: AbortSignal
}): Promise<SlugTextConformanceCapture> {
  options.signal?.throwIfAborted()
  const resources = await createFlatSlugConformanceResources(
    options.backend,
    options.dpr,
    options.fontFixture,
    options.signal,
    options.delivery,
  )
  try {
    options.signal?.throwIfAborted()
    const capture = await captureFlatSlugConformance(resources)
    options.signal?.throwIfAborted()
    return capture
  } finally {
    await disposeFlatSlugConformanceResources(resources)
  }
}

export async function captureSlugSourceOutlineFidelity(options: {
  readonly backend: RendererBackend
  readonly dpr: number
  readonly fontFixture: BenchmarkFontFixture
  readonly signal?: AbortSignal
}): Promise<SourceOutlineFidelityCapture> {
  options.signal?.throwIfAborted()
  const resources = await createFlatSlugConformanceResources(
    options.backend,
    options.dpr,
    options.fontFixture,
    options.signal,
  )
  try {
    const capture = await captureFlatSlugConformance(resources)
    const specimen = rasterConformanceSpecimen(options.fontFixture)
    options.signal?.throwIfAborted()
    return await captureSourceOutlineFidelity({
      candidate: capture.candidate,
      width: capture.width,
      height: capture.height,
      dpr: options.dpr,
      fontFixture: options.fontFixture,
      fontSize: 64 / options.dpr,
      direction: specimen.direction,
      layout: committedLayout(resources.line),
      originX: resources.line.position.x,
      originY: resources.line.position.y,
      text: specimen.text,
      renderSubmitMs: capture.renderSubmitMs,
    })
  } finally {
    await disposeFlatSlugConformanceResources(resources)
  }
}

async function createFlatSlugConformanceResources(
  backend: RendererBackend,
  dpr: number,
  fontFixture: BenchmarkFontFixture = 'inter',
  signal?: AbortSignal,
  delivery: FontDelivery = 'baked',
): Promise<FlatSlugConformanceResources> {
  signal?.throwIfAborted()
  const canvas = document.createElement('canvas')
  const renderer = await createConfiguredRenderer({
    canvas,
    width: WIDTH,
    height: FLAT_CONFORMANCE_HEIGHT,
    backend,
    dpr,
  })
  let target: THREE.RenderTarget | undefined
  let font: RegisteredFont | undefined
  let line: Text | undefined
  let resource: SlugResource | undefined
  try {
    const loaded = await loadSlugFont(signal, fontFixture, delivery)
    font = loaded.font
    const rasterKey = await slugDescriptorRasterKey()
    const specimen = rasterConformanceSpecimen(fontFixture)
    line = new Text({
      text: specimen.text,
      font,
      raster: loaded.raster,
      fontSize: 64 / dpr,
      rasterPixelRatio: dpr,
      lineHeight: 1.2,
      width: 476,
      wrap: 'word',
      color: 0xffffff,
      language: specimen.language,
      direction: specimen.direction,
      textAlign: 'start',
    })
    await line.ready
    const conformanceMissingGlyphCount = committedLayout(line).glyphIds.reduce(
      (count, glyphId) => count + (glyphId === 0 ? 1 : 0),
      0,
    )
    if (conformanceMissingGlyphCount !== 0) {
      throw new Error(
        `${fontFixture} Slug conformance specimen contains ${String(conformanceMissingGlyphCount)} missing glyphs`,
      )
    }
    const raster = await font.loadRaster(
      { rasterKey, kind: slug.kind },
      signal === undefined ? undefined : { signal },
    )
    resource = await loaded.raster.decode(font, raster, signal)
    signal?.throwIfAborted()
    line.position.set(18, -18, 0)
    const scene = new THREE.Scene()
    scene.add(line)
    const camera = new THREE.OrthographicCamera(0, WIDTH, 0, -FLAT_CONFORMANCE_HEIGHT, 0.1, 1_000)
    camera.position.z = 500
    camera.updateProjectionMatrix()
    target = new THREE.RenderTarget(
      Math.round(WIDTH * dpr),
      Math.round(FLAT_CONFORMANCE_HEIGHT * dpr),
      {
        depthBuffer: false,
        stencilBuffer: false,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        type: THREE.UnsignedByteType,
        format: THREE.RGBAFormat,
      },
    )
    target.texture.colorSpace = THREE.NoColorSpace
    target.texture.generateMipmaps = false
    return { backend, dpr, fontFixture, renderer, target, scene, camera, font, line, resource }
  } catch (error) {
    line?.dispose()
    if (resource !== undefined) slug.dispose(resource)
    font?.dispose()
    target?.dispose()
    await renderer.dispose()
    throw error
  }
}

async function captureFlatSlugConformance(
  resources: FlatSlugConformanceResources,
): Promise<SlugTextConformanceCapture> {
  const width = Math.round(WIDTH * resources.dpr)
  const height = Math.round(FLAT_CONFORMANCE_HEIGHT * resources.dpr)
  resources.renderer.setRenderTarget(resources.target)
  resources.renderer.setClearColor(0x000000, 1)
  resources.renderer.clear()
  const started = performance.now()
  resources.renderer.render(resources.scene, resources.camera)
  const renderSubmitMs = performance.now() - started
  const readback = await resources.renderer.readRenderTargetPixelsAsync(
    resources.target,
    0,
    0,
    width,
    height,
  )
  resources.renderer.setRenderTarget(null)
  const candidate = compactRgba8Readback(
    new Uint8Array(readback.buffer, readback.byteOffset, readback.byteLength),
    width,
    height,
    resources.backend === 'webgl2' ? 'bottom-to-top' : 'top-to-bottom',
  )
  const referenceResult = renderFlatSlugCpuReference(
    resources.resource,
    committedLayout(resources.line),
    {
      width,
      height,
      dpr: resources.dpr,
      originX: resources.line.position.x,
      originY: resources.line.position.y,
    },
  )
  const reference = referenceResult.pixels
  const comparison = compareRgba8Coverage(candidate, reference)
  return {
    width,
    height,
    candidate,
    reference,
    difference: comparison.heatmap,
    meanAbsoluteError: comparison.meanAbsoluteError,
    maximumError: comparison.maximumError,
    errorPixels: comparison.errorPixels,
    severeErrorPixels: comparison.severeErrorPixels,
    glyphCount: referenceResult.glyphCount,
    evaluatedCurves: referenceResult.evaluatedCurves,
    renderSubmitMs,
  }
}

async function disposeFlatSlugConformanceResources(
  resources: FlatSlugConformanceResources,
): Promise<void> {
  resources.line.dispose()
  slug.dispose(resources.resource)
  resources.font.dispose()
  resources.target.dispose()
  await resources.renderer.dispose()
}

export async function loadSlugFont(
  signal?: AbortSignal,
  fixture: BenchmarkFontFixture = 'inter',
  delivery: FontDelivery = 'baked',
  onProgress?: BakeProgressListener,
): Promise<{
  readonly artifactBytes: number
  readonly compressedBytes: number
  readonly font: RegisteredFont
  readonly metrics: FontDeliveryMetrics
  readonly raster: SlugModule
}> {
  signal?.throwIfAborted()
  const metrics = createFontDeliveryMetrics(delivery)
  const manifest = slugFixtureManifests.get(fixture)
  if (manifest === undefined) throw new RangeError(`Unknown Slug font fixture: ${fixture}`)
  if (delivery === 'runtime') {
    const loaded = await loadRuntimeFont(fixture, metrics, signal, onProgress)
    return {
      artifactBytes: metrics.coreArtifactBytes,
      compressedBytes: metrics.sourceFontBytes,
      font: loaded.font,
      metrics,
      raster: measuredSlugRaster(metrics, onProgress),
    }
  }
  const response = await fetch(
    compressedFontUrls[fixture],
    signal === undefined ? undefined : { signal },
  )
  if (!response.ok) throw new Error(`Unable to load Slug font fixture (${response.status})`)
  const received = new Uint8Array(await response.arrayBuffer())
  signal?.throwIfAborted()
  const artifact =
    received.byteLength === manifest.uncompressed.bytes
      ? received
      : await decompressFixture(received, manifest)
  await assertFixtureBytes(artifact, manifest.uncompressed, 'uncompressed')
  signal?.throwIfAborted()
  const registry = new FontRegistry({ maxArtifactBytes: manifest.uncompressed.bytes })
  return {
    artifactBytes: artifact.byteLength,
    compressedBytes: manifest.compressed.bytes,
    font: await registry.registerAsset(artifact),
    metrics,
    raster: slug,
  }
}

export async function registeredSlugConfiguration(
  font: RegisteredFont,
  signal?: AbortSignal,
): Promise<SlugRasterConfiguration> {
  const rasterKey = await slugDescriptorRasterKey()
  const raster = await font.loadRaster(
    { kind: slug.kind, rasterKey },
    signal === undefined ? undefined : { signal },
  )
  const resource = await slug.decode(font, raster, signal)
  try {
    return slugResourceConfiguration(resource)
  } finally {
    slug.dispose(resource)
  }
}

function slugResourceConfiguration(resource: SlugResource): SlugRasterConfiguration {
  let curveTexelCount = 0
  let curveGpuBytes = 0
  let headerCount = 0
  let headerGpuBytes = 0
  let referenceCount = 0
  let referenceGpuBytes = 0
  for (const page of resource.pages) {
    const curveAllocation = page.curveWidth * page.curveHeight * 8
    const headerAllocation = page.headerWidth * page.headerHeight * 4
    const referenceAllocation = page.referenceWidth * page.referenceHeight * 4
    curveTexelCount += page.curveWidth * page.curveHeight
    curveGpuBytes += curveAllocation
    headerCount += page.headerCount
    headerGpuBytes += headerAllocation
    referenceCount += page.referenceCount
    referenceGpuBytes += referenceAllocation
  }
  const allocationTotal = curveGpuBytes + headerGpuBytes + referenceGpuBytes
  if (allocationTotal !== resource.gpuBytes) {
    throw new Error('Slug page allocations do not match the decoded resource GPU byte total')
  }
  return {
    planeUnitsPerEm: resource.planeUnitsPerEm,
    pageCount: resource.pages.length,
    curveTexelCount,
    curveGpuBytes,
    headerCount,
    headerGpuBytes,
    referenceCount,
    referenceGpuBytes,
    gpuBytes: resource.gpuBytes,
  }
}

function measuredSlugRaster(
  metrics: FontDeliveryMetrics,
  onProgress?: BakeProgressListener,
): SlugModule {
  const runtimeBaker = measuredRuntimeBaker(slug.runtimeBaker, metrics, onProgress)
  return defineRaster({
    ...slug,
    ...(runtimeBaker === undefined ? {} : { runtimeBaker }),
  })
}

function measuredRuntimeBaker<Kind extends string, Options>(
  load:
    | (() => Promise<
        | RuntimeRasterBakerModule<Kind, Options>
        | { readonly default: RuntimeRasterBakerModule<Kind, Options> }
      >)
    | undefined,
  metrics: FontDeliveryMetrics,
  onProgress?: BakeProgressListener,
) {
  if (load === undefined) return undefined
  return async (): Promise<RuntimeRasterBakerModule<Kind, Options>> => {
    const started = performance.now()
    const imported = await load()
    const baker = 'default' in imported ? imported.default : imported
    return {
      kind: baker.kind,
      async bake(request) {
        const artifact = await baker.bake({
          ...request,
          ...(onProgress === undefined ? {} : { onProgress }),
        })
        metrics.rasterBakeMs = performance.now() - started
        metrics.rasterArtifactBytes = rasterArtifactBytes(artifact)
        metrics.rasterGpuBytes = artifact.report.gpuBytes
        return artifact
      },
    }
  }
}

function rasterArtifactBytes(artifact: RasterBakeArtifact<string>): number {
  return artifact.artifacts.reduce((total, entry) => total + entry.bytes.byteLength, 0)
}

function positionLiveLine(
  line: Text,
  viewportWidth: number,
  viewportHeight: number,
  anchor: LiveTextAnchor = 'center',
  layoutWidthRatio = 1,
): void {
  const layout = committedLayout(line)
  const positionedWidth =
    anchor === 'center' ? layout.width : Math.max(120, viewportWidth * layoutWidthRatio)
  const [x, y] = liveTextPosition(
    anchor,
    viewportWidth,
    viewportHeight,
    positionedWidth,
    layout.height,
  )
  line.position.set(x, y, 0)
}

function committedLayout(line: Text): ParagraphLayout {
  const layout = line.layout
  if (layout === undefined) throw new Error('live Slug Text lost its committed layout')
  return layout
}

function missingGlyphCount(layout: ParagraphLayout): number {
  return layout.glyphIds.reduce((count, glyphId) => count + (glyphId === 0 ? 1 : 0), 0)
}

function positiveViewportSize(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be positive`)
  return value
}

function assertLayoutWidthRatio(value: number): void {
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new RangeError('Slug preview layout width ratio must be in (0, 1]')
  }
}

async function decompressFixture(
  compressed: Uint8Array<ArrayBuffer>,
  manifest: SlugFixtureManifest,
): Promise<Uint8Array<ArrayBuffer>> {
  await assertFixtureBytes(compressed, manifest.compressed, 'compressed')
  return decompressGzip(compressed)
}

async function decompressGzip(
  compressed: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function assertFixtureBytes(
  bytes: Uint8Array<ArrayBuffer>,
  expected: { readonly bytes: number; readonly sha256: string },
  label: string,
): Promise<void> {
  if (bytes.byteLength !== expected.bytes) {
    throw new Error(
      `Slug ${label} fixture has ${bytes.byteLength} bytes; expected ${expected.bytes}`,
    )
  }
  const hash = hex(await crypto.subtle.digest('SHA-256', bytes))
  if (hash !== expected.sha256) throw new Error(`Slug ${label} fixture failed SHA-256`)
}

async function renderSlugText(resources: SlugTextResources): Promise<TargetRunOutput> {
  const rendered = await renderSlugFrame(resources)
  const { bytes, renderMs, pixelEvidence } = rendered
  return {
    bytes: bytes.byteLength,
    hash: await sha256(bytes),
    metrics: {
      backendWebGpu: resources.backend === 'webgpu' ? 1 : 0,
      backendWebGl2: resources.backend === 'webgl2' ? 1 : 0,
      dpr: resources.dpr,
      sceneCount: 4,
      textObjectCount: resources.lines.length,
      glyphCount: resources.lines.reduce((sum, line) => sum + renderedGlyphCount(line), 0),
      drawCount: resources.lines.reduce((sum, line) => sum + drawCount(line), 0),
      changedPixels: pixelEvidence.changedPixels,
      distinctRgbColors: pixelEvidence.distinctRgbColors,
      artifactBytes: resources.artifactBytes,
      compressedArtifactBytes: resources.compressedBytes,
      slugPageCount: resources.configuration.pageCount,
      slugCurveGpuBytes: resources.configuration.curveGpuBytes,
      slugHeaderGpuBytes: resources.configuration.headerGpuBytes,
      slugReferenceGpuBytes: resources.configuration.referenceGpuBytes,
      slugGpuBytes: resources.configuration.gpuBytes,
      renderTargetGpuBytes: bytes.byteLength,
      fontLoadMs: resources.fontLoadMs,
      firstDrawMs: resources.firstDrawMs,
      renderMs,
    },
  }
}

async function renderSlugFrame(resources: SlugTextResources): Promise<{
  readonly bytes: Uint8Array
  readonly renderMs: number
  readonly pixelEvidence: ReturnType<typeof inspectPixels>
}> {
  const { renderer, target, scene, camera } = resources
  const width = Math.round(WIDTH * resources.dpr)
  const height = Math.round(HEIGHT * resources.dpr)
  renderer.setRenderTarget(target)
  renderer.setClearColor(0x05070d, 1)
  renderer.clear()
  const started = performance.now()
  renderer.render(scene, camera)
  const renderMs = performance.now() - started
  const readback = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height)
  renderer.setRenderTarget(null)
  const bytes = compactRgba8Readback(
    new Uint8Array(readback.buffer, readback.byteOffset, readback.byteLength),
    width,
    height,
    resources.backend === 'webgl2' ? 'bottom-to-top' : 'top-to-bottom',
  )
  const pixelEvidence = inspectPixels(bytes)
  if (pixelEvidence.changedPixels < 500 || pixelEvidence.distinctRgbColors < 4) {
    throw new Error('Slug conformance scene did not render its expected visible content')
  }
  return { bytes, renderMs, pixelEvidence }
}

function inspectPixels(bytes: Uint8Array): {
  readonly changedPixels: number
  readonly distinctRgbColors: number
} {
  let changedPixels = 0
  const colors = new Set<number>()
  const backgroundRed = bytes[0]!
  const backgroundGreen = bytes[1]!
  const backgroundBlue = bytes[2]!
  const backgroundAlpha = bytes[3]!
  for (let offset = 0; offset < bytes.byteLength; offset += 4) {
    const red = bytes[offset]!
    const green = bytes[offset + 1]!
    const blue = bytes[offset + 2]!
    const alpha = bytes[offset + 3]!
    if (
      red === backgroundRed &&
      green === backgroundGreen &&
      blue === backgroundBlue &&
      alpha === backgroundAlpha
    ) {
      continue
    }
    changedPixels += 1
    colors.add((red << 16) | (green << 8) | blue)
  }
  return { changedPixels, distinctRgbColors: colors.size }
}

function renderedGlyphCount(object: THREE.Object3D): number {
  let count = 0
  object.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry instanceof THREE.InstancedBufferGeometry) {
      count += child.geometry.instanceCount
    }
  })
  return count
}

function drawCount(object: THREE.Object3D): number {
  let count = 0
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) count += 1
  })
  return count
}

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (value) => value.toString(16).padStart(2, '0')).join('')
}

async function sha256(bytes: Uint8Array): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes)))
}
