import { Text, type ParagraphLayout, type RegisteredFont, type TextSpan } from '@pmndrs/text'
import { bitmap } from '@pmndrs/text/raster/bitmap'
import { msdf } from '@pmndrs/text/raster/msdf'
import * as THREE from 'three/webgpu'

import type { BenchmarkFontFixture } from '../benchmark/font-fixtures'
import { benchmarkIpsumForFont } from '../benchmark/font-fixtures'
import type { RasterTechnique } from '../benchmark/url-state'
import { loadBitmapFont, registeredBitmapAtlas, type BitmapTextLiveStats } from './bitmap-text'
import { createLiveFrameTelemetry } from './live-frame-telemetry'
import { LIVE_TEXT_COLOR, LIVE_TEXT_LINE_HEIGHT } from './live-text-style'
import { loadMtsdfFont, type MtsdfTextLiveStats } from './mtsdf-text'
import { createConfiguredRenderer, type RendererBackend } from './webgpu-renderer'

export type ComparisonWorkloadId =
  | 'text-ladder'
  | 'off-axis-3d'
  | 'dynamic-layout'
  | 'paragraph-stress'
  | 'paint-effects'

export type ComparisonWorkloadStats = (BitmapTextLiveStats | MtsdfTextLiveStats) & {
  readonly configurationRevision: number
  readonly workload: ComparisonWorkloadId
  readonly appliedAmount: number
  readonly appliedAnimationEnabled: boolean
  readonly appliedAnimationSpeed: number
  readonly appliedFontSize: number
  readonly appliedLayoutWidthRatio: number
  readonly appliedPaintOpacity: number
  readonly appliedPaintShadowEnabled: boolean
  readonly appliedPaintStrokeWidth: number
  readonly appliedShowLayoutBounds: boolean
  readonly reflowCount: number
  readonly lastReflowMs: number
  readonly paintRevision: number
  readonly lastPaintUpdateMs: number
}

export interface ComparisonWorkloadConfiguration {
  readonly amount: number
  readonly animationEnabled: boolean
  readonly animationSpeed: number
  readonly fontSize: number
  readonly fontFixture: BenchmarkFontFixture
  readonly layoutWidthRatio: number
  readonly paintOpacity: number
  readonly paintShadowEnabled: boolean
  readonly paintStrokeWidth: number
  readonly showLayoutBounds: boolean
  readonly workload: ComparisonWorkloadId
}

export interface ComparisonWorkloadPreview {
  resize(width: number, height: number): void
  panBy(deltaX: number, deltaY: number): void
  resetView(): void
  update(configuration: ComparisonWorkloadConfiguration): Promise<void>
  dispose(): Promise<void>
}

interface WorkloadEntry {
  readonly node: THREE.Object3D
  readonly text: Text
  readonly bounds?: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicNodeMaterial>
  readonly role: 'primary' | 'secondary'
  readonly alignment?: 'start' | 'center' | 'end'
  readonly animationPhase?: number
  lastPaintFrame?: number
  paintRevision?: number
  lastPaintUpdateMs?: number
  paintOutlineWidth?: number
  paintShadowOffset?: readonly [number, number]
  lastWidth?: number
  reflowPending?: boolean
}

interface LoadedTechniqueFont {
  readonly artifactBytes: number
  readonly atlasGpuBytes: number
  readonly atlasPages: BitmapTextLiveStats['atlasPages']
  readonly font: RegisteredFont
}

const bitmapRaster = bitmap({ strikes: [16] as const })
const LADDER_DEVICE_SIZES = [
  8, 10, 12, 14, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128, 160, 192, 256, 512,
] as const
const LADDER_SENTENCE = 'The quick brown fox jumps over the lazy dog.'
const LADDER_GAP_CSS_PX = 10
const LADDER_INSET_CSS_PX = 20
const PAINT_EFFECTS_TEXT =
  'Color begins as light, then the human eye turns wavelength into sensation. Our cones negotiate red, green, and blue while the brain invents every violet, amber, and electric cyan between them. Here each word carries its own chromatic phase, flowing through a continuous spectrum while opacity and contour remain live.'
const PAINT_WORD_RANGES = Array.from(PAINT_EFFECTS_TEXT.matchAll(/\S+/g), (match) => ({
  start: match.index,
  end: match.index + match[0].length,
}))
const DYNAMIC_LAYOUT_TEXT = [
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Left-aligned lines narrow and open while every word reshapes into its changing measure.',
  'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. This centered paragraph breathes independently while preserving its typographic rhythm.',
  'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris. Right-aligned lines reflow on their own cadence and remain anchored to the far edge.',
] as const

export async function createComparisonWorkloadPreview(options: {
  readonly amount: number
  readonly animationEnabled: boolean
  readonly animationSpeed: number
  readonly backend: RendererBackend
  readonly canvas: HTMLCanvasElement
  readonly dpr: number
  readonly fontSize: number
  readonly fontFixture: BenchmarkFontFixture
  readonly height: number
  readonly layoutWidthRatio: number
  readonly paintOpacity: number
  readonly paintShadowEnabled: boolean
  readonly paintStrokeWidth: number
  readonly showLayoutBounds: boolean
  readonly signal?: AbortSignal
  readonly technique: Exclude<RasterTechnique, 'slug'>
  readonly width: number
  readonly workload: ComparisonWorkloadId
  readonly onError: (error: unknown) => void
  readonly onStats: (stats: ComparisonWorkloadStats) => void
}): Promise<ComparisonWorkloadPreview> {
  const { backend, canvas, dpr, onError, onStats, signal, technique } = options
  signal?.throwIfAborted()
  let width = positive(options.width, 'comparison workload width')
  let height = positive(options.height, 'comparison workload height')
  let configuration = validateConfiguration(options)
  const startupStarted = performance.now()
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
  let font: LoadedTechniqueFont | undefined
  let entries: readonly WorkloadEntry[] = []
  let revision = 0
  let disposed = false
  let closing = false
  let firstDrawMs = 0
  let uploadFrameGpuMs: number | undefined
  let uploadFrameCompleteMs: number | undefined
  let textReadyMs = 0
  let gpuTimestampRequest: number | undefined
  let gpuTimestampResolution: Promise<void> | undefined
  let disposal: Promise<void> | undefined
  let reflowCount = 0
  let lastReflowMs = 0
  const scene = new THREE.Scene()
  const camera = createWorkloadCamera(configuration.workload, width, height)
  renderer.setClearColor(0x000000, 0)
  const telemetry = createLiveFrameTelemetry()
  const gpuTimingSupported = renderer.hasFeature('timestamp-query')

  try {
    const fontStarted = performance.now()
    font = await loadTechniqueFont(technique, configuration.fontFixture, signal)
    const fontLoadMs = performance.now() - fontStarted
    const activeFont = font

    async function commit(next: ComparisonWorkloadConfiguration): Promise<void> {
      const commitRevision = ++revision
      const readyStarted = performance.now()
      const nextEntries = createEntries(activeFont.font, technique, next, dpr, width, height)
      try {
        await Promise.all(nextEntries.map(({ text }) => text.ready))
        if (disposed || commitRevision !== revision) {
          disposeEntries(nextEntries)
          return
        }
        layoutEntries(nextEntries, next, width, height)
        const previous = entries
        entries = nextEntries
        scene.clear()
        for (const { node } of entries) scene.add(node)
        disposeEntries(previous)
        textReadyMs = performance.now() - readyStarted
      } catch (error) {
        disposeEntries(nextEntries)
        throw error
      }
    }

    await commit(configuration)
    signal?.throwIfAborted()
    const uploadFrameStarted = performance.now()
    renderer.setRenderTarget(null)
    renderer.clear()
    renderer.render(scene, camera)
    firstDrawMs = performance.now() - uploadFrameStarted
    if (gpuTimingSupported) {
      uploadFrameGpuMs = await renderer.resolveTimestampsAsync(THREE.TimestampQuery.RENDER)
      uploadFrameCompleteMs = performance.now() - uploadFrameStarted
    }
    const startupMs = performance.now() - startupStarted

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
        animateEntries(entries, configuration, timestamp, width, height, onError, (duration) => {
          reflowCount += 1
          lastReflowMs = duration
        })
        renderer.setRenderTarget(null)
        renderer.clear()
        renderer.render(scene, camera)
        const submitMs = performance.now() - started
        if (firstDrawMs === 0) firstDrawMs = submitMs
        const snapshot = telemetry.recordSubmit(timestamp, submitMs)
        if (snapshot === undefined) return
        scheduleGpuTimestamp()
        const layouts = entries.map(({ text }) => committedLayout(text))
        const framebufferGpuBytes = Math.round(width * dpr) * Math.round(height * dpr) * 4
        const common = {
          backend,
          dpr,
          ...snapshot,
          glyphCount: entries.reduce((total, { text }) => total + renderedGlyphCount(text), 0),
          missingGlyphCount: layouts.reduce(
            (total, layout) => total + missingGlyphCount(layout),
            0,
          ),
          drawCount: entries.reduce((total, { text }) => total + drawCount(text), 0),
          layoutWidth: layouts.reduce((maximum, layout) => Math.max(maximum, layout.width), 0),
          layoutHeight: layouts.reduce((total, layout) => total + layout.height, 0),
          lineCount: layouts.reduce((total, layout) => total + layout.lineGlyphCounts.length, 0),
          atlasGpuBytes: activeFont.atlasGpuBytes,
          framebufferGpuBytes,
          totalGpuBytes: activeFont.atlasGpuBytes + framebufferGpuBytes,
          artifactBytes: activeFont.artifactBytes,
          rendererInitMs,
          fontLoadMs,
          textReadyMs,
          firstDrawMs,
          ...(uploadFrameGpuMs === undefined ? {} : { uploadFrameGpuMs }),
          ...(uploadFrameCompleteMs === undefined ? {} : { uploadFrameCompleteMs }),
          startupMs,
          gpuTimingSupported,
          configurationRevision: revision,
          workload: configuration.workload,
          appliedAmount: configuration.amount,
          appliedAnimationEnabled: configuration.animationEnabled,
          appliedAnimationSpeed: configuration.animationSpeed,
          appliedFontSize: configuration.fontSize,
          appliedLayoutWidthRatio: configuration.layoutWidthRatio,
          appliedPaintOpacity: configuration.paintOpacity,
          appliedPaintShadowEnabled: technique === 'mtsdf' && configuration.paintShadowEnabled,
          appliedPaintStrokeWidth: technique === 'mtsdf' ? configuration.paintStrokeWidth : 0,
          appliedShowLayoutBounds: configuration.showLayoutBounds,
          reflowCount,
          lastReflowMs,
          paintRevision: entries.reduce(
            (maximum, entry) => Math.max(maximum, entry.paintRevision ?? 0),
            0,
          ),
          lastPaintUpdateMs: entries.reduce(
            (maximum, entry) => Math.max(maximum, entry.lastPaintUpdateMs ?? 0),
            0,
          ),
        }
        if (technique === 'bitmap') {
          onStats({
            technique,
            ...common,
            strikePpem: 16,
            cssFontSize: configuration.fontSize,
            renderedPpem: configuration.fontSize * dpr,
            scaleRatio: (configuration.fontSize * dpr) / 16,
            atlasPages: activeFont.atlasPages,
          })
        } else {
          onStats({ technique, ...common })
        }
      } catch (error) {
        onError(error)
      }
    }
    await renderer.setAnimationLoop(renderFrame)

    return {
      resize(nextWidth, nextHeight) {
        if (closing || disposed) return
        width = positive(nextWidth, 'comparison workload width')
        height = positive(nextHeight, 'comparison workload height')
        renderer.setSize(width, height, false)
        resizeWorkloadCamera(camera, width, height)
        void commit(configuration).catch(onError)
      },
      panBy(deltaX, deltaY) {
        if (closing || disposed || configuration.workload !== 'text-ladder') return
        scene.position.x += finite(deltaX, 'text ladder horizontal pan')
        scene.position.y -= finite(deltaY, 'text ladder vertical pan')
      },
      resetView() {
        scene.position.set(0, 0, 0)
      },
      async update(next) {
        if (closing || disposed) return
        configuration = validateConfiguration(next)
        await commit(configuration)
      },
      dispose() {
        if (disposal !== undefined) return disposal
        closing = true
        revision += 1
        if (gpuTimestampRequest !== undefined) cancelAnimationFrame(gpuTimestampRequest)
        disposal = (async () => {
          await gpuTimestampResolution
          disposed = true
          await renderer.setAnimationLoop(null)
          renderer.setRenderTarget(null)
          renderer.clear()
          disposeEntries(entries)
          entries = []
          activeFont.font.dispose()
          await renderer.dispose()
        })()
        return disposal
      },
    }
  } catch (error) {
    disposeEntries(entries)
    font?.font.dispose()
    await renderer.dispose()
    throw error
  }
}

function createEntries(
  font: RegisteredFont,
  technique: 'bitmap' | 'mtsdf',
  configuration: ComparisonWorkloadConfiguration,
  dpr: number,
  viewportWidth: number,
  viewportHeight: number,
): readonly WorkloadEntry[] {
  const raster = technique === 'bitmap' ? bitmapRaster : msdf
  const base = {
    font,
    raster,
    lineHeight: LIVE_TEXT_LINE_HEIGHT,
  }
  if (configuration.workload === 'text-ladder') {
    return ladderDeviceSizes(viewportHeight, dpr).map((deviceSize) => {
      const text = new Text({
        ...base,
        text: `${deviceSize} px  ${LADDER_SENTENCE}`,
        fontSize: deviceSize / dpr,
        color: LIVE_TEXT_COLOR,
      })
      return textEntry('primary', text)
    })
  }
  if (configuration.workload === 'paint-effects') {
    const maximumOutlineWidth = configuration.fontSize / 16
    const paintOutlineWidth =
      technique === 'mtsdf' ? maximumOutlineWidth * configuration.paintStrokeWidth : undefined
    const paintShadowOffset =
      technique === 'mtsdf' && configuration.paintShadowEnabled
        ? ([
            Math.max(1, configuration.fontSize / 12),
            Math.max(1, configuration.fontSize / 12),
          ] as const)
        : undefined
    const text = new Text({
      ...base,
      text: PAINT_EFFECTS_TEXT,
      spans: paintSpans(0, configuration.amount, paintOutlineWidth, paintShadowOffset),
      fontSize: configuration.fontSize,
      opacity: configuration.paintOpacity,
      width: Math.max(160, viewportWidth * configuration.layoutWidthRatio),
      wrap: 'word',
    })
    return [
      {
        ...textEntry('primary', text),
        ...(paintOutlineWidth === undefined ? {} : { paintOutlineWidth }),
        ...(paintShadowOffset === undefined ? {} : { paintShadowOffset }),
      },
    ]
  }
  if (configuration.workload === 'dynamic-layout') {
    const initialWidth = Math.max(160, viewportWidth * configuration.layoutWidthRatio * 0.72)
    return DYNAMIC_LAYOUT_TEXT.map((content, index) => {
      const alignment = (['start', 'center', 'end'] as const)[index]!
      const text = new Text({
        ...base,
        text: content,
        fontSize: configuration.fontSize,
        color: LIVE_TEXT_COLOR,
        width: initialWidth,
        wrap: 'word',
        textAlign: alignment,
      })
      const bounds = createLayoutBounds()
      bounds.visible = configuration.showLayoutBounds
      const node = new THREE.Group()
      node.add(bounds, text)
      return {
        ...textEntry(index === 0 ? 'primary' : 'secondary', text),
        node,
        bounds,
        alignment,
        animationPhase: index * ((Math.PI * 2) / 3),
        lastWidth: initialWidth,
      }
    })
  }
  const text =
    configuration.workload === 'paragraph-stress'
      ? Array.from({ length: Math.max(2, Math.round(configuration.amount / 10)) }, () =>
          benchmarkIpsumForFont(configuration.fontFixture),
        ).join('\n')
      : configuration.workload === 'off-axis-3d'
        ? configuration.fontFixture === 'dancing-script'
          ? 'Perspective text in motion\nleans through depth and light\nAVATAR · office · affine\nBitmap · MSDF · Slug'
          : 'Perspective text in motion\nleans through depth and light\nAVATAR · office · ∑≈∞\nBitmap · MSDF · Slug'
        : benchmarkIpsumForFont(configuration.fontFixture)
  const textObject = new Text({
    ...base,
    text,
    fontSize: configuration.fontSize,
    color: LIVE_TEXT_COLOR,
    width: Math.max(120, viewportWidth * configuration.layoutWidthRatio),
    wrap: 'word',
    ...(configuration.workload === 'off-axis-3d' ? { textAlign: 'center' as const } : {}),
  })
  if (configuration.workload === 'off-axis-3d') {
    const pivot = new THREE.Group()
    pivot.add(textObject)
    return [{ node: pivot, role: 'primary', text: textObject }]
  }
  return [textEntry('primary', textObject)]
}

function textEntry(role: WorkloadEntry['role'], text: Text): WorkloadEntry {
  return { node: text, role, text }
}

function layoutEntries(
  entries: readonly WorkloadEntry[],
  configuration: ComparisonWorkloadConfiguration,
  width: number,
  height: number,
): void {
  if (configuration.workload === 'text-ladder') {
    const layouts = entries.map(({ text }) => committedLayout(text))
    const widestLine = layouts.reduce((maximum, layout) => Math.max(maximum, layout.width), 0)
    const centeredColumnWidth = Math.min(widestLine, width * 0.94)
    const x = Math.max(LADDER_INSET_CSS_PX, (width - centeredColumnWidth) / 2)
    let y = LADDER_INSET_CSS_PX + 18
    for (const [index, { text }] of entries.entries()) {
      const layout = layouts[index]!
      text.position.set(x, -y, 0)
      y += layout.height + LADDER_GAP_CSS_PX
    }
    return
  }
  if (configuration.workload === 'paint-effects') {
    const entry = entries[0]
    if (entry === undefined) return
    const layout = committedLayout(entry.text)
    entry.text.position.set(
      Math.max(12, (width - layout.width) / 2),
      -Math.max(18, (height - layout.height) / 2),
      0,
    )
    return
  }
  if (configuration.workload === 'dynamic-layout') {
    layoutDynamicEntries(entries, width, height)
    return
  }
  const entry = entries[0]
  if (entry === undefined) return
  const layout = committedLayout(entry.text)
  entry.text.position.set(
    Math.max(12, (width - layout.width) / 2),
    -Math.max(12, (height - layout.height) / 2),
    0,
  )
  if (configuration.workload === 'off-axis-3d') {
    entry.text.position.set(-layout.width / 2, layout.height / 2, 0)
    entry.node.position.set(width / 2, -height / 2, 0)
  }
}

function animateEntries(
  entries: readonly WorkloadEntry[],
  configuration: ComparisonWorkloadConfiguration,
  timestamp: number,
  width: number,
  height: number,
  onError: (error: unknown) => void,
  onReflow: (duration: number) => void,
): void {
  if (configuration.workload === 'paint-effects') {
    animatePaint(entries, configuration, timestamp)
    return
  }
  if (configuration.workload === 'dynamic-layout') {
    animateDynamicLayout(entries, configuration, timestamp, width, height, onError, onReflow)
    return
  }
  if (configuration.workload !== 'off-axis-3d') return
  const entry = entries[0]
  if (entry === undefined) return
  const strength = 0.7 + (configuration.amount / 100) * 0.3
  const phase = timestamp * 0.00055 * animationRate(configuration)
  entry.node.rotation.set(
    (-0.12 + Math.sin(phase * 0.83) * 0.32) * strength,
    (1.05 + Math.sin(phase) * 0.33) * strength,
    Math.sin(phase * 0.47) * 0.06 * strength,
  )
  entry.node.position.z = -(130 + Math.sin(phase * 0.61) * 70) * strength
}

function animatePaint(
  entries: readonly WorkloadEntry[],
  configuration: ComparisonWorkloadConfiguration,
  timestamp: number,
): void {
  const entry = entries[0]
  if (entry === undefined || !configuration.animationEnabled) return
  const paintFrame = Math.floor(timestamp / 16)
  if (entry.lastPaintFrame === paintFrame) return
  entry.lastPaintFrame = paintFrame
  const started = performance.now()
  // Identical text and shaping-span ranges keep Text on its synchronous paint-only batch path.
  entry.text.setProperties({
    text: PAINT_EFFECTS_TEXT,
    spans: paintSpans(
      timestamp * 0.0002 * animationRate(configuration),
      configuration.amount,
      entry.paintOutlineWidth,
      entry.paintShadowOffset,
    ),
  })
  entry.paintRevision = (entry.paintRevision ?? 0) + 1
  entry.lastPaintUpdateMs = performance.now() - started
}

function animateDynamicLayout(
  entries: readonly WorkloadEntry[],
  configuration: ComparisonWorkloadConfiguration,
  timestamp: number,
  viewportWidth: number,
  viewportHeight: number,
  onError: (error: unknown) => void,
  onReflow: (duration: number) => void,
): void {
  if (!configuration.animationEnabled) return
  const phase = timestamp * 0.00045 * animationRate(configuration)
  const amplitude = 0.08 + (configuration.amount / 100) * 0.28
  const baseWidth = viewportWidth * configuration.layoutWidthRatio
  for (const entry of entries) {
    if (entry.reflowPending === true) continue
    const nextWidth = Math.max(
      160,
      baseWidth * (0.72 + Math.sin(phase + (entry.animationPhase ?? 0)) * amplitude),
    )
    if (entry.lastWidth !== undefined && Math.abs(nextWidth - entry.lastWidth) < 1) continue
    entry.reflowPending = true
    entry.lastWidth = nextWidth
    const reflowStarted = performance.now()
    entry.text.setProperties({ width: nextWidth })
    void entry.text.ready.then(
      () => {
        entry.reflowPending = false
        onReflow(performance.now() - reflowStarted)
        layoutDynamicEntries(entries, viewportWidth, viewportHeight)
      },
      (error: unknown) => {
        entry.reflowPending = false
        onError(error)
      },
    )
  }
}

function layoutDynamicEntries(
  entries: readonly WorkloadEntry[],
  viewportWidth: number,
  viewportHeight: number,
): void {
  const inset = 20
  const laneHeight = viewportHeight / Math.max(1, entries.length)
  for (const [index, entry] of entries.entries()) {
    const layout = committedLayout(entry.text)
    const x =
      entry.alignment === 'end'
        ? viewportWidth - inset - layout.width
        : entry.alignment === 'center'
          ? (viewportWidth - layout.width) / 2
          : inset
    const y = index * laneHeight + Math.max(inset, (laneHeight - layout.height) / 2)
    entry.text.position.set(x, -y, 0)
    if (entry.bounds !== undefined)
      updateLayoutBounds(entry.bounds, x, y, layout.width, layout.height)
  }
}

function createLayoutBounds(): THREE.LineSegments<
  THREE.BufferGeometry,
  THREE.LineBasicNodeMaterial
> {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(8 * 3), 3))
  const material = new THREE.LineBasicNodeMaterial({
    color: 0xb6bac3,
    depthTest: false,
    depthWrite: false,
    opacity: 0.55,
    transparent: true,
  })
  return new THREE.LineSegments(geometry, material)
}

function updateLayoutBounds(
  bounds: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicNodeMaterial>,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const positions = bounds.geometry.getAttribute('position')
  const right = x + width
  const bottom = -(y + height)
  const top = -y
  const vertices = [
    x,
    top,
    0,
    right,
    top,
    0,
    right,
    top,
    0,
    right,
    bottom,
    0,
    right,
    bottom,
    0,
    x,
    bottom,
    0,
    x,
    bottom,
    0,
    x,
    top,
    0,
  ]
  if (!(positions.array instanceof Float32Array)) {
    throw new TypeError('dynamic layout bounds require a Float32 position buffer')
  }
  positions.array.set(vertices)
  positions.needsUpdate = true
  bounds.geometry.computeBoundingSphere()
}

function paintSpans(
  phase: number,
  amount: number,
  outlineWidth?: number,
  shadowOffset?: readonly [number, number],
): readonly TextSpan[] {
  return PAINT_WORD_RANGES.map((range, index) => {
    const hue = paintWordHue(index, PAINT_WORD_RANGES.length, phase, amount)
    return {
      ...range,
      color: hslColor(hue, 0.88, 0.53),
      ...(outlineWidth === undefined || outlineWidth === 0
        ? {}
        : { outline: { color: 0xffffff, width: outlineWidth } }),
      ...(shadowOffset === undefined
        ? {}
        : { shadow: { color: hslColor(hue, 0.72, 0.16), offset: shadowOffset } }),
    }
  })
}

export function paintWordHue(
  wordIndex: number,
  wordCount: number,
  phase: number,
  amount: number,
): number {
  if (!Number.isSafeInteger(wordIndex) || wordIndex < 0 || wordIndex >= wordCount) {
    throw new RangeError('paint word index must address the word sequence')
  }
  if (!Number.isSafeInteger(wordCount) || wordCount <= 0) {
    throw new RangeError('paint word count must be a positive safe integer')
  }
  const cycles = 0.5 + (amount / 100) * 1.5
  const hue = phase + (wordIndex / wordCount) * cycles
  return ((hue % 1) + 1) % 1
}

function hslColor(hue: number, saturation: number, lightness: number): number {
  const channel = (offset: number): number => {
    const value = (offset + hue * 12) % 12
    return (
      lightness -
      saturation *
        Math.min(lightness, 1 - lightness) *
        Math.max(-1, Math.min(value - 3, 9 - value, 1))
    )
  }
  return (
    (Math.round(channel(0) * 255) << 16) |
    (Math.round(channel(8) * 255) << 8) |
    Math.round(channel(4) * 255)
  )
}

function animationRate(configuration: ComparisonWorkloadConfiguration): number {
  return 0.25 + configuration.animationSpeed * 0.0175
}

export function ladderDeviceSizes(viewportHeight: number, dpr: number): readonly number[] {
  positive(viewportHeight, 'text ladder viewport height')
  positive(dpr, 'text ladder DPR')
  return LADDER_DEVICE_SIZES
}

async function loadTechniqueFont(
  technique: 'bitmap' | 'mtsdf',
  fontFixture: BenchmarkFontFixture,
  signal?: AbortSignal,
): Promise<LoadedTechniqueFont> {
  if (technique === 'bitmap') {
    const loaded = await loadBitmapFont(signal, fontFixture)
    const atlas = await registeredBitmapAtlas(loaded.font)
    return {
      artifactBytes: loaded.artifactBytes,
      atlasGpuBytes: atlas.gpuBytes,
      atlasPages: atlas.pages,
      font: loaded.font,
    }
  }
  const loaded = await loadMtsdfFont(signal, fontFixture)
  return {
    artifactBytes: loaded.compressedBytes,
    atlasGpuBytes: loaded.atlasGpuBytes,
    atlasPages: [],
    font: loaded.font,
  }
}

function validateConfiguration(
  configuration: ComparisonWorkloadConfiguration,
): ComparisonWorkloadConfiguration {
  positive(configuration.fontSize, 'comparison workload font size')
  if (
    !Number.isFinite(configuration.layoutWidthRatio) ||
    configuration.layoutWidthRatio <= 0 ||
    configuration.layoutWidthRatio > 1
  ) {
    throw new RangeError('comparison workload layout width ratio must be in (0, 1]')
  }
  if (
    !Number.isFinite(configuration.amount) ||
    configuration.amount < 0 ||
    configuration.amount > 100
  ) {
    throw new RangeError('comparison workload amount must be in [0, 100]')
  }
  if (
    !Number.isFinite(configuration.animationSpeed) ||
    configuration.animationSpeed < 0 ||
    configuration.animationSpeed > 100
  ) {
    throw new RangeError('comparison workload animation speed must be in [0, 100]')
  }
  if (
    !Number.isFinite(configuration.paintOpacity) ||
    configuration.paintOpacity < 0 ||
    configuration.paintOpacity > 1
  ) {
    throw new RangeError('comparison workload paint opacity must be in [0, 1]')
  }
  if (
    !Number.isFinite(configuration.paintStrokeWidth) ||
    configuration.paintStrokeWidth < 0 ||
    configuration.paintStrokeWidth > 1
  ) {
    throw new RangeError('comparison workload paint stroke width must be in [0, 1]')
  }
  if (typeof configuration.showLayoutBounds !== 'boolean') {
    throw new TypeError('comparison workload layout-bounds visibility must be boolean')
  }
  if (typeof configuration.paintShadowEnabled !== 'boolean') {
    throw new TypeError('comparison workload shadow visibility must be boolean')
  }
  return configuration
}

function committedLayout(text: Text): ParagraphLayout {
  const layout = text.layout
  if (layout === undefined) throw new Error('comparison Text lost its committed layout')
  return layout
}

function disposeEntries(entries: readonly WorkloadEntry[]): void {
  for (const { bounds, text } of entries) {
    text.dispose()
    bounds?.geometry.dispose()
    bounds?.material.dispose()
  }
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

function missingGlyphCount(layout: ParagraphLayout): number {
  return layout.glyphIds.reduce((count, glyphId) => count + (glyphId === 0 ? 1 : 0), 0)
}

function positive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be positive`)
  return value
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`)
  return value
}

function createWorkloadCamera(
  workload: ComparisonWorkloadId,
  width: number,
  height: number,
): THREE.OrthographicCamera | THREE.PerspectiveCamera {
  if (workload === 'off-axis-3d') {
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 4_000)
    resizeWorkloadCamera(camera, width, height)
    return camera
  }
  const camera = new THREE.OrthographicCamera(0, width, 0, -height, 0.1, 1_000)
  camera.position.z = 500
  camera.updateProjectionMatrix()
  return camera
}

function resizeWorkloadCamera(
  camera: THREE.OrthographicCamera | THREE.PerspectiveCamera,
  width: number,
  height: number,
): void {
  if (camera instanceof THREE.PerspectiveCamera) {
    camera.aspect = width / height
    camera.position.set(
      width / 2,
      -height / 2,
      height / (2 * Math.tan(THREE.MathUtils.degToRad(22.5))),
    )
    camera.lookAt(width / 2, -height / 2, 0)
  } else {
    camera.right = width
    camera.bottom = -height
  }
  camera.updateProjectionMatrix()
}
