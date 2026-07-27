import {
  FontRegistry,
  Text,
  type FontFeature,
  type ParagraphLayout,
  type RegisteredFont,
} from '@pmndrs/text'
import { msdf, msdfDescriptorRasterKey, type MsdfResource } from '@pmndrs/text/raster/msdf'
import * as THREE from 'three/webgpu'

import amiriCompressedFontUrl from '../../fixtures/rendering/amiri-mtsdf.font.glb.gz?url'
import dancingScriptCompressedFontUrl from '../../fixtures/rendering/dancing-script-mtsdf.font.glb.gz?url'
import dotGothicCompressedFontUrl from '../../fixtures/rendering/dot-gothic-16-mtsdf.font.glb.gz?url'
import interCompressedFontUrl from '../../fixtures/rendering/inter-mtsdf.font.glb.gz?url'
import devanagariCompressedFontUrl from '../../fixtures/rendering/noto-sans-devanagari-mtsdf.font.glb.gz?url'
import sourceSerifCompressedFontUrl from '../../fixtures/rendering/source-serif-4-mtsdf.font.glb.gz?url'
import showcaseManifest from '../../fixtures/rendering/showcase-mtsdf-fixtures-v0.json'
import { conformanceTextForFont, type BenchmarkFontFixture } from '../benchmark/font-fixtures'
import type { BenchmarkTarget, TargetRunOutput } from '../benchmark/contracts'
import { BENCHMARK_IPSUM_CONFORMANCE_TEXT } from '../benchmark/benchmark-ipsum'
import { createLiveFrameTelemetry } from './live-frame-telemetry'
import { LIVE_TEXT_COLOR, LIVE_TEXT_LINE_HEIGHT } from './live-text-style'
import { compareRgba8Coverage, renderFlatMtsdfCpuReference } from './mtsdf-cpu-reference'
import { compactRgba8Readback } from './tsl-baseline'
import { createConfiguredRenderer, type RendererBackend } from './webgpu-renderer'

const WIDTH = 512
const HEIGHT = 320
const FLAT_CONFORMANCE_HEIGHT = 512

interface MtsdfFixtureManifest {
  readonly fontFixture: BenchmarkFontFixture
  readonly compressed: { readonly bytes: number; readonly sha256: string }
  readonly uncompressed: { readonly bytes: number; readonly sha256: string }
  readonly raster: {
    readonly runtimeTextureArray: { readonly mipmappedBytes: number }
  }
}

const compressedFontUrls: Readonly<Record<BenchmarkFontFixture, string>> = {
  inter: interCompressedFontUrl,
  amiri: amiriCompressedFontUrl,
  'noto-sans-devanagari': devanagariCompressedFontUrl,
  'dot-gothic-16': dotGothicCompressedFontUrl,
  'source-serif-4': sourceSerifCompressedFontUrl,
  'dancing-script': dancingScriptCompressedFontUrl,
}
const mtsdfFixtureManifests = new Map(
  showcaseManifest.artifacts.map((artifact) => [artifact.fontFixture, artifact]),
) as ReadonlyMap<BenchmarkFontFixture, MtsdfFixtureManifest>

interface MtsdfTextResources {
  readonly backend: RendererBackend
  readonly dpr: number
  readonly renderer: THREE.WebGPURenderer
  readonly target: THREE.RenderTarget
  readonly scene: THREE.Scene
  readonly camera: THREE.OrthographicCamera
  readonly font: RegisteredFont
  readonly lines: readonly Text[]
  readonly artifactBytes: number
  readonly compressedBytes: number
  readonly fontLoadMs: number
  readonly firstDrawMs: number
}

export interface MtsdfTextLiveStats {
  readonly technique: 'mtsdf'
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

export interface MtsdfTextPreviewUpdate {
  readonly direction: 'ltr' | 'rtl'
  readonly features: readonly FontFeature[]
  readonly fontSize: number
  readonly language: string
  readonly layoutWidthRatio: number
  readonly text: string
}

export interface MtsdfTextPreview {
  resize(width: number, height: number): void
  update(update: MtsdfTextPreviewUpdate): Promise<void>
  dispose(): Promise<void>
}

export interface MtsdfTextConformanceCapture {
  readonly width: number
  readonly height: number
  readonly candidate: Uint8Array
  readonly reference: Uint8Array
  readonly difference: Uint8Array
  readonly meanAbsoluteError: number
  readonly maximumError: number
  readonly errorPixels: number
  readonly glyphCount: number
  readonly renderSubmitMs: number
}

interface FlatMtsdfConformanceResources {
  readonly backend: RendererBackend
  readonly dpr: number
  readonly fontFixture: BenchmarkFontFixture
  readonly renderer: THREE.WebGPURenderer
  readonly target: THREE.RenderTarget
  readonly scene: THREE.Scene
  readonly camera: THREE.OrthographicCamera
  readonly font: RegisteredFont
  readonly line: Text
  readonly resource: MsdfResource
}

type MtsdfTextState =
  | { readonly kind: 'empty' }
  | { readonly kind: 'ready'; readonly resources: MtsdfTextResources }

export function createMtsdfTextTarget(backend: RendererBackend): BenchmarkTarget {
  let state: MtsdfTextState = { kind: 'empty' }
  return {
    id: `mtsdf-text-${backend}`,
    label: backend === 'webgpu' ? 'MTSDF text · WebGPU' : 'MTSDF text · WebGL2 fallback',
    detail: 'Inter GLB · HarfRust layout · RGBA8 KTX2 · shared TSL graph',
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
      if (state.kind !== 'ready') throw new Error('MTSDF text target was not loaded')
      return renderMtsdfText(state.resources)
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

export function createMtsdfConformanceTarget(backend: RendererBackend): BenchmarkTarget {
  let resources: FlatMtsdfConformanceResources | undefined
  let fontFixture: BenchmarkFontFixture = 'inter'
  return {
    id: `mtsdf-conformance-${backend}`,
    label:
      backend === 'webgpu'
        ? 'MTSDF sampling conformance · WebGPU'
        : 'MTSDF sampling conformance · WebGL2 fallback',
    detail: 'GPU TSL candidate · independent scalar CPU reconstruction · visual difference',
    color: backend === 'webgpu' ? 'cyan' : 'amber',
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
      resources ??= await createFlatMtsdfConformanceResources(backend, controls.dpr, fontFixture)
    },
    run: async () => {
      if (resources === undefined) throw new Error('MTSDF conformance target was not loaded')
      const capture = await captureFlatMtsdfConformance(resources)
      return {
        bytes: capture.candidate.byteLength,
        hash: await sha256(capture.candidate),
        metrics: {
          backendWebGpu: backend === 'webgpu' ? 1 : 0,
          backendWebGl2: backend === 'webgl2' ? 1 : 0,
          dpr: resources.dpr,
          fixtureIsInter: fontFixture === 'inter' ? 1 : 0,
          pixelCount: capture.width * capture.height,
          glyphCount: capture.glyphCount,
          meanAbsoluteError: capture.meanAbsoluteError,
          maximumError: capture.maximumError,
          errorPixels: capture.errorPixels,
          renderMs: capture.renderSubmitMs,
        },
      }
    },
    dispose: async () => {
      const current = resources
      resources = undefined
      if (current !== undefined) await disposeFlatMtsdfConformanceResources(current)
    },
  }
}

export async function createMtsdfTextPreview(options: {
  readonly backend: RendererBackend
  readonly canvas: HTMLCanvasElement
  readonly direction?: 'ltr' | 'rtl'
  readonly dpr: number
  readonly features?: readonly FontFeature[]
  readonly fontSize: number
  readonly fontFixture?: BenchmarkFontFixture
  readonly height: number
  readonly language?: string
  readonly layoutWidth: number
  readonly signal?: AbortSignal
  readonly text: string
  readonly width: number
  readonly onError: (error: unknown) => void
  readonly onStats: (stats: MtsdfTextLiveStats) => void
}): Promise<MtsdfTextPreview> {
  const {
    backend,
    canvas,
    dpr,
    onError,
    onStats,
    signal,
    text,
    language = 'en',
    direction = 'ltr',
    features = [],
    fontFixture = 'inter',
  } = options
  signal?.throwIfAborted()
  const startupStarted = performance.now()
  let width = positiveViewportSize(options.width, 'MSDF preview width')
  let height = positiveViewportSize(options.height, 'MSDF preview height')
  let fontSize = positiveViewportSize(options.fontSize, 'MSDF preview font size')
  let layoutWidthRatio = options.layoutWidth / width
  assertLayoutWidthRatio(layoutWidthRatio)
  const rendererStarted = performance.now()
  const renderer = await createConfiguredRenderer({
    alpha: true,
    backend,
    canvas,
    dpr,
    height,
    trackGpuTimestamps: true,
    width,
  })
  const rendererInitMs = performance.now() - rendererStarted
  let font: RegisteredFont | undefined
  let line: Text | undefined
  try {
    const fontStarted = performance.now()
    const loaded = await loadMtsdfFont(signal, fontFixture)
    font = loaded.font
    const fontLoadMs = performance.now() - fontStarted
    signal?.throwIfAborted()
    const activeFont = font
    const scene = new THREE.Scene()
    const textStarted = performance.now()
    line = new Text({
      text,
      font: activeFont,
      raster: msdf,
      fontSize,
      lineHeight: LIVE_TEXT_LINE_HEIGHT,
      width: Math.max(120, width * layoutWidthRatio),
      wrap: 'word',
      language,
      direction,
      features,
      color: LIVE_TEXT_COLOR,
    })
    await line.ready
    signal?.throwIfAborted()
    const activeLine = line
    const textReadyMs = performance.now() - textStarted
    const startupMs = performance.now() - startupStarted
    positionLiveLine(activeLine, width, height)
    scene.add(activeLine)
    const camera = new THREE.OrthographicCamera(0, width, 0, -height, 0.1, 1_000)
    camera.position.z = 500
    camera.updateProjectionMatrix()
    renderer.setClearColor(0x000000, 0)

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
      if (closing || disposed) return
      try {
        const started = performance.now()
        renderer.setRenderTarget(null)
        renderer.clear()
        renderer.render(scene, camera)
        const submitMs = performance.now() - started
        if (!firstDrawRecorded) {
          firstDrawMs = submitMs
          firstDrawRecorded = true
        }
        const telemetrySnapshot = telemetry.recordSubmit(timestamp, submitMs)
        if (telemetrySnapshot === undefined) return
        scheduleGpuTimestamp()
        const layout = committedLayout(activeLine)
        const framebufferGpuBytes = Math.round(width * dpr) * Math.round(height * dpr) * 4
        const atlasGpuBytes = loaded.atlasGpuBytes
        onStats({
          technique: 'mtsdf',
          backend,
          dpr,
          ...telemetrySnapshot,
          glyphCount: renderedGlyphCount(activeLine),
          missingGlyphCount: missingGlyphCount(layout),
          drawCount: drawCount(activeLine),
          layoutWidth: layout.width,
          layoutHeight: layout.height,
          lineCount: layout.lineGlyphCounts.length,
          atlasGpuBytes,
          framebufferGpuBytes,
          totalGpuBytes: atlasGpuBytes + framebufferGpuBytes,
          artifactBytes: loaded.compressedBytes,
          rendererInitMs,
          fontLoadMs,
          textReadyMs,
          firstDrawMs,
          startupMs,
          gpuTimingSupported,
        })
      } catch (error) {
        onError(error)
      }
    }
    await renderer.setAnimationLoop(renderFrame)

    return {
      resize(nextWidth, nextHeight) {
        if (closing || disposed) return
        width = positiveViewportSize(nextWidth, 'MSDF preview width')
        height = positiveViewportSize(nextHeight, 'MSDF preview height')
        renderer.setSize(width, height, false)
        camera.right = width
        camera.bottom = -height
        camera.updateProjectionMatrix()
        const revision = ++updateRevision
        activeLine.setProperties({ width: Math.max(120, width * layoutWidthRatio) })
        void activeLine.ready
          .then(() => {
            if (closing || disposed || revision !== updateRevision) return
            positionLiveLine(activeLine, width, height)
          })
          .catch((error: unknown) => {
            if (!closing && !disposed) onError(error)
          })
      },
      async update(next) {
        if (closing || disposed) {
          throw new DOMException('The MSDF preview is disposed', 'AbortError')
        }
        fontSize = positiveViewportSize(next.fontSize, 'MSDF preview font size')
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
        })
        await activeLine.ready
        if (closing || disposed || revision !== updateRevision) {
          throw new DOMException('The MSDF preview update was superseded', 'AbortError')
        }
        positionLiveLine(activeLine, width, height)
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
          await renderer.dispose()
        })()
        return disposal
      },
    }
  } catch (error) {
    line?.dispose()
    font?.dispose()
    await renderer.dispose()
    throw error
  }
}

async function createResources(backend: RendererBackend, dpr: number): Promise<MtsdfTextResources> {
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
    const loaded = await loadMtsdfFont()
    font = loaded.font
    const fontLoadMs = performance.now() - fontStarted
    const scene = new THREE.Scene()

    const resizeLine = new Text({
      text: BENCHMARK_IPSUM_CONFORMANCE_TEXT,
      font,
      raster: msdf,
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

    const mipLine = new Text({
      text: 'mip 12 px  ffi  AV  0123456789',
      font,
      raster: msdf,
      fontSize: 12,
      color: 0x7dd3fc,
    })
    lines.push(mipLine)
    await mipLine.ready
    mipLine.position.set(18, -142, 0)
    scene.add(mipLine)

    const transformLine = new Text({
      text: 'TRANSFORM / MTSDF',
      font,
      raster: msdf,
      fontSize: 30,
      color: 0xc4b5fd,
    })
    lines.push(transformLine)
    await transformLine.ready
    transformLine.position.set(252, -194, 0)
    transformLine.rotation.set(-0.2, 0.18, -0.1)
    transformLine.scale.setScalar(0.7)
    scene.add(transformLine)

    const effectsLine = new Text({
      text: 'Fill  Outline  Shadow',
      font,
      raster: msdf,
      fontSize: 26,
      color: 0xf8fafc,
      opacity: 0.92,
      outline: { color: 0x22d3ee, width: 1.5 },
      shadow: { color: 0x6d28d9, offset: [3, 3] },
    })
    lines.push(effectsLine)
    await effectsLine.ready
    effectsLine.position.set(18, -236, 0)
    scene.add(effectsLine)

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

export async function loadMtsdfFont(
  signal?: AbortSignal,
  fixture: BenchmarkFontFixture = 'inter',
): Promise<{
  readonly artifactBytes: number
  readonly atlasGpuBytes: number
  readonly compressedBytes: number
  readonly font: RegisteredFont
}> {
  signal?.throwIfAborted()
  const manifest = mtsdfFixtureManifests.get(fixture)
  if (manifest === undefined) throw new RangeError(`Unknown MTSDF font fixture: ${fixture}`)
  const response = await fetch(
    compressedFontUrls[fixture],
    signal === undefined ? undefined : { signal },
  )
  if (!response.ok) throw new Error(`Unable to load MTSDF font fixture (${response.status})`)
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
    atlasGpuBytes: manifest.raster.runtimeTextureArray.mipmappedBytes,
    compressedBytes: manifest.compressed.bytes,
    font: await registry.registerAsset(artifact),
  }
}

function positionLiveLine(line: Text, viewportWidth: number, viewportHeight: number): void {
  const layout = committedLayout(line)
  line.position.set(
    Math.max(12, (viewportWidth - layout.width) / 2),
    -Math.max(12, (viewportHeight - layout.height) / 2),
    0,
  )
}

function committedLayout(line: Text): ParagraphLayout {
  const layout = line.layout
  if (layout === undefined) throw new Error('live MSDF Text lost its committed layout')
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
    throw new RangeError('MSDF preview layout width ratio must be in (0, 1]')
  }
}

async function decompressFixture(
  compressed: Uint8Array<ArrayBuffer>,
  manifest: MtsdfFixtureManifest,
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
      `MTSDF ${label} fixture has ${bytes.byteLength} bytes; expected ${expected.bytes}`,
    )
  }
  const hash = hex(await crypto.subtle.digest('SHA-256', bytes))
  if (hash !== expected.sha256) throw new Error(`MTSDF ${label} fixture failed SHA-256`)
}

async function renderMtsdfText(resources: MtsdfTextResources): Promise<TargetRunOutput> {
  const rendered = await renderMtsdfFrame(resources)
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
      renderTargetGpuBytes: bytes.byteLength,
      fontLoadMs: resources.fontLoadMs,
      firstDrawMs: resources.firstDrawMs,
      renderMs,
    },
  }
}

export async function captureMtsdfTextConformance(options: {
  readonly backend: RendererBackend
  readonly dpr: number
  readonly fontFixture?: BenchmarkFontFixture
  readonly signal?: AbortSignal
}): Promise<MtsdfTextConformanceCapture> {
  options.signal?.throwIfAborted()
  const resources = await createFlatMtsdfConformanceResources(
    options.backend,
    options.dpr,
    options.fontFixture,
    options.signal,
  )
  try {
    options.signal?.throwIfAborted()
    const capture = await captureFlatMtsdfConformance(resources)
    options.signal?.throwIfAborted()
    return capture
  } finally {
    await disposeFlatMtsdfConformanceResources(resources)
  }
}

async function createFlatMtsdfConformanceResources(
  backend: RendererBackend,
  dpr: number,
  fontFixture: BenchmarkFontFixture = 'inter',
  signal?: AbortSignal,
): Promise<FlatMtsdfConformanceResources> {
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
  let resource: MsdfResource | undefined
  try {
    font = (await loadMtsdfFont(signal, fontFixture)).font
    const rasterKey = await msdfDescriptorRasterKey()
    const raster = await font.loadRaster(
      { rasterKey, kind: msdf.kind },
      signal === undefined ? undefined : { signal },
    )
    resource = await msdf.decode(font, raster, signal)
    line = new Text({
      text: conformanceTextForFont(fontFixture),
      font,
      raster: msdf,
      // Match the baked 64 px/em base level in device pixels. Minification and
      // generated mip selection are exercised by the separate scene corpus.
      fontSize: 64 / dpr,
      lineHeight: 1.2,
      width: 476,
      wrap: 'word',
      color: 0xffffff,
    })
    await line.ready
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
    if (resource !== undefined) msdf.dispose(resource)
    font?.dispose()
    target?.dispose()
    await renderer.dispose()
    throw error
  }
}

async function captureFlatMtsdfConformance(
  resources: FlatMtsdfConformanceResources,
): Promise<MtsdfTextConformanceCapture> {
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
  const referenceResult = renderFlatMtsdfCpuReference(
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
    glyphCount: referenceResult.glyphCount,
    renderSubmitMs,
  }
}

async function disposeFlatMtsdfConformanceResources(
  resources: FlatMtsdfConformanceResources,
): Promise<void> {
  resources.line.dispose()
  msdf.dispose(resources.resource)
  resources.font.dispose()
  resources.target.dispose()
  await resources.renderer.dispose()
}

async function renderMtsdfFrame(resources: MtsdfTextResources): Promise<{
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
    throw new Error('MTSDF conformance scene did not render its expected visible content')
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
