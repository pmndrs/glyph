import {
  FontRegistry,
  Text,
  type AnyRasterInput,
  type ParagraphLayout,
  type RegisteredFont,
  type TextSpan,
} from '@pmndrs/text'
import * as THREE from 'three/webgpu'
import { selectBitmapStrikePpem } from '@pmndrs/text/raster/bitmap'

import fontAwesomeIcons from '../../fixtures/fonts/font-awesome-free-6.7.2/icons.json'
import type { BenchmarkFontFixture, RasterConformanceSpecimen } from '../benchmark/font-fixtures'
import { benchmarkIpsumText } from '../benchmark/font-fixtures'
import type { FontDelivery, RasterTechnique } from '../benchmark/url-state'
import { loadBitmapFont, registeredBitmapAtlas, type BitmapTextLiveStats } from './bitmap-text'
import { createCanvasSurface } from './canvas-surface'
import { createLiveFrameTelemetry } from './live-frame-telemetry'
import { createTextUpdateTelemetry } from './text-update-telemetry'
import type { FontDeliveryMetrics } from './font-delivery'
import { LIVE_TEXT_COLOR, LIVE_TEXT_LINE_HEIGHT } from './live-text-style'
import {
  loadMtsdfFont,
  registeredMtsdfConfiguration,
  type MtsdfRasterConfiguration,
  type MtsdfTextLiveStats,
} from './mtsdf-text'
import type { SlugRasterConfiguration, SlugTextLiveStats } from './slug-text'
import {
  createConfiguredRenderer,
  readRendererViewportState,
  type RendererBackend,
} from './webgpu-renderer'

export type ComparisonWorkloadId =
  | 'text-ladder'
  | 'icon-grid'
  | 'off-axis-3d'
  | 'dynamic-layout'
  | 'paragraph-stress'
  | 'paint-effects'

type PaintStrokePattern = 'all' | 'alternating'

export type ComparisonWorkloadStats = (
  | BitmapTextLiveStats
  | MtsdfTextLiveStats
  | SlugTextLiveStats
) & {
  readonly configurationRevision: number
  readonly workload: ComparisonWorkloadId
  readonly appliedAmount: number
  readonly appliedAnimationEnabled: boolean
  readonly appliedAnimationSpeed: number
  readonly appliedFontSize: number
  readonly appliedLayoutWidthRatio: number
  readonly appliedPaintOpacity: number
  readonly appliedPaintShadowEnabled: boolean
  readonly appliedPaintStrokePattern: PaintStrokePattern
  readonly appliedPaintStrokeWidth: number
  readonly appliedShowLayoutBounds: boolean
  readonly reflowCount: number
  readonly lastReflowMs: number
  readonly paintRevision: number
  readonly lastPaintUpdateMs: number
  readonly sourceTextLength: number
  readonly iconItemCount: number
  readonly iconLabelCount: number
  readonly iconColumnCount: number
  readonly iconRowCount: number
  readonly iconGridWidth: number
  readonly iconGridHeight: number
  readonly iconLabelSize: number
  readonly iconPoolCapacity: number
  readonly iconAssignedCount: number
  readonly iconAssignmentSignature: string
  readonly iconFirstVisibleIndex: number
  readonly iconLastVisibleIndex: number
  readonly iconRecycleCount: number
  readonly iconWindowRevision: number
  readonly iconOverscanRows: number
  readonly iconOverscanColumns: number
  readonly iconScrollX: number
  readonly iconScrollY: number
  readonly iconMaximumScrollX: number
  readonly iconMaximumScrollY: number
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
  /** Internal benchmark fixture control; ordinary paint workloads outline every word. */
  readonly paintStrokePattern?: PaintStrokePattern
  readonly paintStrokeWidth: number
  readonly showGrid: boolean
  readonly showLayoutBounds: boolean
  readonly workload: ComparisonWorkloadId
}

export interface ComparisonWorkloadPreview {
  resize(width: number, height: number): void
  panBy(deltaX: number, deltaY: number): { readonly deltaX: number; readonly deltaY: number } | void
  resetView(): void
  zoomBy(factor: number): void
  update(configuration: ComparisonWorkloadConfiguration): Promise<void>
  dispose(): Promise<void>
}

interface WorkloadEntry {
  readonly node: THREE.Object3D
  sourceText: string
  readonly text: Text
  readonly bounds?: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicNodeMaterial>
  readonly role: 'primary' | 'secondary'
  virtualIconIndex?: number
  disposed?: boolean
  readonly alignment?: 'start' | 'center' | 'end'
  readonly animationPhase?: number
  lastPaintFrame?: number
  paintPhase?: number
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
  readonly bitmapStrikes: readonly { readonly ppem: number }[]
  readonly font: RegisteredFont
  readonly metrics: FontDeliveryMetrics
  readonly mtsdfConfiguration?: MtsdfRasterConfiguration
  readonly slugConfiguration?: SlugRasterConfiguration
  readonly raster: AnyRasterInput
}

interface PendingConfigurationUpdate {
  configuration: ComparisonWorkloadConfiguration
  viewportChanged: boolean
  readonly waiters: Array<{
    readonly resolve: () => void
    readonly reject: (reason: unknown) => void
  }>
}

const LADDER_CSS_SIZES = [
  8, 10, 12, 14, 16, 20, 24, 32, 40, 48, 64, 80, 96, 128, 160, 192, 256, 512,
] as const
const LADDER_SENTENCE = 'The quick brown fox jumps over the lazy dog.'
const LADDER_GAP_CSS_PX = 10
const LADDER_INSET_CSS_PX = 20
const ICON_GRID_LABEL_SIZE = 11
const ICON_GRID_INSET = 24
const ICON_GRID_GAP = 18
const ICON_GRID_MIN_CELL_WIDTH = 112
const ICON_GRID_ICON_PADDING = 16
const ICON_GRID_LABEL_GAP = 8
const ICON_GRID_OVERSCAN_ROWS = 3
const ICON_GRID_OVERSCAN_COLUMNS = 3
// Authenticated fa-solid-900.ttf metrics: 512 units/em and a 640-unit maximum advance.
const ICON_GRID_FONT_UNITS_PER_EM = 512
const ICON_GRID_MAX_ADVANCE = 640
const ICON_GRID_MAX_ADVANCE_EM = ICON_GRID_MAX_ADVANCE / ICON_GRID_FONT_UNITS_PER_EM
const ICON_GRID_ITEMS = fontAwesomeIcons.icons
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
  readonly delivery: FontDelivery
  readonly height: number
  readonly layoutWidthRatio: number
  readonly paintOpacity: number
  readonly paintShadowEnabled: boolean
  readonly paintStrokePattern?: PaintStrokePattern
  readonly paintStrokeWidth: number
  readonly showGrid: boolean
  readonly showLayoutBounds: boolean
  readonly signal?: AbortSignal
  readonly slugBakedArtifact?: import('./slug-text').SlugBakedArtifactSource
  /** Temporary nonshipping graph selection used by the Slug outline A/B. */
  readonly slugOutlineExperimentVariant?: import('./slug-text').SlugOutlineExperimentVariant
  readonly technique: RasterTechnique
  readonly textLadderSpecimen?: RasterConformanceSpecimen
  readonly width: number
  readonly workload: ComparisonWorkloadId
  readonly onError: (error: unknown) => void
  readonly onStats: (stats: ComparisonWorkloadStats) => void
  readonly onBakeProgress?: import('@pmndrs/text').BakeProgressListener
}): Promise<ComparisonWorkloadPreview> {
  const { backend, canvas, dpr, onError, onStats, signal, technique } = options
  signal?.throwIfAborted()
  if (options.slugBakedArtifact !== undefined && technique !== 'slug') {
    throw new TypeError('a Slug candidate artifact requires the Slug technique')
  }
  if (options.slugBakedArtifact !== undefined && options.delivery !== 'baked') {
    throw new TypeError('a retained Slug candidate artifact requires baked delivery')
  }
  if (options.slugOutlineExperimentVariant !== undefined && technique !== 'slug') {
    throw new TypeError('a Slug outline graph experiment requires the Slug technique')
  }
  let width = positive(options.width, 'comparison workload width')
  let height = positive(options.height, 'comparison workload height')
  let configuration = validateConfiguration(options)
  const startupStarted = performance.now()
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
  const canvasSurface = createCanvasSurface(renderer, width, height, configuration.showGrid)
  const rendererInitMs = performance.now() - rendererStarted
  let font: LoadedTechniqueFont | undefined
  let iconFont: LoadedTechniqueFont | undefined
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
  const animationEpoch = performance.now()
  const scene = new THREE.Scene()
  const camera = createWorkloadCamera(configuration.workload, width, height)
  const telemetry = createLiveFrameTelemetry()
  const textUpdateTelemetry = createTextUpdateTelemetry()
  const gpuTimingSupported = renderer.hasFeature('timestamp-query')

  try {
    const fontStarted = performance.now()
    const sharedRegistry =
      configuration.workload === 'icon-grid'
        ? new FontRegistry({ maxArtifactBytes: 64 * 1024 * 1024 })
        : undefined
    font = await loadTechniqueFont(
      technique,
      configuration.fontFixture,
      options.delivery,
      signal,
      options.onBakeProgress,
      options.slugBakedArtifact,
      sharedRegistry,
      options.slugOutlineExperimentVariant,
    )
    if (configuration.workload === 'icon-grid') {
      iconFont = await loadTechniqueFont(
        technique,
        'font-awesome-free-6.7.2',
        options.delivery,
        signal,
        options.onBakeProgress,
        undefined,
        sharedRegistry,
        options.slugOutlineExperimentVariant,
      )
    }
    const fontLoadMs = performance.now() - fontStarted
    const activeFont = font
    const activeIconFont = iconFont
    const loadedFonts = activeIconFont === undefined ? [activeFont] : [activeFont, activeIconFont]
    const statsFont = activeIconFont ?? activeFont
    let iconRecycleCount = 0
    let iconWindowRevision = 0
    let iconAssignmentSignature = '[]'
    let settledIconWindow: IconGridVirtualWindow | undefined
    let pendingIconWindow: IconGridVirtualWindow | undefined
    let iconWindowDrain: Promise<void> | undefined
    let iconWindowSuspended = false
    let iconWindowRefreshDeferred = false

    async function commit(next: ComparisonWorkloadConfiguration): Promise<void> {
      await iconWindowDrain
      if (next.workload === 'icon-grid') {
        clampIconGridScene(scene, next.fontSize, width, height)
      }
      const commitRevision = ++revision
      const readyStarted = performance.now()
      const nextEntries = createEntries(
        activeFont.font,
        activeFont.raster,
        technique,
        next,
        rendererViewport.pixelRatio,
        width,
        height,
        performance.now() - animationEpoch,
        options.textLadderSpecimen,
        activeIconFont,
        -scene.position.x,
        scene.position.y,
      )
      const scheduledAt = performance.now()
      try {
        await Promise.all(nextEntries.map(({ text }) => text.ready))
        const readyAt = performance.now()
        if (disposed || commitRevision !== revision) {
          disposeEntries(nextEntries)
          return
        }
        const sceneStartedAt = performance.now()
        layoutEntries(nextEntries, next, width, height)
        const previous = entries
        entries = nextEntries
        scene.clear()
        for (const { node } of entries) scene.add(node)
        disposeEntries(previous)
        const finishedAt = performance.now()
        textReadyMs = finishedAt - readyStarted
        textUpdateTelemetry.record({
          scheduleMs: scheduledAt - readyStarted,
          readyMs: readyAt - scheduledAt,
          sceneMs: finishedAt - sceneStartedAt,
          totalMs: finishedAt - readyStarted,
        })
        if (next.workload === 'icon-grid') {
          settleIconWindow(
            iconGridVirtualWindow(
              ICON_GRID_ITEMS.length,
              next.fontSize,
              width,
              height,
              -scene.position.x,
              scene.position.y,
            ),
          )
        }
      } catch (error) {
        disposeEntries(nextEntries)
        throw error
      }
    }

    async function applyIconWindow(window: IconGridVirtualWindow): Promise<void> {
      if (activeIconFont === undefined || configuration.workload !== 'icon-grid') return
      if (window.poolCapacity !== entries.length) {
        throw new Error('icon grid pool capacity changed without a scene rebuild')
      }
      let recycled = 0
      const pendingAssignments: {
        entry: WorkloadEntry
        iconIndex: number
        content: string
      }[] = []
      const desiredIndices = new Set(window.indices)
      const retainedIndices = new Set<number>()
      const availableEntries: WorkloadEntry[] = []
      for (const entry of entries) {
        if (
          entry.virtualIconIndex !== undefined &&
          desiredIndices.has(entry.virtualIconIndex) &&
          !retainedIndices.has(entry.virtualIconIndex)
        ) {
          retainedIndices.add(entry.virtualIconIndex)
          entry.node.visible = true
          continue
        }
        availableEntries.push(entry)
      }
      const missingIndices = window.indices.filter((index) => !retainedIndices.has(index))
      if (missingIndices.length > availableEntries.length) {
        throw new Error('icon grid window exceeds its recyclable tile pool')
      }
      for (const [missingIndex, iconIndex] of missingIndices.entries()) {
        const entry = availableEntries[missingIndex]!
        const { content, glyph } = iconGridContent(iconIndex)
        // A Text object retains its previous complete generation while replacement content loads,
        // but individual Text objects become ready independently. Keep every recyclable slot hidden
        // until the complete window is ready so the pool publishes one coherent assignment.
        entry.node.visible = false
        entry.text.setProperties({
          text: content,
          spans: [
            {
              start: 0,
              end: glyph.length,
              font: activeIconFont.font,
              fontSize: configuration.fontSize,
            },
          ],
        })
        recycled += 1
        pendingAssignments.push({ entry, iconIndex, content })
      }
      try {
        await Promise.all(pendingAssignments.map(({ entry }) => entry.text.ready))
      } catch (error) {
        for (const { entry } of pendingAssignments) {
          entry.node.visible = false
          delete entry.virtualIconIndex
        }
        throw error
      }
      if (closing || disposed) return
      for (const { entry, iconIndex, content } of pendingAssignments) {
        if (entry.disposed) continue
        entry.virtualIconIndex = iconIndex
        entry.sourceText = content
        const column = iconIndex % window.layout.columns
        const row = Math.floor(iconIndex / window.layout.columns)
        entry.text.position.set(
          window.layout.inset + column * (window.layout.cellWidth + window.layout.gap),
          -(window.layout.inset + row * (window.layout.cellHeight + window.layout.gap)),
          0,
        )
        entry.node.visible = true
      }
      for (const entry of availableEntries.slice(missingIndices.length)) {
        entry.node.visible = false
        delete entry.virtualIconIndex
      }
      iconRecycleCount += recycled
      settleIconWindow(window)
    }

    function settleIconWindow(window: IconGridVirtualWindow): void {
      const assignments = iconGridAssignments(entries)
      if (
        assignments.length !== window.indices.length ||
        assignments.some(({ index }, assignmentIndex) => index !== window.indices[assignmentIndex])
      ) {
        throw new Error('icon grid cannot publish a window before every assignment is coherent')
      }
      settledIconWindow = window
      iconAssignmentSignature = JSON.stringify(assignments)
      iconWindowRevision += 1
    }

    function requestIconWindowRefresh(): void {
      if (configuration.workload !== 'icon-grid' || closing || disposed) return
      if (iconWindowSuspended) {
        iconWindowRefreshDeferred = true
        return
      }
      pendingIconWindow = iconGridVirtualWindow(
        ICON_GRID_ITEMS.length,
        configuration.fontSize,
        width,
        height,
        -scene.position.x,
        scene.position.y,
      )
      if (iconWindowDrain !== undefined) return
      iconWindowDrain = (async () => {
        while (pendingIconWindow !== undefined) {
          if (closing || disposed) break
          const nextWindow = pendingIconWindow
          pendingIconWindow = undefined
          await applyIconWindow(nextWindow)
        }
      })()
        .catch(onError)
        .finally(() => {
          iconWindowDrain = undefined
          if (pendingIconWindow !== undefined && !closing && !disposed) {
            requestIconWindowRefresh()
          }
        })
    }

    await commit(configuration)
    signal?.throwIfAborted()
    let pendingUpdate: PendingConfigurationUpdate | undefined
    let updateDrain: Promise<void> | undefined

    async function applyConfiguration(
      next: ComparisonWorkloadConfiguration,
      viewportChanged: boolean,
    ): Promise<void> {
      canvasSurface.setGridVisible(next.showGrid)
      if (comparisonWorkloadUpdateKind(configuration, next, viewportChanged) === 'rebuild') {
        await commit(next)
        configuration = next
        return
      }
      configuration = next
      revision += 1
      applyRetainedConfiguration(entries, technique, configuration)
    }

    function startUpdateDrain(): void {
      if (updateDrain !== undefined) return
      updateDrain = (async () => {
        while (pendingUpdate !== undefined) {
          if (closing || disposed) break
          const current = pendingUpdate
          pendingUpdate = undefined
          try {
            await applyConfiguration(current.configuration, current.viewportChanged)
            for (const waiter of current.waiters) waiter.resolve()
          } catch (error) {
            for (const waiter of current.waiters) waiter.reject(error)
          }
        }
      })().finally(() => {
        updateDrain = undefined
        if (pendingUpdate !== undefined && !closing && !disposed) {
          startUpdateDrain()
          return
        }
        if (iconWindowSuspended) {
          iconWindowSuspended = false
          if (iconWindowRefreshDeferred) {
            iconWindowRefreshDeferred = false
            requestIconWindowRefresh()
          }
        }
      })
    }

    function enqueueUpdate(
      next: ComparisonWorkloadConfiguration,
      viewportChanged = false,
    ): Promise<void> {
      if (closing || disposed) {
        return Promise.reject(new DOMException('The comparison preview is disposed', 'AbortError'))
      }
      if (comparisonWorkloadUpdateKind(configuration, next, viewportChanged) === 'rebuild') {
        iconWindowSuspended = true
        iconWindowRefreshDeferred = true
      }
      return new Promise<void>((resolve, reject) => {
        if (pendingUpdate === undefined) {
          pendingUpdate = { configuration: next, viewportChanged, waiters: [{ resolve, reject }] }
        } else {
          pendingUpdate.configuration = next
          pendingUpdate.viewportChanged ||= viewportChanged
          pendingUpdate.waiters.push({ resolve, reject })
        }
        startUpdateDrain()
      })
    }
    const uploadFrameStarted = performance.now()
    canvasSurface.render(scene, camera)
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
      if (disposed) return
      try {
        if (!closing) {
          animateEntries(
            entries,
            configuration,
            Math.max(0, timestamp - animationEpoch),
            width,
            height,
            onError,
            (duration) => {
              reflowCount += 1
              lastReflowMs = duration
            },
          )
        }
        const started = performance.now()
        canvasSurface.render(scene, camera)
        const submitMs = performance.now() - started
        if (closing) return
        if (firstDrawMs === 0) firstDrawMs = submitMs
        const snapshot = telemetry.recordSubmit(timestamp, submitMs)
        if (snapshot === undefined) return
        scheduleGpuTimestamp()
        const activeEntries = entries.filter(({ node }) => node.visible)
        const layouts = activeEntries.map(({ text }) => committedLayout(text))
        const framebufferGpuBytes =
          rendererViewport.drawingBufferWidth * rendererViewport.drawingBufferHeight * 4
        const common = {
          backend,
          dpr: rendererViewport.pixelRatio,
          showGrid: configuration.showGrid,
          ...snapshot,
          glyphCount: activeEntries.reduce(
            (total, { text }) => total + renderedGlyphCount(text),
            0,
          ),
          missingGlyphCount: layouts.reduce(
            (total, layout) => total + missingGlyphCount(layout),
            0,
          ),
          drawCount: activeEntries.reduce((total, { text }) => total + drawCount(text), 0),
          layoutWidth: layouts.reduce((maximum, layout) => Math.max(maximum, layout.width), 0),
          layoutHeight: layouts.reduce((total, layout) => total + layout.height, 0),
          lineCount: layouts.reduce((total, layout) => total + layout.lineGlyphCounts.length, 0),
          atlasGpuBytes: sumLoadedFonts(loadedFonts, ({ atlasGpuBytes }) => atlasGpuBytes),
          framebufferGpuBytes,
          totalGpuBytes:
            sumLoadedFonts(loadedFonts, ({ atlasGpuBytes }) => atlasGpuBytes) + framebufferGpuBytes,
          artifactBytes: sumLoadedFonts(loadedFonts, ({ artifactBytes }) => artifactBytes),
          delivery: activeFont.metrics.delivery,
          sourceFontBytes: sumLoadedFonts(loadedFonts, ({ metrics }) => metrics.sourceFontBytes),
          coreArtifactBytes: sumLoadedFonts(
            loadedFonts,
            ({ metrics }) => metrics.coreArtifactBytes,
          ),
          coreBakeMs: sumLoadedFonts(loadedFonts, ({ metrics }) => metrics.coreBakeMs),
          rasterArtifactBytes: sumLoadedFonts(
            loadedFonts,
            ({ metrics }) => metrics.rasterArtifactBytes,
          ),
          rasterBakeMs: sumLoadedFonts(loadedFonts, ({ metrics }) => metrics.rasterBakeMs),
          rendererInitMs,
          fontLoadMs,
          textReadyMs,
          firstDrawMs,
          ...(uploadFrameGpuMs === undefined ? {} : { uploadFrameGpuMs }),
          ...(uploadFrameCompleteMs === undefined ? {} : { uploadFrameCompleteMs }),
          startupMs,
          gpuTimingSupported,
          textUpdateTimings: textUpdateTelemetry.summary(),
          configurationRevision: revision,
          workload: configuration.workload,
          appliedAmount: configuration.amount,
          appliedAnimationEnabled: configuration.animationEnabled,
          appliedAnimationSpeed: configuration.animationSpeed,
          appliedFontSize: configuration.fontSize,
          appliedLayoutWidthRatio: configuration.layoutWidthRatio,
          appliedPaintOpacity: configuration.paintOpacity,
          appliedPaintShadowEnabled: technique === 'mtsdf' && configuration.paintShadowEnabled,
          appliedPaintStrokePattern: paintStrokePattern(configuration),
          appliedPaintStrokeWidth: technique === 'bitmap' ? 0 : configuration.paintStrokeWidth,
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
          sourceTextLength: activeEntries.reduce(
            (total, entry) => total + entry.sourceText.length,
            0,
          ),
          ...iconGridStats(
            configuration,
            width,
            height,
            -scene.position.x,
            scene.position.y,
            entries,
            iconRecycleCount,
            iconWindowRevision,
            iconAssignmentSignature,
            settledIconWindow,
          ),
        }
        if (technique === 'bitmap') {
          const strikePpem = selectBitmapStrikePpem(
            statsFont.bitmapStrikes,
            configuration.fontSize,
            rendererViewport.pixelRatio,
          )
          onStats({
            technique,
            ...common,
            strikePpem,
            cssFontSize: configuration.fontSize,
            renderedPpem: configuration.fontSize * rendererViewport.pixelRatio,
            scaleRatio: (configuration.fontSize * rendererViewport.pixelRatio) / strikePpem,
            atlasPages: combineBitmapAtlasPages(loadedFonts),
          })
        } else if (technique === 'mtsdf') {
          const mtsdfConfiguration = statsFont.mtsdfConfiguration
          if (mtsdfConfiguration === undefined) {
            throw new Error('MTSDF workload is missing its registered raster configuration')
          }
          const renderedPpem = configuration.fontSize * rendererViewport.pixelRatio
          onStats({
            technique,
            ...common,
            rasterEmSize: mtsdfConfiguration.emSize,
            rasterPixelRange: mtsdfConfiguration.pixelRange,
            renderedPpem,
            scaleRatio: renderedPpem / mtsdfConfiguration.emSize,
          })
        } else {
          const slugConfigurations = loadedFonts.map(({ slugConfiguration }) => {
            if (slugConfiguration === undefined) {
              throw new Error('Slug workload is missing its registered raster configuration')
            }
            return slugConfiguration
          })
          const slugConfiguration = statsFont.slugConfiguration
          if (slugConfiguration === undefined) {
            throw new Error('Slug workload is missing its registered raster configuration')
          }
          const renderedPpem = configuration.fontSize * rendererViewport.pixelRatio
          onStats({
            technique,
            ...common,
            renderedPpem,
            slugPageCount: sumSlugConfigurations(slugConfigurations, ({ pageCount }) => pageCount),
            slugCurveTexelCount: sumSlugConfigurations(
              slugConfigurations,
              ({ curveTexelCount }) => curveTexelCount,
            ),
            slugCurveGpuBytes: sumSlugConfigurations(
              slugConfigurations,
              ({ curveGpuBytes }) => curveGpuBytes,
            ),
            slugHeaderCount: sumSlugConfigurations(
              slugConfigurations,
              ({ headerCount }) => headerCount,
            ),
            slugHeaderGpuBytes: sumSlugConfigurations(
              slugConfigurations,
              ({ headerGpuBytes }) => headerGpuBytes,
            ),
            slugReferenceCount: sumSlugConfigurations(
              slugConfigurations,
              ({ referenceCount }) => referenceCount,
            ),
            slugReferenceGpuBytes: sumSlugConfigurations(
              slugConfigurations,
              ({ referenceGpuBytes }) => referenceGpuBytes,
            ),
            slugGpuBytes: sumSlugConfigurations(slugConfigurations, ({ gpuBytes }) => gpuBytes),
          })
        }
      } catch (error) {
        onError(error)
      }
    }
    await renderer.setAnimationLoop(renderFrame)

    return {
      resize(nextWidth, nextHeight) {
        if (closing || disposed) return
        const validatedWidth = positive(nextWidth, 'comparison workload width')
        const validatedHeight = positive(nextHeight, 'comparison workload height')
        if (validatedWidth === width && validatedHeight === height) return
        width = validatedWidth
        height = validatedHeight
        renderer.setSize(width, height, false)
        rendererViewport = readRendererViewportState(renderer)
        canvasSurface.resize(width, height)
        resizeWorkloadCamera(camera, width, height)
        void enqueueUpdate(configuration, true).catch(onError)
      },
      panBy(deltaX, deltaY) {
        if (closing || disposed) return
        const horizontal = finite(deltaX, 'workload horizontal pan')
        const vertical = finite(deltaY, 'workload vertical pan')
        if (configuration.workload === 'icon-grid') {
          const previousX = scene.position.x
          const previousY = scene.position.y
          scene.position.x += horizontal
          scene.position.y -= vertical
          clampIconGridScene(scene, configuration.fontSize, width, height)
          requestIconWindowRefresh()
          return {
            deltaX: scene.position.x - previousX,
            deltaY: previousY - scene.position.y,
          }
        }
        scene.position.x += horizontal
        scene.position.y -= vertical
      },
      resetView() {
        scene.position.set(0, 0, 0)
        camera.zoom = 1
        camera.updateProjectionMatrix()
        requestIconWindowRefresh()
      },
      zoomBy(factor) {
        if (closing || disposed || configuration.workload !== 'off-axis-3d') return
        camera.zoom = Math.min(4, Math.max(0.25, camera.zoom * finite(factor, 'camera zoom')))
        camera.updateProjectionMatrix()
      },
      update(next) {
        return enqueueUpdate(validateConfiguration(next))
      },
      dispose() {
        if (disposal !== undefined) return disposal
        closing = true
        revision += 1
        const disposalReason = new DOMException('The comparison preview is disposed', 'AbortError')
        for (const waiter of pendingUpdate?.waiters ?? []) waiter.reject(disposalReason)
        pendingUpdate = undefined
        if (gpuTimestampRequest !== undefined) cancelAnimationFrame(gpuTimestampRequest)
        disposal = (async () => {
          await updateDrain
          await iconWindowDrain
          await gpuTimestampResolution
          disposed = true
          await renderer.setAnimationLoop(null)
          renderer.setRenderTarget(null)
          renderer.clear()
          disposeEntries(entries)
          entries = []
          for (const loadedFont of loadedFonts) loadedFont.font.dispose()
          canvasSurface.dispose()
          await renderer.dispose()
        })()
        return disposal
      },
    }
  } catch (error) {
    disposeEntries(entries)
    iconFont?.font.dispose()
    font?.font.dispose()
    canvasSurface.dispose()
    await renderer.dispose()
    throw error
  }
}

function createEntries(
  font: RegisteredFont,
  raster: AnyRasterInput,
  technique: RasterTechnique,
  configuration: ComparisonWorkloadConfiguration,
  dpr: number,
  viewportWidth: number,
  viewportHeight: number,
  animationElapsedMs: number,
  textLadderSpecimen?: RasterConformanceSpecimen,
  iconFont?: LoadedTechniqueFont,
  iconScrollX = 0,
  iconScrollY = 0,
): readonly WorkloadEntry[] {
  const base = {
    font,
    raster,
    rasterPixelRatio: dpr,
    lineHeight: LIVE_TEXT_LINE_HEIGHT,
  }
  if (configuration.workload === 'text-ladder') {
    const specimen = textLadderSpecimen ?? {
      text: LADDER_SENTENCE,
      language: 'en',
      direction: 'ltr',
    }
    return ladderCssSizes(viewportHeight).map((cssSize) => {
      const content =
        textLadderSpecimen === undefined ? `${cssSize} px  ${specimen.text}` : specimen.text
      const text = new Text({
        ...base,
        text: content,
        fontSize: cssSize,
        language: specimen.language,
        direction: specimen.direction,
        color: LIVE_TEXT_COLOR,
      })
      return textEntry('primary', text, content)
    })
  }
  if (configuration.workload === 'icon-grid') {
    if (iconFont === undefined) throw new Error('icon grid requires its icon font fixture')
    const window = iconGridVirtualWindow(
      ICON_GRID_ITEMS.length,
      configuration.fontSize,
      viewportWidth,
      viewportHeight,
      iconScrollX,
      iconScrollY,
    )
    return Array.from({ length: window.poolCapacity }, (_, poolIndex) => {
      const iconIndex = window.indices[poolIndex] ?? 0
      const { content, glyph } = iconGridContent(iconIndex)
      const text = new Text({
        ...base,
        text: content,
        spans: [
          {
            start: 0,
            end: glyph.length,
            font: iconFont.font,
            fontSize: configuration.fontSize,
          },
        ],
        fontSize: ICON_GRID_LABEL_SIZE,
        color: LIVE_TEXT_COLOR,
        width: window.layout.cellWidth,
        maxLines: 2,
        overflow: 'ellipsis',
        wrap: 'none',
        textAlign: 'center',
      })
      const entry = textEntry('primary', text, content)
      if (window.indices[poolIndex] === undefined) {
        entry.node.visible = false
      } else {
        entry.virtualIconIndex = iconIndex
      }
      return entry
    })
  }
  if (configuration.workload === 'paint-effects') {
    const maximumOutlineWidth = configuration.fontSize / (technique === 'slug' ? 20 : 16)
    const paintOutlineWidth =
      technique === 'bitmap' ? undefined : maximumOutlineWidth * configuration.paintStrokeWidth
    const paintShadowOffset =
      technique === 'mtsdf' && configuration.paintShadowEnabled
        ? ([
            Math.max(3, configuration.fontSize / 10),
            Math.max(3, configuration.fontSize / 10),
          ] as const)
        : undefined
    const text = new Text({
      ...base,
      text: PAINT_EFFECTS_TEXT,
      spans: paintSpans(
        0,
        configuration.amount,
        paintOutlineWidth,
        paintShadowOffset,
        paintStrokePattern(configuration),
      ),
      fontSize: configuration.fontSize,
      opacity: configuration.paintOpacity,
      width: Math.max(160, viewportWidth * configuration.layoutWidthRatio),
      wrap: 'word',
    })
    return [
      {
        ...textEntry('primary', text, PAINT_EFFECTS_TEXT),
        ...(paintOutlineWidth === undefined ? {} : { paintOutlineWidth }),
        ...(paintShadowOffset === undefined ? {} : { paintShadowOffset }),
      },
    ]
  }
  if (configuration.workload === 'dynamic-layout') {
    const initialWidths = dynamicLayoutWidths(configuration, viewportWidth, animationElapsedMs)
    return DYNAMIC_LAYOUT_TEXT.map((content, index) => {
      const alignment = (['start', 'center', 'end'] as const)[index]!
      const animationPhase = index * ((Math.PI * 2) / 3)
      const initialWidth = initialWidths[index]!
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
        ...textEntry(index === 0 ? 'primary' : 'secondary', text, content),
        node,
        bounds,
        alignment,
        animationPhase,
        lastWidth: initialWidth,
      }
    })
  }
  const text =
    configuration.workload === 'paragraph-stress'
      ? Array.from({ length: Math.max(2, Math.round(configuration.amount / 10)) }, () =>
          benchmarkIpsumText(),
        ).join('\n')
      : configuration.workload === 'off-axis-3d'
        ? 'Perspective text in motion\nleans through depth and light\nAVATAR · office · ∑≈∞\nBitmap · MSDF · Slug'
        : benchmarkIpsumText()
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
    return [{ node: pivot, role: 'primary', sourceText: text, text: textObject }]
  }
  return [textEntry('primary', textObject, text)]
}

function textEntry(role: WorkloadEntry['role'], text: Text, sourceText: string): WorkloadEntry {
  return { node: text, role, sourceText, text }
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
  if (configuration.workload === 'icon-grid') {
    const grid = iconGridLayout(ICON_GRID_ITEMS.length, configuration.fontSize, width)
    for (const entry of entries) {
      if (entry.virtualIconIndex === undefined) continue
      const column = entry.virtualIconIndex % grid.columns
      const row = Math.floor(entry.virtualIconIndex / grid.columns)
      entry.text.position.set(
        grid.inset + column * (grid.cellWidth + grid.gap),
        -(grid.inset + row * (grid.cellHeight + grid.gap)),
        0,
      )
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

function iconGridContent(iconIndex: number): {
  readonly content: string
  readonly glyph: string
} {
  const icon = ICON_GRID_ITEMS[iconIndex]
  if (icon === undefined) throw new RangeError(`Unknown Font Awesome icon index: ${iconIndex}`)
  const glyph = String.fromCodePoint(icon.codePoint)
  return { content: `${glyph}\n${icon.name}`, glyph }
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
  const phase = timestamp * 0.0002 * animationRate(configuration)
  entry.paintPhase = phase
  entry.text.setProperties({
    text: PAINT_EFFECTS_TEXT,
    spans: paintSpans(
      phase,
      configuration.amount,
      entry.paintOutlineWidth,
      entry.paintShadowOffset,
      paintStrokePattern(configuration),
    ),
  })
  entry.paintRevision = (entry.paintRevision ?? 0) + 1
  entry.lastPaintUpdateMs = performance.now() - started
}

function applyRetainedConfiguration(
  entries: readonly WorkloadEntry[],
  technique: RasterTechnique,
  configuration: ComparisonWorkloadConfiguration,
): void {
  for (const entry of entries) {
    if (entry.bounds !== undefined) entry.bounds.visible = configuration.showLayoutBounds
  }
  if (configuration.workload !== 'paint-effects') return
  const maximumOutlineWidth = configuration.fontSize / (technique === 'slug' ? 20 : 16)
  const paintOutlineWidth =
    technique === 'bitmap' ? undefined : maximumOutlineWidth * configuration.paintStrokeWidth
  const paintShadowOffset =
    technique === 'mtsdf' && configuration.paintShadowEnabled
      ? ([
          Math.max(3, configuration.fontSize / 10),
          Math.max(3, configuration.fontSize / 10),
        ] as const)
      : undefined
  for (const entry of entries) {
    if (paintOutlineWidth === undefined) delete entry.paintOutlineWidth
    else entry.paintOutlineWidth = paintOutlineWidth
    if (paintShadowOffset === undefined) delete entry.paintShadowOffset
    else entry.paintShadowOffset = paintShadowOffset
    entry.text.setProperties({
      opacity: configuration.paintOpacity,
      text: PAINT_EFFECTS_TEXT,
      spans: paintSpans(
        entry.paintPhase ?? 0,
        configuration.amount,
        paintOutlineWidth,
        paintShadowOffset,
        paintStrokePattern(configuration),
      ),
    })
  }
}

export function comparisonWorkloadUpdateKind(
  previous: ComparisonWorkloadConfiguration,
  next: ComparisonWorkloadConfiguration,
  viewportChanged = false,
): 'rebuild' | 'retained' {
  const paragraphVolumeChanged =
    next.workload === 'paragraph-stress' && previous.amount !== next.amount
  return viewportChanged ||
    previous.fontSize !== next.fontSize ||
    previous.layoutWidthRatio !== next.layoutWidthRatio ||
    paragraphVolumeChanged
    ? 'rebuild'
    : 'retained'
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
  if (
    !configuration.animationEnabled ||
    entries.some(({ reflowPending }) => reflowPending === true)
  )
    return
  const nextWidths = dynamicLayoutWidths(configuration, viewportWidth, timestamp)
  if (
    entries.every(
      (entry, index) =>
        entry.lastWidth !== undefined && Math.abs(nextWidths[index]! - entry.lastWidth) < 1,
    )
  ) {
    return
  }
  const reflowStarted = performance.now()
  for (const [index, entry] of entries.entries()) {
    entry.reflowPending = true
    entry.lastWidth = nextWidths[index]!
    entry.text.setProperties({ width: nextWidths[index]! })
  }
  void Promise.all(entries.map(({ text }) => text.ready)).then(
    () => {
      if (entries.some(({ disposed }) => disposed === true)) return
      for (const entry of entries) entry.reflowPending = false
      layoutDynamicEntries(entries, viewportWidth, viewportHeight)
      onReflow(performance.now() - reflowStarted)
    },
    (error: unknown) => {
      if (entries.some(({ disposed }) => disposed === true)) return
      for (const entry of entries) entry.reflowPending = false
      onError(error)
    },
  )
}

export function dynamicLayoutWidths(
  configuration: Pick<
    ComparisonWorkloadConfiguration,
    'amount' | 'animationSpeed' | 'layoutWidthRatio'
  >,
  viewportWidth: number,
  animationElapsedMs: number,
): readonly number[] {
  const phase = animationElapsedMs * 0.00045 * animationRate(configuration)
  const amplitude = 0.08 + (configuration.amount / 100) * 0.28
  const baseWidth = viewportWidth * configuration.layoutWidthRatio
  return DYNAMIC_LAYOUT_TEXT.map((_, index) =>
    Math.max(160, baseWidth * (0.72 + Math.sin(phase + index * ((Math.PI * 2) / 3)) * amplitude)),
  )
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
  strokePattern: PaintStrokePattern = 'all',
): readonly TextSpan[] {
  return PAINT_WORD_RANGES.map((range, index) => {
    const hue = paintWordHue(index, PAINT_WORD_RANGES.length, phase, amount)
    return {
      ...range,
      color: hslColor(hue, 0.88, 0.53),
      ...(outlineWidth === undefined || outlineWidth === 0 || !wordHasOutline(index, strokePattern)
        ? {}
        : { outline: { color: 0xffffff, width: outlineWidth } }),
      ...(shadowOffset === undefined
        ? {}
        : { shadow: { color: hslColor(hue, 0.68, 0.28), offset: shadowOffset } }),
    }
  })
}

function wordHasOutline(wordIndex: number, pattern: PaintStrokePattern): boolean {
  return pattern === 'all' || wordIndex % 2 === 0
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

function animationRate(
  configuration: Pick<ComparisonWorkloadConfiguration, 'animationSpeed'>,
): number {
  return 0.25 + configuration.animationSpeed * 0.0175
}

export function ladderCssSizes(viewportHeight: number): readonly number[] {
  positive(viewportHeight, 'text ladder viewport height')
  return LADDER_CSS_SIZES
}

export interface IconGridLayout {
  readonly columns: number
  readonly rows: number
  readonly cellWidth: number
  readonly cellHeight: number
  readonly gap: number
  readonly inset: number
  readonly width: number
  readonly height: number
}

export interface IconGridVirtualWindow {
  readonly layout: IconGridLayout
  readonly indices: readonly number[]
  readonly poolCapacity: number
  readonly firstVisibleIndex: number
  readonly lastVisibleIndex: number
  readonly scrollX: number
  readonly scrollY: number
  readonly maximumScrollX: number
  readonly maximumScrollY: number
}

export interface IconGridAssignment {
  readonly index: number
  readonly content: string
}

export function iconGridAssignmentSignature(
  entries: readonly {
    readonly node: { readonly visible: boolean }
    readonly sourceText: string
    readonly virtualIconIndex?: number
  }[],
): string {
  return JSON.stringify(iconGridAssignments(entries))
}

function iconGridAssignments(
  entries: readonly {
    readonly node: { readonly visible: boolean }
    readonly sourceText: string
    readonly virtualIconIndex?: number
  }[],
): readonly IconGridAssignment[] {
  const assignments = entries
    .filter(
      (entry): entry is typeof entry & { readonly virtualIconIndex: number } =>
        entry.node.visible && entry.virtualIconIndex !== undefined,
    )
    .map(({ sourceText, virtualIconIndex }) => ({ index: virtualIconIndex, content: sourceText }))
    .sort((left, right) => left.index - right.index)
  for (let index = 1; index < assignments.length; index += 1) {
    if (assignments[index - 1]!.index === assignments[index]!.index) {
      throw new Error(`icon grid assigned catalog index ${String(assignments[index]!.index)} twice`)
    }
  }
  return assignments
}

export function iconGridLayout(
  itemCount: number,
  iconSize: number,
  viewportWidth: number,
): IconGridLayout {
  if (!Number.isSafeInteger(itemCount) || itemCount <= 0) {
    throw new RangeError('icon grid item count must be a positive safe integer')
  }
  positive(iconSize, 'icon grid icon size')
  positive(viewportWidth, 'icon grid viewport width')
  const cellWidth = Math.max(
    ICON_GRID_MIN_CELL_WIDTH,
    iconSize * ICON_GRID_MAX_ADVANCE_EM + ICON_GRID_ICON_PADDING * 2,
  )
  const cellHeight = (iconSize + ICON_GRID_LABEL_SIZE) * LIVE_TEXT_LINE_HEIGHT + ICON_GRID_LABEL_GAP
  const columns = Math.ceil(Math.sqrt(itemCount))
  const rows = Math.ceil(itemCount / columns)
  return {
    columns,
    rows,
    cellWidth,
    cellHeight,
    gap: ICON_GRID_GAP,
    inset: ICON_GRID_INSET,
    width: ICON_GRID_INSET * 2 + columns * cellWidth + Math.max(0, columns - 1) * ICON_GRID_GAP,
    height: ICON_GRID_INSET * 2 + rows * cellHeight + Math.max(0, rows - 1) * ICON_GRID_GAP,
  }
}

export function iconGridVirtualWindow(
  itemCount: number,
  iconSize: number,
  viewportWidth: number,
  viewportHeight: number,
  requestedScrollX: number,
  requestedScrollY: number,
): IconGridVirtualWindow {
  positive(viewportHeight, 'icon grid viewport height')
  if (!Number.isFinite(requestedScrollX) || !Number.isFinite(requestedScrollY)) {
    throw new TypeError('icon grid scroll positions must be finite')
  }
  const layout = iconGridLayout(itemCount, iconSize, viewportWidth)
  const maximumScrollX = Math.max(0, layout.width - viewportWidth)
  const maximumScrollY = Math.max(0, layout.height - viewportHeight)
  const scrollX = Math.min(maximumScrollX, Math.max(0, requestedScrollX))
  const scrollY = Math.min(maximumScrollY, Math.max(0, requestedScrollY))
  const pitchX = layout.cellWidth + layout.gap
  const pitchY = layout.cellHeight + layout.gap
  const [firstVisibleColumn, lastVisibleColumn] = intersectingGridRange(
    scrollX,
    scrollX + viewportWidth,
    layout.inset,
    layout.cellWidth,
    pitchX,
    layout.columns,
  )
  const [firstVisibleRow, lastVisibleRow] = intersectingGridRange(
    scrollY,
    scrollY + viewportHeight,
    layout.inset,
    layout.cellHeight,
    pitchY,
    layout.rows,
  )
  const visibleColumnCapacity = Math.ceil(viewportWidth / pitchX) + 1
  const poolColumns = Math.min(
    layout.columns,
    visibleColumnCapacity + ICON_GRID_OVERSCAN_COLUMNS * 2,
  )
  const poolStartColumn = Math.min(
    Math.max(0, layout.columns - poolColumns),
    Math.max(0, firstVisibleColumn - ICON_GRID_OVERSCAN_COLUMNS),
  )
  const visibleRowCapacity = Math.ceil(viewportHeight / pitchY) + 1
  const poolRows = Math.min(layout.rows, visibleRowCapacity + ICON_GRID_OVERSCAN_ROWS * 2)
  const poolStartRow = Math.min(
    Math.max(0, layout.rows - poolRows),
    Math.max(0, firstVisibleRow - ICON_GRID_OVERSCAN_ROWS),
  )
  const poolEndRow = poolStartRow + poolRows
  const indices: number[] = []
  for (let row = poolStartRow; row < poolEndRow; row += 1) {
    for (let column = poolStartColumn; column < poolStartColumn + poolColumns; column += 1) {
      const index = row * layout.columns + column
      if (index < itemCount) indices.push(index)
    }
  }
  const visibleIndices: number[] = []
  for (let row = firstVisibleRow; row <= lastVisibleRow; row += 1) {
    for (let column = firstVisibleColumn; column <= lastVisibleColumn; column += 1) {
      const index = row * layout.columns + column
      if (index < itemCount) visibleIndices.push(index)
    }
  }
  return {
    layout,
    indices,
    poolCapacity: poolRows * poolColumns,
    firstVisibleIndex: visibleIndices.at(0) ?? -1,
    lastVisibleIndex: visibleIndices.at(-1) ?? -1,
    scrollX,
    scrollY,
    maximumScrollX,
    maximumScrollY,
  }
}

function intersectingGridRange(
  minimum: number,
  maximum: number,
  origin: number,
  cellSize: number,
  pitch: number,
  count: number,
): readonly [number, number] {
  const first = Math.floor((minimum - origin - cellSize) / pitch) + 1
  const last = Math.ceil((maximum - origin) / pitch) - 1
  return [Math.min(count - 1, Math.max(0, first)), Math.min(count - 1, Math.max(0, last))]
}

function clampIconGridScene(
  scene: THREE.Scene,
  iconSize: number,
  viewportWidth: number,
  viewportHeight: number,
): void {
  const layout = iconGridLayout(ICON_GRID_ITEMS.length, iconSize, viewportWidth)
  const maximumScrollX = Math.max(0, layout.width - viewportWidth)
  const maximumScrollY = Math.max(0, layout.height - viewportHeight)
  scene.position.x = Math.min(0, Math.max(-maximumScrollX, scene.position.x))
  scene.position.y = Math.min(maximumScrollY, Math.max(0, scene.position.y))
}

function iconGridStats(
  configuration: Pick<ComparisonWorkloadConfiguration, 'fontSize' | 'workload'>,
  viewportWidth: number,
  viewportHeight: number,
  scrollX: number,
  scrollY: number,
  entries: readonly WorkloadEntry[],
  recycleCount: number,
  windowRevision: number,
  assignmentSignature: string,
  settledWindow: IconGridVirtualWindow | undefined,
): Pick<
  ComparisonWorkloadStats,
  | 'iconItemCount'
  | 'iconLabelCount'
  | 'iconColumnCount'
  | 'iconRowCount'
  | 'iconGridWidth'
  | 'iconGridHeight'
  | 'iconLabelSize'
  | 'iconPoolCapacity'
  | 'iconAssignedCount'
  | 'iconAssignmentSignature'
  | 'iconFirstVisibleIndex'
  | 'iconLastVisibleIndex'
  | 'iconRecycleCount'
  | 'iconWindowRevision'
  | 'iconOverscanRows'
  | 'iconOverscanColumns'
  | 'iconScrollX'
  | 'iconScrollY'
  | 'iconMaximumScrollX'
  | 'iconMaximumScrollY'
> {
  if (configuration.workload !== 'icon-grid') {
    return {
      iconItemCount: 0,
      iconLabelCount: 0,
      iconColumnCount: 0,
      iconRowCount: 0,
      iconGridWidth: 0,
      iconGridHeight: 0,
      iconLabelSize: 0,
      iconPoolCapacity: 0,
      iconAssignedCount: 0,
      iconAssignmentSignature: '[]',
      iconFirstVisibleIndex: -1,
      iconLastVisibleIndex: -1,
      iconRecycleCount: 0,
      iconWindowRevision: 0,
      iconOverscanRows: 0,
      iconOverscanColumns: 0,
      iconScrollX: 0,
      iconScrollY: 0,
      iconMaximumScrollX: 0,
      iconMaximumScrollY: 0,
    }
  }
  const window =
    settledWindow ??
    iconGridVirtualWindow(
      ICON_GRID_ITEMS.length,
      configuration.fontSize,
      viewportWidth,
      viewportHeight,
      scrollX,
      scrollY,
    )
  return {
    iconItemCount: ICON_GRID_ITEMS.length,
    iconLabelCount: ICON_GRID_ITEMS.length,
    iconColumnCount: window.layout.columns,
    iconRowCount: window.layout.rows,
    iconGridWidth: window.layout.width,
    iconGridHeight: window.layout.height,
    iconLabelSize: ICON_GRID_LABEL_SIZE,
    iconPoolCapacity: entries.length,
    iconAssignedCount: entries.filter(({ node }) => node.visible).length,
    iconAssignmentSignature: assignmentSignature,
    iconFirstVisibleIndex: window.firstVisibleIndex,
    iconLastVisibleIndex: window.lastVisibleIndex,
    iconRecycleCount: recycleCount,
    iconWindowRevision: windowRevision,
    iconOverscanRows: ICON_GRID_OVERSCAN_ROWS,
    iconOverscanColumns: ICON_GRID_OVERSCAN_COLUMNS,
    iconScrollX: window.scrollX,
    iconScrollY: window.scrollY,
    iconMaximumScrollX: window.maximumScrollX,
    iconMaximumScrollY: window.maximumScrollY,
  }
}

function sumLoadedFonts(
  fonts: readonly LoadedTechniqueFont[],
  select: (font: LoadedTechniqueFont) => number,
): number {
  return fonts.reduce((total, loadedFont) => total + select(loadedFont), 0)
}

function combineBitmapAtlasPages(
  fonts: readonly LoadedTechniqueFont[],
): BitmapTextLiveStats['atlasPages'] {
  const pagesPerStrike = new Map<number, number>()
  return fonts.flatMap(({ atlasPages }) =>
    atlasPages.map((page) => {
      const pageOffset = pagesPerStrike.get(page.strikePpem) ?? 0
      pagesPerStrike.set(page.strikePpem, pageOffset + 1)
      return { ...page, pageIndex: pageOffset }
    }),
  )
}

function sumSlugConfigurations(
  configurations: readonly SlugRasterConfiguration[],
  select: (configuration: SlugRasterConfiguration) => number,
): number {
  return configurations.reduce((total, slugConfiguration) => total + select(slugConfiguration), 0)
}

async function loadTechniqueFont(
  technique: RasterTechnique,
  fontFixture: BenchmarkFontFixture,
  delivery: FontDelivery,
  signal?: AbortSignal,
  onBakeProgress?: import('@pmndrs/text').BakeProgressListener,
  slugBakedArtifact?: import('./slug-text').SlugBakedArtifactSource,
  registry?: FontRegistry,
  slugOutlineExperimentVariant: import('./slug-text').SlugOutlineExperimentVariant = 'multiply-zero',
): Promise<LoadedTechniqueFont> {
  if (technique === 'bitmap') {
    const loaded = await loadBitmapFont(
      signal,
      fontFixture,
      delivery,
      'live',
      onBakeProgress,
      registry,
    )
    const atlas = await registeredBitmapAtlas(loaded.font, 'live')
    return {
      artifactBytes: loaded.artifactBytes,
      atlasGpuBytes: atlas.gpuBytes,
      atlasPages: atlas.pages,
      bitmapStrikes: atlas.strikes,
      font: loaded.font,
      metrics: loaded.metrics,
      raster: loaded.raster,
    }
  }
  if (technique === 'mtsdf') {
    const loaded = await loadMtsdfFont(signal, fontFixture, delivery, onBakeProgress, registry)
    const mtsdfConfiguration = await registeredMtsdfConfiguration(loaded.font, signal)
    return {
      artifactBytes: loaded.compressedBytes,
      atlasGpuBytes: loaded.atlasGpuBytes,
      atlasPages: [],
      bitmapStrikes: [],
      font: loaded.font,
      metrics: loaded.metrics,
      mtsdfConfiguration,
      raster: loaded.raster,
    }
  }
  const { loadSlugBakedArtifact, loadSlugFont, registeredSlugConfiguration } =
    await import('./slug-text')
  const loaded =
    slugBakedArtifact === undefined
      ? await loadSlugFont(
          signal,
          fontFixture,
          delivery,
          onBakeProgress,
          registry,
          slugOutlineExperimentVariant,
        )
      : await loadSlugBakedArtifact(
          slugBakedArtifact,
          signal,
          registry,
          slugOutlineExperimentVariant,
        )
  const slugConfiguration = await registeredSlugConfiguration(loaded.font, signal)
  return {
    artifactBytes: loaded.compressedBytes,
    atlasGpuBytes: slugConfiguration.gpuBytes,
    atlasPages: [],
    bitmapStrikes: [],
    font: loaded.font,
    metrics: loaded.metrics,
    slugConfiguration,
    raster: loaded.raster,
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
  if (
    configuration.paintStrokePattern !== undefined &&
    configuration.paintStrokePattern !== 'all' &&
    configuration.paintStrokePattern !== 'alternating'
  ) {
    throw new TypeError('comparison workload paint stroke pattern must be all or alternating')
  }
  if (typeof configuration.showLayoutBounds !== 'boolean') {
    throw new TypeError('comparison workload layout-bounds visibility must be boolean')
  }
  if (typeof configuration.showGrid !== 'boolean') {
    throw new TypeError('comparison workload canvas-grid visibility must be boolean')
  }
  if (typeof configuration.paintShadowEnabled !== 'boolean') {
    throw new TypeError('comparison workload shadow visibility must be boolean')
  }
  return configuration
}

function paintStrokePattern(configuration: ComparisonWorkloadConfiguration): PaintStrokePattern {
  return configuration.paintStrokePattern ?? 'all'
}

function committedLayout(text: Text): ParagraphLayout {
  const layout = text.layout
  if (layout === undefined) throw new Error('comparison Text lost its committed layout')
  return layout
}

function disposeEntries(entries: readonly WorkloadEntry[]): void {
  for (const entry of entries) {
    entry.disposed = true
    entry.text.dispose()
    entry.bounds?.geometry.dispose()
    entry.bounds?.material.dispose()
  }
}

function renderedGlyphCount(object: THREE.Object3D): number {
  let count = 0
  const geometries = new Set<THREE.InstancedBufferGeometry>()
  object.traverse((child) => {
    if (
      child instanceof THREE.Mesh &&
      child.geometry instanceof THREE.InstancedBufferGeometry &&
      !geometries.has(child.geometry)
    ) {
      geometries.add(child.geometry)
      count += child.geometry.instanceCount
    }
  })
  return count
}

function drawCount(object: THREE.Object3D): number {
  let count = 0
  object.traverseVisible((child) => {
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
