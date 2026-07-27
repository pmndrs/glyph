import {
  Activity,
  Suspense,
  use,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from 'react'

import { BENCHMARK_IPSUM_INTER_GLYPH_COUNT } from './benchmark/benchmark-ipsum'
import {
  ADVANCED_SHAPING_CASES,
  advanceAdvancedShaping,
  advancedShapingFrame,
  initialAdvancedShapingState,
  updateAdvancedShaping,
  type AdvancedShapingCommand,
  type AdvancedShapingFrame,
  type AdvancedShapingState,
} from './benchmark/advanced-shaping'
import type { BenchmarkSummary, RunnerEvent } from './benchmark/contracts'
import { environmentResource } from './benchmark/environment'
import { runRegisteredBenchmark } from './benchmark/execution'
import { captureLiveTextStats, type LiveBenchmarkCapture } from './benchmark/product-result'
import {
  BENCHMARK_FONT_LABELS,
  SELECTABLE_FONT_FIXTURES,
  benchmarkIpsumText,
  selectableFontFixture,
  type BenchmarkFontFixture,
  type SelectableFontFixture,
} from './benchmark/font-fixtures'
import {
  readHarnessLocation,
  writeHarnessLocation,
  type GraphicsBackend,
  type HarnessLocation,
  type HarnessMode,
  type RasterTechnique,
} from './benchmark/url-state'
import { ExportPanel } from './components/export-panel'
import { Report } from './components/report'
import { Button, Chip, Field, Metric, SelectField, TextareaField, Toggle } from './components/ui'
import packageSizes from './generated/package-sizes.json'
import bitmapFixtures from '../fixtures/rendering/showcase-raster-fixtures-v0.json'
import mtsdfFixtures from '../fixtures/rendering/showcase-mtsdf-fixtures-v0.json'
import type {
  BitmapTextConformanceCapture,
  BitmapTextLiveStats,
  BitmapTextPreview,
  BitmapTextPreviewSnapshot,
  BitmapTextPreviewUpdate,
} from './renderer/bitmap-text'
import type {
  MtsdfTextConformanceCapture,
  MtsdfTextLiveStats,
  MtsdfTextPreview,
} from './renderer/mtsdf-text'
import type {
  ComparisonWorkloadId,
  ComparisonWorkloadPreview,
  ComparisonWorkloadStats,
} from './renderer/comparison-workload'
import type { LiveFrameHistoryCursor } from './renderer/live-frame-telemetry'
import type { SourceOutlineFidelityCapture } from './renderer/source-outline-reference'

type LiveTextStats = BitmapTextLiveStats | MtsdfTextLiveStats

interface WorkloadOption {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly techniques: Readonly<Record<RasterTechnique, WorkloadTechniqueStatus>>
}

type WorkloadTechniqueStatus =
  | { readonly kind: 'ready' }
  | { readonly kind: 'planned'; readonly milestone: 8 | 9 }

const READY: WorkloadTechniqueStatus = { kind: 'ready' }
const PLANNED_M9: WorkloadTechniqueStatus = { kind: 'planned', milestone: 9 }

interface LiveTextConfiguration extends Omit<BitmapTextPreviewUpdate, 'fontSize'> {
  readonly animatePresentation: boolean
  readonly fontFixture: BenchmarkFontFixture
  readonly expectedGlyphCount: number | undefined
  readonly timelineTick: number | undefined
}

interface PresentationEvidence {
  readonly revision: number
  readonly progress: 0 | 1
  readonly matchedGlyphs: number
  readonly targetGlyphs: number
}

interface ConformanceView {
  readonly zoom: number
  readonly panXPercent: number
  readonly panYPercent: number
}

interface ActivityWorkloads {
  readonly benchmark: string
  readonly conformance: string
}

const INITIAL_CONFORMANCE_VIEW: ConformanceView = {
  zoom: 1,
  panXPercent: 0,
  panYPercent: 0,
}

const EMPTY_FONT_FEATURES: BitmapTextPreviewUpdate['features'] = []
const GLYPH_POSITION_TRANSITION_MS = 110
const TYPEWRITER_INTERVAL_MS = 65
function mtsdfFixtureFor(fontFixture: BenchmarkFontFixture) {
  const fixture = mtsdfFixtures.artifacts.find((candidate) => candidate.fontFixture === fontFixture)
  if (fixture === undefined) {
    throw new Error(`MTSDF fixture manifest is missing ${fontFixture}`)
  }
  return fixture
}

function bitmapFixtureFor(fontFixture: BenchmarkFontFixture) {
  const fixture = bitmapFixtures.artifacts.find(
    (candidate) => candidate.fontFixture === fontFixture,
  )
  if (fixture === undefined) {
    throw new Error(`bitmap fixture manifest is missing ${fontFixture}`)
  }
  return fixture
}

const benchmarkWorkloads: readonly WorkloadOption[] = [
  {
    id: 'benchmark-ipsum',
    label: 'Benchmark ipsum',
    description: 'Tests the everyday cost of rendering and reflowing a full paragraph.',
    techniques: { bitmap: READY, mtsdf: READY, slug: PLANNED_M9 },
  },
  {
    id: 'advanced-shaping',
    label: 'Advanced shaping',
    description: 'Tests whether complex text stays correct as it types and wraps.',
    techniques: { bitmap: READY, mtsdf: READY, slug: PLANNED_M9 },
  },
  {
    id: 'text-ladder',
    label: 'Text ladder',
    description: 'Tests how text quality holds up from 8 to 512 pixels.',
    techniques: { bitmap: READY, mtsdf: READY, slug: PLANNED_M9 },
  },
  {
    id: 'off-axis-3d',
    label: 'Off-axis / 3D',
    description: 'Tests text quality and cost at steep, moving viewing angles.',
    techniques: { bitmap: READY, mtsdf: READY, slug: PLANNED_M9 },
  },
  {
    id: 'dynamic-layout',
    label: 'Dynamic layout',
    description: 'Tests whether animated containers reflow text smoothly and correctly.',
    techniques: { bitmap: READY, mtsdf: READY, slug: PLANNED_M9 },
  },
  {
    id: 'paragraph-stress',
    label: 'Paragraph stress',
    description: 'Tests rendering cost as paragraphs, glyphs, and atlas pressure grow.',
    techniques: { bitmap: READY, mtsdf: READY, slug: PLANNED_M9 },
  },
  {
    id: 'paint-effects',
    label: 'Paint & effects',
    description: 'Tests the live cost and visual quality of animated text effects.',
    techniques: { bitmap: READY, mtsdf: READY, slug: PLANNED_M9 },
  },
]

const conformanceWorkloads: readonly WorkloadOption[] = [
  {
    id: 'text-accuracy',
    label: 'Pipeline accuracy',
    description:
      'Technique-specific renderer output, sampling reference, difference, and error statistics.',
    techniques: { bitmap: READY, mtsdf: READY, slug: PLANNED_M9 },
  },
  {
    id: 'cross-technique-fidelity',
    label: 'Cross-technique fidelity',
    description:
      'Bitmap and MSDF compared independently with the same outline-derived coverage reference.',
    techniques: { bitmap: READY, mtsdf: READY, slug: PLANNED_M9 },
  },
]

function comparisonWorkloadId(workload: string): ComparisonWorkloadId | undefined {
  switch (workload) {
    case 'text-ladder':
    case 'off-axis-3d':
    case 'dynamic-layout':
    case 'paragraph-stress':
    case 'paint-effects':
      return workload
    default:
      return undefined
  }
}

function workloadAmountLabel(workload: string, amount: number): string | undefined {
  switch (workload) {
    case 'off-axis-3d':
      return `Perspective intensity · ${amount}%`
    case 'dynamic-layout':
      return `Reflow amplitude · ${amount}%`
    case 'paragraph-stress':
      return `Text volume · ${amount}%`
    case 'paint-effects':
      return `Hue spread · ${amount}%`
    default:
      return undefined
  }
}

function workloadHasLayoutWidth(workload: string): boolean {
  switch (workload) {
    case 'benchmark-ipsum':
    case 'dynamic-layout':
    case 'paragraph-stress':
      return true
    default:
      return false
  }
}

function defaultFontSizeForWorkload(workload: string): number {
  switch (workload) {
    case 'off-axis-3d':
      return 64
    case 'paint-effects':
      return 40
    case 'dynamic-layout':
      return 24
    default:
      return 16
  }
}

function liveWorkloadControlDescription(workload: string, technique: RasterTechnique): string {
  switch (workload) {
    case 'advanced-shaping':
      return technique === 'bitmap'
        ? 'Bitmap text looks best at its baked 16 px strike; scaling exposes the need for additional strikes.'
        : 'MSDF text uses one 64 px/em atlas to stay crisp across the rendered-size range.'
    case 'text-ladder':
      return 'Use the ladder to compare crispness and artifacts from 8 to 512 pixels.'
    case 'off-axis-3d':
      return 'Increase perspective to inspect text at steeper viewing angles.'
    case 'dynamic-layout':
      return 'Adjust reflow to stress three independently resizing paragraphs.'
    case 'paragraph-stress':
      return 'Increase text volume to inspect layout, draw, memory, CPU, and GPU cost.'
    case 'paint-effects':
      return 'Adjust color, opacity, stroke, and shadow while watching their live rendering cost.'
    default:
      return 'Change the paragraph width to inspect live reflow quality and cost.'
  }
}

function liveWorkloadSceneDescription(
  workload: string,
  showcaseFrame: AdvancedShapingFrame,
): string {
  switch (workload) {
    case 'advanced-shaping':
      return `Tests whether ${showcaseFrame.caseDefinition.label.toLowerCase()} stay correct while the paragraph types and wraps.`
    case 'text-ladder':
      return 'Tests one sentence at every size from 8 through 512 pixels.'
    case 'off-axis-3d':
      return 'Tests readability and frame cost as a paragraph leans deep into the scene.'
    case 'dynamic-layout':
      return 'Tests whether three animated paragraphs reflow without stretching their glyphs.'
    case 'paragraph-stress':
      return 'Tests glyph, line, draw, memory, CPU, and GPU cost under paragraph pressure.'
    case 'paint-effects':
      return 'Tests the live cost and quality of animated color, opacity, stroke, and shadow.'
    default:
      return 'Tests paragraph rendering cost while the viewport reflows the text.'
  }
}

function formatMs(value: number | undefined): string {
  return value === undefined ? '—' : `${value.toFixed(2)} ms`
}

function formatBytes(value: number | undefined): string {
  if (value === undefined) return '—'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(2)} MB`
}

function ShellFallback() {
  return (
    <div className="grid min-h-screen place-items-center bg-background text-sm text-muted">
      Loading harness…
    </div>
  )
}

export function App() {
  if (new URLSearchParams(locationSearch()).has('runner')) {
    return (
      <div
        className="grid min-h-screen place-items-center bg-background font-mono text-[10px] text-dim"
        data-testid="runner-host"
      >
        INTERNAL RUNNER HOST
      </div>
    )
  }
  return (
    <Suspense fallback={<ShellFallback />}>
      <Harness />
    </Suspense>
  )
}

function Harness() {
  const environment = use(environmentResource())
  const desktop = useSyncExternalStore(subscribeDesktop, desktopSnapshot, () => true)
  const [location, setLocationState] = useState(() => {
    const value = readHarnessLocation(locationSearch())
    if (!environment.webgpu && !new URLSearchParams(locationSearch()).has('backend')) {
      return { ...value, backend: 'webgl2' as const }
    }
    return value
  })
  const [activityWorkloads, setActivityWorkloads] = useState<ActivityWorkloads>(() => {
    const initial = readHarnessLocation(locationSearch())
    return {
      benchmark: initial.mode === 'benchmark' ? initial.workload : 'benchmark-ipsum',
      conformance: initial.mode === 'conformance' ? initial.workload : 'text-accuracy',
    }
  })
  const [summary, setSummary] = useState<BenchmarkSummary>()
  const [event, setEvent] = useState<RunnerEvent>()
  const [liveStats, setLiveStats] = useState<LiveTextStats>()
  const [liveCapture, setLiveCapture] = useState<LiveBenchmarkCapture>()
  const [error, setError] = useState<string>()
  const [dpr, setDpr] = useState<1 | 2>(defaultDeviceDpr)
  const [samples, setSamples] = useState(3)
  const [warmup, setWarmup] = useState(1)
  const [showGrid, setShowGrid] = useState(true)
  const [showLayoutBounds, setShowLayoutBounds] = useState(true)
  const [fontSize, setFontSize] = useState(() => defaultFontSizeForWorkload(location.workload))
  const [layoutWidthPercent, setLayoutWidthPercent] = useState(82)
  const [workloadAmount, setWorkloadAmount] = useState(50)
  const [animationEnabled, setAnimationEnabled] = useState(true)
  const [animationSpeed, setAnimationSpeed] = useState(50)
  const [paintOpacityPercent, setPaintOpacityPercent] = useState(100)
  const [paintShadowEnabled, setPaintShadowEnabled] = useState(true)
  const [paintStrokePercent, setPaintStrokePercent] = useState(50)
  const [conformanceView, setConformanceView] = useState(INITIAL_CONFORMANCE_VIEW)
  const [showcaseState, setShowcaseState] = useState(initialAdvancedShapingState)
  const [isPending, startTransition] = useTransition()

  const workload = workloadById(location.mode, location.workload)
  const fontFixture = location.fontFixture
  const workloadTechnique = workload.techniques[location.technique]
  const showcaseFrame = advancedShapingFrame(showcaseState)
  const activeFontFixture: BenchmarkFontFixture =
    location.workload === 'advanced-shaping'
      ? showcaseFrame.caseDefinition.fontFixture
      : fontFixture
  const available = location.technique !== 'slug' && workloadTechnique.kind === 'ready'
  const backendAvailable = location.backend !== 'webgpu' || environment.webgpu

  function setLocation(next: Partial<HarnessLocation>): void {
    const value = { ...location, ...next }
    if (next.workload !== undefined) {
      setActivityWorkloads((current) => ({ ...current, [value.mode]: value.workload }))
    }
    if (next.workload !== undefined && next.workload !== location.workload) {
      setFontSize(defaultFontSizeForWorkload(next.workload))
    }
    const replacesLiveSurface =
      next.mode !== undefined ||
      next.technique !== undefined ||
      next.backend !== undefined ||
      next.workload !== undefined
    if (replacesLiveSurface) setLiveStats(undefined)
    if (replacesLiveSurface || next.fontFixture !== undefined) {
      setSummary(undefined)
      setLiveCapture(undefined)
    }
    setLocationState(value)
    globalThis.history?.replaceState(null, '', writeHarnessLocation(value))
  }

  function selectMode(mode: HarnessMode): void {
    setLocation({
      mode,
      workload: activityWorkloads[mode],
      view: 'scene',
    })
  }

  function selectTechnique(technique: RasterTechnique): void {
    const currentWorkload = workloadById(location.mode, location.workload)
    const selectedWorkload =
      currentWorkload.techniques[technique].kind === 'ready'
        ? currentWorkload.id
        : location.mode === 'benchmark'
          ? 'benchmark-ipsum'
          : 'text-accuracy'
    setLocation({
      technique,
      workload: selectedWorkload,
    })
  }

  function runConformance(): void {
    setError(undefined)
    startTransition(async () => {
      try {
        const value = await runRegisteredBenchmark({
          targetId:
            location.workload === 'cross-technique-fidelity'
              ? `source-outline-${location.technique}-${location.backend}`
              : location.technique === 'mtsdf'
                ? `mtsdf-conformance-${location.backend}`
                : `bitmap-text-${location.backend}`,
          scenarioId:
            location.workload === 'cross-technique-fidelity'
              ? 'source-outline-fidelity'
              : location.technique === 'mtsdf'
                ? 'mtsdf-sampling-conformance'
                : 'bitmap-text-frame',
          input: { fontFixture: activeFontFixture },
          controls: { dpr, samples, warmup },
          environment,
          onEvent: setEvent,
        })
        setSummary(value)
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught))
      }
    })
  }

  function captureWindow(): void {
    if (liveStats === undefined) return
    setLiveCapture({
      kind: 'live-benchmark',
      schemaVersion: 0,
      capturedAt: new Date().toISOString(),
      technique: location.technique,
      backend: location.backend,
      workload: location.workload,
      dpr,
      fontFixture: activeFontFixture,
      environment,
      stats: captureLiveTextStats(liveStats),
    })
  }

  function invalidateLiveCapture(): void {
    setLiveCapture(undefined)
  }

  function dispatchShowcase(command: AdvancedShapingCommand): void {
    setShowcaseState((state) => updateAdvancedShaping(state, command))
    invalidateLiveCapture()
  }

  const advanceShowcase = useEffectEvent(() => {
    setShowcaseState((state) => advanceAdvancedShaping(state))
  })
  useEffect(() => {
    if (
      location.mode !== 'benchmark' ||
      !showcaseState.playing ||
      showcaseState.editedText !== undefined
    )
      return
    let animationFrame = 0
    let lastTickAt = performance.now()
    const animate = (timestamp: number): void => {
      if (timestamp - lastTickAt >= TYPEWRITER_INTERVAL_MS) {
        advanceShowcase()
        lastTickAt = timestamp
      }
      animationFrame = requestAnimationFrame(animate)
    }
    animationFrame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(animationFrame)
  }, [location.mode, showcaseState.editedText, showcaseState.playing])

  const controls = (
    <Controls
      backend={location.backend}
      dpr={dpr}
      conformanceView={conformanceView}
      fontFixture={activeFontFixture}
      liveStats={liveStats}
      mode={location.mode}
      technique={location.technique}
      workload={location.workload}
      showcaseFrame={showcaseFrame}
      showcaseState={showcaseState}
      fontSize={fontSize}
      layoutWidthPercent={layoutWidthPercent}
      workloadAmount={workloadAmount}
      animationEnabled={animationEnabled}
      animationSpeed={animationSpeed}
      paintOpacityPercent={paintOpacityPercent}
      paintShadowEnabled={paintShadowEnabled}
      paintStrokePercent={paintStrokePercent}
      selectedFontFixture={fontFixture}
      samples={samples}
      showGrid={showGrid}
      showLayoutBounds={showLayoutBounds}
      warmup={warmup}
      webgpu={environment.webgpu}
      onBackend={(backend) => setLocation({ backend })}
      onDpr={(value) => {
        setDpr(value)
        setLiveStats(undefined)
        setSummary(undefined)
        setLiveCapture(undefined)
      }}
      onConformanceReset={() => setConformanceView(INITIAL_CONFORMANCE_VIEW)}
      onConformanceZoom={(zoom) => setConformanceView((view) => ({ ...view, zoom }))}
      onFontSize={(value) => {
        setFontSize(value)
        invalidateLiveCapture()
      }}
      onLayoutWidthPercent={(value) => {
        setLayoutWidthPercent(value)
        invalidateLiveCapture()
      }}
      onWorkloadAmount={(value) => {
        setWorkloadAmount(value)
        invalidateLiveCapture()
      }}
      onAnimationEnabled={(value) => {
        setAnimationEnabled(value)
        invalidateLiveCapture()
      }}
      onAnimationSpeed={(value) => {
        setAnimationSpeed(value)
        invalidateLiveCapture()
      }}
      onPaintOpacityPercent={(value) => {
        setPaintOpacityPercent(value)
        invalidateLiveCapture()
      }}
      onPaintShadowEnabled={(value) => {
        setPaintShadowEnabled(value)
        invalidateLiveCapture()
      }}
      onPaintStrokePercent={(value) => {
        setPaintStrokePercent(value)
        invalidateLiveCapture()
      }}
      onSelectedFontFixture={(value) => {
        setLocation({ fontFixture: value })
      }}
      onSamples={setSamples}
      onShowcase={dispatchShowcase}
      onShowGrid={setShowGrid}
      onShowLayoutBounds={(value) => {
        setShowLayoutBounds(value)
        invalidateLiveCapture()
      }}
      onWarmup={setWarmup}
    />
  )

  const actionReady =
    available && backendAvailable && !isPending && (location.mode === 'conformance' || liveStats)

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopBar
        mode={location.mode}
        pending={isPending}
        ready={Boolean(actionReady)}
        webgpu={environment.webgpu}
        onAction={location.mode === 'benchmark' ? captureWindow : runConformance}
        onMode={selectMode}
      />
      {desktop ? (
        <div className="grid h-[calc(100vh-52px)] min-h-[680px] grid-cols-[224px_minmax(640px,1fr)_288px]">
          <WorkloadRail
            fontFixture={fontFixture}
            location={location}
            showcaseFrame={showcaseFrame}
            onFontFixture={(value) => {
              setLocation({ fontFixture: value })
            }}
            onLocation={setLocation}
            onTechnique={selectTechnique}
          />
          <main className="min-w-0 overflow-auto border-r border-border bg-background p-4">
            <Scene
              fontFixture={fontFixture}
              dpr={dpr}
              conformanceView={conformanceView}
              error={error}
              event={event}
              grid={showGrid}
              liveCapture={liveCapture}
              liveStats={liveStats}
              location={location}
              activityWorkloads={activityWorkloads}
              fontSize={fontSize}
              layoutWidthPercent={layoutWidthPercent}
              workloadAmount={workloadAmount}
              animationEnabled={animationEnabled}
              animationSpeed={animationSpeed}
              paintOpacityPercent={paintOpacityPercent}
              paintShadowEnabled={paintShadowEnabled}
              paintStrokePercent={paintStrokePercent}
              showLayoutBounds={showLayoutBounds}
              summary={summary}
              showcaseFrame={showcaseFrame}
              onConformancePan={(deltaXPercent, deltaYPercent) =>
                setConformanceView((view) => ({
                  ...view,
                  panXPercent: view.panXPercent + deltaXPercent,
                  panYPercent: view.panYPercent + deltaYPercent,
                }))
              }
              onConformanceZoom={(zoom) => setConformanceView((view) => ({ ...view, zoom }))}
              onLiveStats={setLiveStats}
            />
          </main>
          <aside className="overflow-auto bg-chrome p-4">{controls}</aside>
        </div>
      ) : (
        <div className="pb-[58px]">
          <main className="min-h-[calc(100vh-110px)] p-3">
            <div className={location.view === 'scene' ? undefined : 'hidden'}>
              <Scene
                fontFixture={fontFixture}
                dpr={dpr}
                conformanceView={conformanceView}
                error={error}
                event={event}
                grid={showGrid}
                liveCapture={liveCapture}
                liveStats={liveStats}
                location={location}
                activityWorkloads={activityWorkloads}
                fontSize={fontSize}
                layoutWidthPercent={layoutWidthPercent}
                workloadAmount={workloadAmount}
                animationEnabled={animationEnabled}
                animationSpeed={animationSpeed}
                paintOpacityPercent={paintOpacityPercent}
                paintShadowEnabled={paintShadowEnabled}
                paintStrokePercent={paintStrokePercent}
                showLayoutBounds={showLayoutBounds}
                summary={summary}
                showcaseFrame={showcaseFrame}
                onConformancePan={(deltaXPercent, deltaYPercent) =>
                  setConformanceView((view) => ({
                    ...view,
                    panXPercent: view.panXPercent + deltaXPercent,
                    panYPercent: view.panYPercent + deltaYPercent,
                  }))
                }
                onConformanceZoom={(zoom) => setConformanceView((view) => ({ ...view, zoom }))}
                onLiveStats={setLiveStats}
              />
            </div>
            {location.view === 'controls' && (
              <MobileSheet title="Controls" onClose={() => setLocation({ view: 'scene' })}>
                {controls}
              </MobileSheet>
            )}
            {location.view === 'report' && <Report liveCapture={liveCapture} summary={summary} />}
            {location.view === 'export' && (
              <ExportPanel liveCapture={liveCapture} summary={summary} />
            )}
          </main>
          <MobileNavigation location={location} onLocation={setLocation} />
        </div>
      )}
    </div>
  )
}

function locationSearch(): string {
  return typeof globalThis.location === 'undefined' ? '' : globalThis.location.search
}

function subscribeDesktop(listener: () => void): () => void {
  if (typeof globalThis.matchMedia !== 'function') return () => undefined
  const media = globalThis.matchMedia('(min-width: 1200px)')
  media.addEventListener('change', listener)
  return () => media.removeEventListener('change', listener)
}

function desktopSnapshot(): boolean {
  return (
    typeof globalThis.matchMedia !== 'function' ||
    globalThis.matchMedia('(min-width: 1200px)').matches
  )
}

function defaultDeviceDpr(): 1 | 2 {
  return (globalThis.devicePixelRatio ?? 1) >= 1.5 ? 2 : 1
}

function workloadsFor(mode: HarnessMode): readonly WorkloadOption[] {
  if (mode === 'benchmark') return benchmarkWorkloads
  return conformanceWorkloads
}

function workloadById(mode: HarnessMode, id: string): WorkloadOption {
  const workloads = workloadsFor(mode)
  return workloads.find((workload) => workload.id === id) ?? workloads[0]!
}

function workloadRailDescription(workload: WorkloadOption, technique: RasterTechnique): string {
  const status = workload.techniques[technique]
  return status.kind === 'ready'
    ? workload.description
    : `M${status.milestone} · ${workload.description}`
}

function TopBar({
  mode,
  pending,
  ready,
  webgpu,
  onAction,
  onMode,
}: {
  readonly mode: HarnessMode
  readonly pending: boolean
  readonly ready: boolean
  readonly webgpu: boolean
  readonly onAction: () => void
  readonly onMode: (mode: HarnessMode) => void
}) {
  return (
    <header className="flex h-[52px] items-center gap-2 border-b border-border bg-chrome px-2 sm:gap-3 sm:px-3 lg:px-4">
      <div className="grid size-7 place-items-center rounded-md bg-accent font-serif text-lg">
        a
      </div>
      <div className="hidden min-w-0 sm:block">
        <div className="text-sm font-semibold leading-none">pmndrs/text</div>
        <div className="mt-1 font-mono text-[9px] text-dim">TEXT PERFORMANCE LAB</div>
      </div>
      <div className="flex rounded-md border border-border bg-background p-0.5 sm:ml-3">
        {(['benchmark', 'conformance'] as const).map((value) => (
          <button
            className={`min-h-7 rounded px-2 py-1.5 text-[10px] capitalize sm:px-3 sm:text-[11px] ${mode === value ? 'bg-surface-active text-foreground' : 'text-muted hover:bg-surface'}`}
            key={value}
            type="button"
            onClick={() => onMode(value)}
          >
            {value}
          </button>
        ))}
      </div>
      <div className="flex-1" />
      <span className="hidden sm:inline-flex">
        <Chip tone={webgpu ? 'success' : 'warning'}>
          {webgpu ? 'WebGPU available' : 'WebGPU unavailable'}
        </Chip>
      </span>
      <Button
        aria-label={mode === 'benchmark' ? 'Capture window' : 'Run conformance'}
        className="px-2 text-[10px] sm:px-3 sm:text-xs"
        disabled={!ready}
        variant="primary"
        onClick={onAction}
      >
        {pending ? (
          'Running…'
        ) : mode === 'benchmark' ? (
          <>
            <span className="sm:hidden">Capture</span>
            <span className="hidden sm:inline">Capture window</span>
          </>
        ) : (
          <>
            <span className="sm:hidden">Run</span>
            <span className="hidden sm:inline">Run conformance</span>
          </>
        )}
      </Button>
    </header>
  )
}

function WorkloadRail({
  fontFixture,
  location,
  showcaseFrame,
  onFontFixture,
  onLocation,
  onTechnique,
}: {
  readonly fontFixture: SelectableFontFixture
  readonly location: HarnessLocation
  readonly showcaseFrame: AdvancedShapingFrame
  readonly onFontFixture: (fontFixture: SelectableFontFixture) => void
  readonly onLocation: (value: Partial<HarnessLocation>) => void
  readonly onTechnique: (technique: RasterTechnique) => void
}) {
  const workloads = workloadsFor(location.mode)
  const activeFontFixture: BenchmarkFontFixture =
    location.workload === 'advanced-shaping'
      ? showcaseFrame.caseDefinition.fontFixture
      : fontFixture
  const selectedMtsdfFixture =
    location.technique === 'mtsdf' ? mtsdfFixtureFor(activeFontFixture) : undefined
  const rasterDescription =
    selectedMtsdfFixture === undefined
      ? '16 px grayscale bitmap strike'
      : `${selectedMtsdfFixture.configuration.emSize} px/em MTSDF · ${selectedMtsdfFixture.configuration.pixelRange} px range · ${selectedMtsdfFixture.raster.pages.length} pages`
  return (
    <aside className="overflow-auto border-r border-border bg-chrome p-3">
      <p className="eyebrow">Technique</p>
      <div className="mt-2 grid grid-cols-3 gap-1">
        {(['bitmap', 'mtsdf', 'slug'] as const).map((technique) => (
          <button
            className={`rounded-md border px-2 py-2 text-[10px] capitalize ${location.technique === technique ? 'border-accent bg-surface-active text-foreground' : 'border-transparent bg-transparent text-foreground hover:border-border hover:bg-surface'} disabled:cursor-not-allowed disabled:text-dim`}
            disabled={technique === 'slug'}
            key={technique}
            type="button"
            onClick={() => onTechnique(technique)}
          >
            {technique === 'mtsdf' ? 'MSDF' : technique}
          </button>
        ))}
      </div>
      <p className="eyebrow mb-2 mt-5">
        {location.mode === 'benchmark' ? 'Live workloads' : 'Conformance checks'}
      </p>
      <nav className="grid gap-1">
        {workloads.map((workload) => (
          <button
            className={`relative rounded-md px-4 py-3 text-left ${location.workload === workload.id ? 'bg-surface-active text-foreground' : 'text-foreground hover:bg-surface'} disabled:cursor-not-allowed disabled:opacity-40`}
            disabled={workload.techniques[location.technique].kind !== 'ready'}
            key={workload.id}
            type="button"
            onClick={() => onLocation({ workload: workload.id })}
          >
            <span
              className={`absolute left-1.5 top-3 h-4 w-[3px] rounded-full ${location.workload === workload.id ? 'bg-accent' : 'bg-transparent'}`}
            />
            <span className="block text-xs">{workload.label}</span>
            <span className="mt-1 block font-mono text-[8px] leading-relaxed text-muted">
              {workloadRailDescription(workload, location.technique)}
            </span>
          </button>
        ))}
      </nav>
      <div className="mt-5">
        <p className="eyebrow mb-2">Font fixture</p>
        {location.workload === 'advanced-shaping' ? (
          <div className="rounded-md border border-border bg-surface p-3">
            <p className="text-xs">{BENCHMARK_FONT_LABELS[activeFontFixture]}</p>
            <p className="mt-1 font-mono text-[9px] text-dim">Selected by shaping case</p>
          </div>
        ) : (
          <div className="grid gap-1">
            {SELECTABLE_FONT_FIXTURES.map((fixture) => (
              <button
                className={`rounded-md border px-3 py-2 text-left ${fontFixture === fixture.id ? 'border-accent bg-surface-active text-foreground' : 'border-border bg-surface text-muted'}`}
                key={fixture.id}
                type="button"
                onClick={() => onFontFixture(fixture.id)}
              >
                <span className="block text-xs">{fixture.label}</span>
                <span className="mt-1 block font-mono text-[8px] text-dim">{fixture.metadata}</span>
              </button>
            ))}
          </div>
        )}
        <p className="mt-2 font-mono text-[9px] text-dim">{rasterDescription}</p>
      </div>
    </aside>
  )
}

function Scene({
  activityWorkloads,
  animationEnabled,
  animationSpeed,
  conformanceView,
  dpr,
  error,
  event,
  fontFixture,
  fontSize,
  grid,
  layoutWidthPercent,
  paintOpacityPercent,
  paintShadowEnabled,
  paintStrokePercent,
  showLayoutBounds,
  workloadAmount,
  liveCapture,
  liveStats,
  location,
  showcaseFrame,
  summary,
  onConformancePan,
  onConformanceZoom,
  onLiveStats,
}: {
  readonly activityWorkloads: ActivityWorkloads
  readonly animationEnabled: boolean
  readonly animationSpeed: number
  readonly conformanceView: ConformanceView
  readonly dpr: 1 | 2
  readonly error: string | undefined
  readonly event: RunnerEvent | undefined
  readonly fontFixture: SelectableFontFixture
  readonly fontSize: number
  readonly grid: boolean
  readonly layoutWidthPercent: number
  readonly paintOpacityPercent: number
  readonly paintShadowEnabled: boolean
  readonly paintStrokePercent: number
  readonly showLayoutBounds: boolean
  readonly workloadAmount: number
  readonly liveCapture: LiveBenchmarkCapture | undefined
  readonly liveStats: LiveTextStats | undefined
  readonly location: HarnessLocation
  readonly showcaseFrame: AdvancedShapingFrame
  readonly summary: BenchmarkSummary | undefined
  readonly onConformancePan: (deltaXPercent: number, deltaYPercent: number) => void
  readonly onConformanceZoom: (zoom: number) => void
  readonly onLiveStats: (stats: LiveTextStats) => void
}) {
  const workload = workloadById(location.mode, location.workload)
  const benchmarkWorkload = workloadById('benchmark', activityWorkloads.benchmark)
  const benchmarkStatus = benchmarkWorkload.techniques[location.technique]
  const conformanceWorkload = workloadById('conformance', activityWorkloads.conformance)
  const conformanceStatus = conformanceWorkload.techniques[location.technique]
  return (
    <section
      className="grid min-h-full min-w-0 grid-rows-[auto_minmax(520px,1fr)_auto] gap-3"
      data-captured-at={liveCapture?.capturedAt}
      data-execution-id={summary?.executionId}
      data-testid="scene"
    >
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <p className="eyebrow">
            {location.mode === 'benchmark' ? 'Live benchmark' : 'Correctness inspection'}
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{workload.label}</h1>
          <p className="mt-1 max-w-3xl text-xs text-muted">{workload.description}</p>
        </div>
        <div className="flex flex-wrap gap-1.5 sm:justify-end sm:gap-2">
          <Chip tone="accent">{location.technique === 'mtsdf' ? 'MSDF' : 'Bitmap'}</Chip>
          <Chip>{location.backend === 'webgpu' ? 'WebGPU' : 'WebGL2 fallback'}</Chip>
          <Chip>{dpr}× DPR</Chip>
        </div>
      </header>
      <Activity name="benchmark" mode={location.mode === 'benchmark' ? 'visible' : 'hidden'}>
        <div className="contents" data-activity="benchmark">
          {benchmarkStatus.kind === 'planned' ? (
            <PlannedWorkloadSurface
              milestone={benchmarkStatus.milestone}
              technique={location.technique}
              workload={benchmarkWorkload}
            />
          ) : (
            <BenchmarkSurface
              animationEnabled={animationEnabled}
              animationSpeed={animationSpeed}
              backend={location.backend}
              dpr={dpr}
              fontSize={fontSize}
              fontFixture={fontFixture}
              grid={grid}
              layoutWidthPercent={layoutWidthPercent}
              paintOpacityPercent={paintOpacityPercent}
              paintShadowEnabled={paintShadowEnabled}
              paintStrokePercent={paintStrokePercent}
              showLayoutBounds={showLayoutBounds}
              workloadAmount={workloadAmount}
              key={`${location.backend}-${String(dpr)}-${benchmarkWorkload.id}`}
              showcaseFrame={showcaseFrame}
              stats={liveStats}
              technique={location.technique}
              workload={benchmarkWorkload.id}
              onStats={onLiveStats}
            />
          )}
        </div>
      </Activity>
      <Activity name="conformance" mode={location.mode === 'conformance' ? 'visible' : 'hidden'}>
        <div className="contents" data-activity="conformance">
          {conformanceStatus.kind === 'planned' ? (
            <PlannedWorkloadSurface
              milestone={conformanceStatus.milestone}
              technique={location.technique}
              workload={conformanceWorkload}
            />
          ) : (
            <ConformanceSurface
              backend={location.backend}
              conformanceView={conformanceView}
              dpr={dpr}
              event={event}
              fontFixture={fontFixture}
              key={`${location.backend}-${String(dpr)}-${fontFixture}-${conformanceWorkload.id}`}
              summary={summary}
              technique={location.technique}
              workload={conformanceWorkload.id}
              onPan={onConformancePan}
              onZoom={onConformanceZoom}
            />
          )}
        </div>
      </Activity>
      {error !== undefined && (
        <div className="rounded-md border border-danger/50 bg-danger/10 p-3 text-xs text-danger">
          {error}
        </div>
      )}
      {location.mode === 'benchmark' && liveCapture !== undefined && (
        <div className="rounded-md border border-success/40 bg-success/5 px-3 py-2 text-xs text-muted">
          Captured the current rolling window at {liveCapture.capturedAt} ·{' '}
          {liveCapture.stats.framesPerSecond.toFixed(1)} FPS ·{' '}
          {formatMs(liveCapture.stats.medianSubmitMs)} CPU submit
        </div>
      )}
    </section>
  )
}

function PlannedWorkloadSurface({
  milestone,
  technique,
  workload,
}: {
  readonly milestone: 8 | 9
  readonly technique: RasterTechnique
  readonly workload: WorkloadOption
}) {
  return (
    <div className="grid min-h-[520px] place-items-center rounded-md border border-border bg-panel p-8 text-center">
      <div className="max-w-md">
        <p className="eyebrow">Milestone {milestone}</p>
        <h2 className="mt-2 text-lg font-semibold">
          {technique === 'mtsdf' ? 'MSDF' : technique} · {workload.label}
        </h2>
        <p className="mt-2 text-xs leading-relaxed text-muted">{workload.description}</p>
      </div>
    </div>
  )
}

function BenchmarkSurface({
  animationEnabled,
  animationSpeed,
  backend,
  dpr,
  fontFixture,
  fontSize,
  grid,
  layoutWidthPercent,
  paintOpacityPercent,
  paintShadowEnabled,
  paintStrokePercent,
  showLayoutBounds,
  workloadAmount,
  showcaseFrame,
  stats,
  technique,
  workload,
  onStats,
}: {
  readonly animationEnabled: boolean
  readonly animationSpeed: number
  readonly backend: GraphicsBackend
  readonly dpr: 1 | 2
  readonly fontFixture: SelectableFontFixture
  readonly fontSize: number
  readonly grid: boolean
  readonly layoutWidthPercent: number
  readonly paintOpacityPercent: number
  readonly paintShadowEnabled: boolean
  readonly paintStrokePercent: number
  readonly showLayoutBounds: boolean
  readonly workloadAmount: number
  readonly showcaseFrame: AdvancedShapingFrame
  readonly stats: LiveTextStats | undefined
  readonly technique: RasterTechnique
  readonly workload: string
  readonly onStats: (stats: LiveTextStats) => void
}) {
  const advanced = workload === 'advanced-shaping'
  const comparisonWorkload = comparisonWorkloadId(workload)
  const textConfiguration: LiveTextConfiguration = advanced
    ? {
        anchor: 'measure-center',
        direction: showcaseFrame.caseDefinition.direction,
        expectedGlyphCount: undefined,
        animatePresentation: false,
        features: showcaseFrame.caseDefinition.features,
        fontFixture: showcaseFrame.caseDefinition.fontFixture,
        language: showcaseFrame.caseDefinition.language,
        layoutWidthRatio: showcaseFrame.widthPermille / 1000,
        text: showcaseFrame.text,
        textAlign: 'start',
        timelineTick: showcaseFrame.tick,
      }
    : {
        anchor: 'center',
        direction: 'ltr',
        expectedGlyphCount: fontFixture === 'inter' ? BENCHMARK_IPSUM_INTER_GLYPH_COUNT : undefined,
        animatePresentation: false,
        features: EMPTY_FONT_FEATURES,
        fontFixture,
        language: 'en',
        layoutWidthRatio: layoutWidthPercent / 100,
        text: benchmarkIpsumText(),
        textAlign: 'start',
        timelineTick: undefined,
      }
  return (
    <div
      className="grid min-h-0 grid-rows-[auto_auto_minmax(360px,1fr)] gap-3"
      data-testid="benchmark-surface"
    >
      <div className="metric-summary-grid grid grid-cols-2 overflow-hidden rounded-md border border-border bg-surface md:grid-cols-5">
        <Metric
          label="Live FPS"
          value={stats === undefined ? '—' : stats.framesPerSecond.toFixed(1)}
        />
        <Metric label="CPU frame submit" value={formatMs(stats?.medianSubmitMs)} />
        <Metric
          label="GPU frame"
          value={
            stats?.medianGpuMs === undefined
              ? stats?.gpuTimingSupported === true
                ? 'resolving'
                : 'unavailable'
              : formatMs(stats.medianGpuMs)
          }
        />
        <Metric
          label="Glyphs / draws"
          value={stats === undefined ? '—' : `${stats.glyphCount} / ${stats.drawCount}`}
        />
        <Metric
          label="Missing glyphs"
          value={stats === undefined ? '—' : String(stats.missingGlyphCount)}
        />
      </div>
      <div className="grid gap-3 min-[1400px]:grid-cols-[minmax(0,1fr)_minmax(260px,0.7fr)]">
        <div className="grid grid-cols-2 overflow-hidden rounded-md border border-border bg-surface sm:grid-cols-3">
          <LiveCost label="Renderer init" value={formatMs(stats?.rendererInitMs)} />
          <LiveCost label="Font fetch + register" value={formatMs(stats?.fontLoadMs)} />
          <LiveCost label="Text ready" value={formatMs(stats?.textReadyMs)} />
          <LiveCost label="First draw submit" value={formatMs(stats?.firstDrawMs)} />
          <LiveCost label="Upload frame complete" value={formatMs(stats?.uploadFrameCompleteMs)} />
          <LiveCost label="First GPU frame" value={formatMs(stats?.uploadFrameGpuMs)} />
          <LiveCost label="Total startup" value={formatMs(stats?.startupMs)} />
          <LiveCost
            label="Artifact / GPU"
            value={`${formatBytes(stats?.artifactBytes)} / ${formatBytes(stats?.totalGpuBytes)}`}
          />
        </div>
        <div className="grid grid-cols-3 gap-px overflow-hidden rounded-md border border-border bg-border min-[1400px]:grid-cols-1">
          <Sparkline
            id="fps"
            label="FPS"
            length={stats?.fpsHistoryLength ?? 0}
            maximum={stats?.maximumFramesPerSecond}
            minimum={stats?.minimumFramesPerSecond}
            cursor={stats?.fpsHistoryCursor}
            tone="success"
            unit="fps"
            values={stats?.fpsHistory}
          />
          <Sparkline
            id="cpu"
            label="CPU frame ms"
            length={stats?.submitHistoryLength ?? 0}
            maximum={stats?.maximumSubmitMs}
            minimum={stats?.minimumSubmitMs}
            cursor={stats?.submitHistoryCursor}
            tone="cyan"
            unit="ms"
            values={stats?.submitHistory}
          />
          <Sparkline
            emptyLabel={
              stats?.gpuTimingSupported === true ? 'Resolving GPU timing' : 'GPU timing unavailable'
            }
            label="GPU frame ms"
            id="gpu"
            length={stats?.gpuHistoryLength ?? 0}
            maximum={stats?.maximumGpuMs}
            minimum={stats?.minimumGpuMs}
            cursor={stats?.gpuHistoryCursor}
            tone="warning"
            unit="ms"
            values={stats?.gpuHistory}
          />
        </div>
      </div>
      <div className="flex min-h-0 flex-col rounded-md border border-border bg-surface p-3">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow">Realtime scene</p>
            <p className="mt-1 text-xs text-muted">
              {liveWorkloadSceneDescription(workload, showcaseFrame)}
            </p>
          </div>
          <span className="shrink-0 font-mono text-[9px] text-success">LIVE</span>
        </div>
        {comparisonWorkload !== undefined ? (
          <ComparisonWorkloadViewport
            amount={workloadAmount}
            animationEnabled={animationEnabled}
            animationSpeed={animationSpeed}
            backend={backend}
            dpr={dpr}
            fontSize={fontSize}
            fontFixture={fontFixture}
            grid={grid}
            layoutWidthRatio={layoutWidthPercent / 100}
            paintOpacity={paintOpacityPercent / 100}
            paintShadowEnabled={paintShadowEnabled}
            paintStrokeWidth={paintStrokePercent / 100}
            showLayoutBounds={showLayoutBounds}
            technique={technique === 'mtsdf' ? 'mtsdf' : 'bitmap'}
            workload={comparisonWorkload}
            onStats={onStats}
          />
        ) : technique === 'mtsdf' ? (
          <MtsdfTextViewport
            backend={backend}
            dpr={dpr}
            fontSize={fontSize}
            grid={grid}
            key={textConfiguration.fontFixture}
            textConfiguration={textConfiguration}
            onStats={onStats}
          />
        ) : (
          <BitmapTextViewport
            backend={backend}
            dpr={dpr}
            fontSize={fontSize}
            grid={grid}
            key={textConfiguration.fontFixture}
            textConfiguration={textConfiguration}
            onStats={onStats}
          />
        )}
      </div>
    </div>
  )
}

function ConformanceSurface({
  backend,
  conformanceView,
  dpr,
  event,
  fontFixture,
  summary,
  technique,
  workload,
  onPan,
  onZoom,
}: {
  readonly backend: GraphicsBackend
  readonly conformanceView: ConformanceView
  readonly dpr: 1 | 2
  readonly event: RunnerEvent | undefined
  readonly fontFixture: SelectableFontFixture
  readonly summary: BenchmarkSummary | undefined
  readonly technique: RasterTechnique
  readonly workload: string
  readonly onPan: (deltaXPercent: number, deltaYPercent: number) => void
  readonly onZoom: (zoom: number) => void
}) {
  const [capture, setCapture] = useState<
    | { readonly kind: 'bitmap'; readonly value: BitmapTextConformanceCapture }
    | { readonly kind: 'mtsdf'; readonly value: MtsdfTextConformanceCapture }
    | { readonly kind: 'source-outline'; readonly value: SourceOutlineFidelityCapture }
  >()
  const [error, setError] = useState<string>()
  const publishCapture = useEffectEvent(
    (
      value:
        | { readonly kind: 'bitmap'; readonly value: BitmapTextConformanceCapture }
        | { readonly kind: 'mtsdf'; readonly value: MtsdfTextConformanceCapture }
        | { readonly kind: 'source-outline'; readonly value: SourceOutlineFidelityCapture },
    ) => {
      setCapture(value)
      setError(undefined)
    },
  )
  const publishError = useEffectEvent((caught: unknown) => {
    if (caught instanceof DOMException && caught.name === 'AbortError') return
    setError(caught instanceof Error ? caught.message : String(caught))
  })
  useEffect(() => {
    const controller = new AbortController()
    const request =
      workload === 'cross-technique-fidelity'
        ? technique === 'mtsdf'
          ? import('./renderer/mtsdf-text').then(async ({ captureMtsdfSourceOutlineFidelity }) => ({
              kind: 'source-outline' as const,
              value: await captureMtsdfSourceOutlineFidelity({
                backend,
                dpr,
                fontFixture,
                signal: controller.signal,
              }),
            }))
          : import('./renderer/bitmap-text').then(
              async ({ captureBitmapSourceOutlineFidelity }) => ({
                kind: 'source-outline' as const,
                value: await captureBitmapSourceOutlineFidelity({
                  backend,
                  dpr,
                  fontFixture,
                  signal: controller.signal,
                }),
              }),
            )
        : technique === 'mtsdf'
          ? import('./renderer/mtsdf-text').then(async ({ captureMtsdfTextConformance }) => ({
              kind: 'mtsdf' as const,
              value: await captureMtsdfTextConformance({
                backend,
                dpr,
                fontFixture,
                signal: controller.signal,
              }),
            }))
          : import('./renderer/bitmap-text').then(async ({ captureBitmapTextConformance }) => ({
              kind: 'bitmap' as const,
              value: await captureBitmapTextConformance({
                backend,
                dpr,
                fontFixture,
                signal: controller.signal,
              }),
            }))
    void request.then(publishCapture).catch(publishError)
    return () => controller.abort()
  }, [backend, dpr, fontFixture, technique, workload])

  const bitmapCapture = capture?.kind === 'bitmap' ? capture.value : undefined
  const mtsdfCapture = capture?.kind === 'mtsdf' ? capture.value : undefined
  const sourceOutlineCapture = capture?.kind === 'source-outline' ? capture.value : undefined
  const isSourceOutline = workload === 'cross-technique-fidelity'

  return (
    <div
      className="grid min-h-0 grid-rows-[auto_minmax(360px,1fr)_auto] gap-3"
      data-conformance-ready={String(capture !== undefined)}
      data-testid="conformance-surface"
    >
      <div className="grid grid-cols-2 overflow-hidden rounded-md border border-border bg-surface md:grid-cols-4">
        <Metric
          label={
            isSourceOutline || technique === 'mtsdf' ? 'Mean error · 0–255' : 'Reference mismatch'
          }
          value={
            isSourceOutline
              ? sourceOutlineCapture === undefined
                ? '—'
                : `${sourceOutlineCapture.meanAbsoluteError.toFixed(3)} · ${((sourceOutlineCapture.meanAbsoluteError / 255) * 100).toFixed(3)}%`
              : technique === 'mtsdf'
                ? mtsdfCapture === undefined
                  ? '—'
                  : `${mtsdfCapture.meanAbsoluteError.toFixed(3)} · ${((mtsdfCapture.meanAbsoluteError / 255) * 100).toFixed(3)}%`
                : bitmapCapture === undefined
                  ? '—'
                  : String(bitmapCapture.mismatchBytes)
          }
        />
        <Metric
          label={
            isSourceOutline || technique === 'mtsdf' ? 'Pixels > 2 / 255' : 'Half-coverage ink'
          }
          value={
            isSourceOutline
              ? sourceOutlineCapture === undefined
                ? '—'
                : `${sourceOutlineCapture.errorPixels} · ${((sourceOutlineCapture.errorPixels / (sourceOutlineCapture.width * sourceOutlineCapture.height)) * 100).toFixed(2)}%`
              : technique === 'mtsdf'
                ? mtsdfCapture === undefined
                  ? '—'
                  : `${mtsdfCapture.errorPixels} · ${((mtsdfCapture.errorPixels / (mtsdfCapture.width * mtsdfCapture.height)) * 100).toFixed(2)}%`
                : bitmapCapture === undefined
                  ? '—'
                  : String(bitmapCapture.inkPixels)
          }
        />
        <Metric
          label={isSourceOutline || technique === 'mtsdf' ? 'Maximum error · 0–255' : 'Lit pixels'}
          value={
            isSourceOutline
              ? sourceOutlineCapture === undefined
                ? '—'
                : `${sourceOutlineCapture.maximumError} / 255`
              : technique === 'mtsdf'
                ? mtsdfCapture === undefined
                  ? '—'
                  : `${mtsdfCapture.maximumError} / 255`
                : bitmapCapture === undefined
                  ? '—'
                  : String(bitmapCapture.litPixels)
          }
        />
        <Metric
          label="Render submit (diagnostic)"
          value={formatMs(capture?.value.renderSubmitMs)}
        />
        <Metric label="Suite duration" value={formatMs(summary?.medianMs ?? event?.medianMs)} />
      </div>
      {isSourceOutline ? (
        <div className="grid min-h-0 grid-cols-1 gap-3 md:grid-cols-2">
          <PixelBytesPanel
            bytes={sourceOutlineCapture?.candidate}
            conformanceView={conformanceView}
            height={sourceOutlineCapture?.height}
            label={`${technique === 'mtsdf' ? 'MSDF' : 'Bitmap'} candidate · ${sourceOutlineCapture?.physicalPpem ?? '—'} device px`}
            width={sourceOutlineCapture?.width}
            onPan={onPan}
            onZoom={onZoom}
          />
          <PixelBytesPanel
            bytes={sourceOutlineCapture?.reference}
            conformanceView={conformanceView}
            height={sourceOutlineCapture?.height}
            label="Browser Canvas2D · pinned source font"
            width={sourceOutlineCapture?.width}
            onPan={onPan}
            onZoom={onZoom}
          />
          <PixelBytesPanel
            bytes={sourceOutlineCapture?.difference}
            className="md:col-span-2"
            conformanceView={conformanceView}
            height={sourceOutlineCapture?.height}
            label="Source-outline difference heatmap ×8"
            width={sourceOutlineCapture?.width}
            onPan={onPan}
            onZoom={onZoom}
          />
        </div>
      ) : technique === 'mtsdf' ? (
        <div className="grid min-h-0 grid-cols-1 gap-3 md:grid-cols-2">
          <PixelBytesPanel
            bytes={mtsdfCapture?.candidate}
            conformanceView={conformanceView}
            height={mtsdfCapture?.height}
            label="Candidate"
            width={mtsdfCapture?.width}
            onPan={onPan}
            onZoom={onZoom}
          />
          <PixelBytesPanel
            bytes={mtsdfCapture?.reference}
            conformanceView={conformanceView}
            height={mtsdfCapture?.height}
            label="CPU sampling reference"
            width={mtsdfCapture?.width}
            onPan={onPan}
            onZoom={onZoom}
          />
          <PixelBytesPanel
            bytes={mtsdfCapture?.difference}
            className="md:col-span-2"
            conformanceView={conformanceView}
            height={mtsdfCapture?.height}
            label="Difference heatmap ×8"
            width={mtsdfCapture?.width}
            onPan={onPan}
            onZoom={onZoom}
          />
        </div>
      ) : (
        <div className="grid min-h-0 grid-cols-1 gap-3 md:grid-cols-2">
          <PixelPanel
            capture={bitmapCapture}
            conformanceView={conformanceView}
            kind="candidate"
            label="Candidate"
            onPan={onPan}
            onZoom={onZoom}
          />
          <PixelPanel
            capture={bitmapCapture}
            conformanceView={conformanceView}
            kind="reference"
            label="CPU reference"
            onPan={onPan}
            onZoom={onZoom}
          />
          <PixelPanel
            capture={bitmapCapture}
            className="md:col-span-2"
            conformanceView={conformanceView}
            kind="difference"
            label="Difference ×1"
            onPan={onPan}
            onZoom={onZoom}
          />
        </div>
      )}
      <div className="rounded-md border border-border bg-surface p-3">
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`size-2 rounded-full ${summary?.status === 'passed' ? 'bg-success' : 'bg-dim'}`}
          />
          <span className="font-medium">Finite conformance suite</span>
          <span className="ml-auto font-mono text-[10px] text-muted">
            {summary?.validation ??
              (isSourceOutline
                ? 'Run conformance to validate the selected renderer against the pinned source font in browser Canvas2D.'
                : technique === 'mtsdf'
                  ? 'Run conformance to validate GPU sampling against the independent CPU sampling reference.'
                  : 'Run conformance to test full-frame and clipped output.')}
          </span>
        </div>
        <p className="mt-2 text-[10px] text-dim">
          {isSourceOutline
            ? 'Both techniques are compared independently with browser Canvas2D using the same pinned source font, authored lines, physical size, and paragraph baselines.'
            : technique === 'mtsdf'
              ? 'Heatmap: black agrees, red is extra GPU coverage, and cyan is extra CPU-reference coverage. Intensity is amplified 8×.'
              : 'End-to-end suite duration includes readback, CPU composition, comparison, clipping, and hashing. It is test cost, not renderer performance.'}
        </p>
      </div>
      {error !== undefined && <p className="text-xs text-danger">{error}</p>}
    </div>
  )
}

function PixelBytesPanel({
  bytes,
  className = '',
  conformanceView,
  height,
  label,
  width,
  onPan,
  onZoom,
}: {
  readonly bytes: Uint8Array | undefined
  readonly className?: string
  readonly conformanceView: ConformanceView
  readonly height: number | undefined
  readonly label: string
  readonly width: number | undefined
  readonly onPan: (deltaXPercent: number, deltaYPercent: number) => void
  readonly onZoom: (zoom: number) => void
}) {
  function drawCapture(canvas: HTMLCanvasElement | null): void {
    if (canvas === null || bytes === undefined || width === undefined || height === undefined)
      return
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('Unable to create conformance inspection canvas')
    context.putImageData(new ImageData(new Uint8ClampedArray(bytes), width, height), 0, 0)
  }
  function moveView(event: ReactPointerEvent<HTMLButtonElement>): void {
    if (!event.currentTarget.hasPointerCapture(event.pointerId) || conformanceView.zoom <= 1) return
    const bounds = event.currentTarget.getBoundingClientRect()
    onPan((event.movementX / bounds.width) * 100, (event.movementY / bounds.height) * 100)
  }
  function zoomView(event: ReactWheelEvent<HTMLButtonElement>): void {
    event.preventDefault()
    const direction = event.deltaY < 0 ? 0.25 : -0.25
    onZoom(Math.min(8, Math.max(1, conformanceView.zoom + direction)))
  }
  return (
    <figure
      className={`flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-panel ${className}`}
    >
      <figcaption className="border-b border-border px-3 py-2 font-mono text-[9px] uppercase tracking-wider text-muted">
        {label}
      </figcaption>
      <button
        type="button"
        aria-label={`Pan and zoom ${label}`}
        className={`grid min-h-[240px] flex-1 place-items-center overflow-hidden p-3 ${conformanceView.zoom > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'}`}
        data-pan-x={conformanceView.panXPercent}
        data-pan-y={conformanceView.panYPercent}
        data-zoom={conformanceView.zoom}
        style={{ touchAction: 'none' }}
        onDoubleClick={() => onZoom(conformanceView.zoom === 1 ? 2 : 1)}
        onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
        onPointerMove={moveView}
        onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
        onWheel={zoomView}
      >
        {bytes === undefined ? (
          <span className="font-mono text-[9px] text-dim">GENERATING</span>
        ) : (
          <canvas
            className="h-auto max-h-full w-full select-none [image-rendering:pixelated]"
            ref={drawCapture}
            style={{
              transform: `translate3d(${conformanceView.panXPercent}%, ${conformanceView.panYPercent}%, 0) scale(${conformanceView.zoom})`,
              transformOrigin: 'center',
            }}
          />
        )}
      </button>
    </figure>
  )
}

function PixelPanel({
  capture,
  className,
  conformanceView,
  kind,
  label,
  onPan,
  onZoom,
}: {
  readonly capture: BitmapTextConformanceCapture | undefined
  readonly className?: string
  readonly conformanceView: ConformanceView
  readonly kind: 'candidate' | 'reference' | 'difference'
  readonly label: string
  readonly onPan: (deltaXPercent: number, deltaYPercent: number) => void
  readonly onZoom: (zoom: number) => void
}) {
  return (
    <PixelBytesPanel
      bytes={capture?.[kind]}
      {...(className === undefined ? {} : { className })}
      conformanceView={conformanceView}
      height={capture?.height}
      label={label}
      width={capture?.width}
      onPan={onPan}
      onZoom={onZoom}
    />
  )
}

function BitmapTextViewport({
  backend,
  dpr,
  fontSize,
  grid,
  textConfiguration,
  onStats,
}: {
  readonly backend: GraphicsBackend
  readonly dpr: 1 | 2
  readonly fontSize: number
  readonly grid: boolean
  readonly textConfiguration: LiveTextConfiguration
  readonly onStats: (stats: BitmapTextLiveStats) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<BitmapTextPreview>(undefined)
  const previewLifecycleRef = useRef<Promise<void>>(Promise.resolve())
  const [stats, setStats] = useState<BitmapTextLiveStats>()
  const [settledRevision, setSettledRevision] = useState(0)
  const [settledTextLength, setSettledTextLength] = useState(0)
  const [settledTimelineTick, setSettledTimelineTick] = useState<number>()
  const [presentationEvidence, setPresentationEvidence] = useState<PresentationEvidence>({
    revision: 0,
    progress: 1,
    matchedGlyphs: 0,
    targetGlyphs: 0,
  })
  const [error, setError] = useState<string>()
  const {
    anchor,
    animatePresentation,
    direction,
    expectedGlyphCount,
    features,
    fontFixture,
    language,
    layoutWidthRatio,
    text,
    textAlign,
    timelineTick,
  } = textConfiguration
  const publishStats = useEffectEvent((next: BitmapTextLiveStats) => {
    setStats(next)
    onStats(next)
    setError(undefined)
  })
  const publishError = useEffectEvent((caught: unknown) => {
    if (caught instanceof DOMException && caught.name === 'AbortError') return
    setError(caught instanceof Error ? caught.message : String(caught))
  })
  const previewConfiguration = useEffectEvent(() => ({
    anchor,
    direction,
    expectedGlyphCount,
    features,
    fontFixture,
    fontSize: fontSize / dpr,
    language,
    layoutWidthRatio,
    showGrid: grid,
    text,
    textAlign,
    timelineTick,
  }))
  const publishSettledRevision = useEffectEvent((revision: number) => {
    setSettledRevision(revision)
  })
  const publishSettledTimelineTick = useEffectEvent((tick: number | undefined) => {
    setSettledTimelineTick(tick)
  })
  const publishSettledTextLength = useEffectEvent((length: number) => {
    setSettledTextLength(length)
  })
  const publishPresentation = useEffectEvent(
    (snapshot: BitmapTextPreviewSnapshot, progress: 0 | 1) => {
      setPresentationEvidence({
        revision: snapshot.revision,
        progress,
        matchedGlyphs: snapshot.matchedGlyphs,
        targetGlyphs: snapshot.targetGlyphs,
      })
    },
  )

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (canvas === null || container === null) return
    const controller = new AbortController()
    const configuration = previewConfiguration()
    let preview:
      | Awaited<ReturnType<(typeof import('./renderer/bitmap-text'))['createBitmapTextPreview']>>
      | undefined
    let cancelled = false
    const resize = (): void => {
      if (preview === undefined) return
      const bounds = container.getBoundingClientRect()
      preview.resize(Math.max(1, bounds.width), Math.max(1, bounds.height))
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    const initialization = previewLifecycleRef.current.then(async () => {
      const { createBitmapTextPreview } = await import('./renderer/bitmap-text')
      if (cancelled) return
      const bounds = container.getBoundingClientRect()
      const created = await createBitmapTextPreview({
        anchor: configuration.anchor,
        backend,
        canvas,
        dpr,
        ...(configuration.expectedGlyphCount === undefined
          ? {}
          : { expectedGlyphCount: configuration.expectedGlyphCount }),
        fontFixture: configuration.fontFixture,
        fontSize: configuration.fontSize,
        height: Math.max(1, bounds.height),
        showGrid: configuration.showGrid,
        layoutWidth: Math.max(120, bounds.width * configuration.layoutWidthRatio),
        text: configuration.text,
        language: configuration.language,
        direction: configuration.direction,
        features: configuration.features,
        width: Math.max(1, bounds.width),
        signal: controller.signal,
        onError: publishError,
        onStats: publishStats,
      })
      if (cancelled) {
        await created.dispose()
        return
      }
      preview = created
      previewRef.current = created
      publishSettledTimelineTick(configuration.timelineTick)
      publishSettledTextLength(configuration.text.length)
      resize()
    })
    void initialization.catch(publishError)
    return () => {
      cancelled = true
      controller.abort()
      observer.disconnect()
      previewLifecycleRef.current = initialization.then(
        async () => {
          if (preview === undefined) return
          const current = preview
          preview = undefined
          if (previewRef.current === current) previewRef.current = undefined
          await current.dispose()
        },
        () => undefined,
      )
    }
  }, [backend, dpr])

  useEffect(() => {
    previewRef.current?.setGridVisible(grid)
  }, [grid])

  useEffect(() => {
    const preview = previewRef.current
    if (preview === undefined) return
    let cancelled = false
    let animationFrame: number | undefined
    const publishSettled = (snapshot: BitmapTextPreviewSnapshot): void => {
      if (cancelled) return
      publishPresentation(snapshot, 1)
      publishSettledRevision(snapshot.revision)
      publishSettledTimelineTick(timelineTick)
      publishSettledTextLength(text.length)
    }
    void preview
      .update({
        anchor,
        fontSize: fontSize / dpr,
        layoutWidthRatio,
        text,
        language,
        direction,
        features,
        textAlign,
      })
      .then((snapshot) => {
        if (cancelled) return
        publishPresentation(snapshot, 0)
        if (!animatePresentation) {
          publishSettled(preview.finishPresentation(snapshot.revision))
          return
        }
        const startedAt = performance.now()
        const animate = (timestamp: number): void => {
          if (cancelled) return
          const linearProgress = Math.min(
            1,
            Math.max(0, (timestamp - startedAt) / GLYPH_POSITION_TRANSITION_MS),
          )
          const easedProgress = linearProgress * linearProgress * (3 - 2 * linearProgress)
          const presented = preview.setPresentationProgress(snapshot.revision, easedProgress)
          if (linearProgress === 1) {
            publishSettled(presented)
            return
          }
          animationFrame = requestAnimationFrame(animate)
        }
        animationFrame = requestAnimationFrame(animate)
      })
      .catch(publishError)
    return () => {
      cancelled = true
      if (animationFrame !== undefined) cancelAnimationFrame(animationFrame)
    }
  }, [
    anchor,
    animatePresentation,
    direction,
    dpr,
    features,
    fontSize,
    language,
    layoutWidthRatio,
    text,
    textAlign,
    timelineTick,
  ])

  return (
    <div
      className="relative min-h-[360px] flex-1 overflow-hidden rounded border border-border bg-background"
      data-canvas-grid={String(grid)}
      data-anchor={anchor}
      data-layout-width={stats?.layoutWidth}
      data-layout-width-ratio={layoutWidthRatio}
      data-line-count={stats?.lineCount}
      data-frame-count={stats?.frameCount}
      data-frames-per-second={stats?.framesPerSecond}
      data-font-fixture={fontFixture}
      data-median-submit-ms={stats?.medianSubmitMs}
      data-p95-submit-ms={stats?.p95SubmitMs}
      data-gpu-frame-ms={stats?.gpuFrameMs}
      data-median-gpu-ms={stats?.medianGpuMs}
      data-p95-gpu-ms={stats?.p95GpuMs}
      data-submit-history-length={stats?.submitHistoryLength}
      data-fps-history-length={stats?.fpsHistoryLength}
      data-glyph-count={stats?.glyphCount}
      data-missing-glyph-count={stats?.missingGlyphCount}
      data-draw-count={stats?.drawCount}
      data-renderer-init-ms={stats?.rendererInitMs}
      data-rendered-device-px={stats?.renderedPpem}
      data-scale-ratio={stats?.scaleRatio}
      data-font-load-ms={stats?.fontLoadMs}
      data-text-ready-ms={stats?.textReadyMs}
      data-first-draw-ms={stats?.firstDrawMs}
      data-upload-frame-gpu-ms={stats?.uploadFrameGpuMs}
      data-upload-frame-complete-ms={stats?.uploadFrameCompleteMs}
      data-startup-ms={stats?.startupMs}
      data-source-text-length={text.length}
      data-text-align={textAlign}
      data-artifact-bytes={stats?.artifactBytes}
      data-atlas-gpu-bytes={stats?.atlasGpuBytes}
      data-total-gpu-bytes={stats?.totalGpuBytes}
      data-settled-revision={settledRevision}
      data-settled-text-length={settledTextLength}
      data-settled-tick={settledTimelineTick}
      data-presentation-matched-glyphs={presentationEvidence.matchedGlyphs}
      data-presentation-progress={presentationEvidence.progress}
      data-presentation-revision={presentationEvidence.revision}
      data-presentation-target-glyphs={presentationEvidence.targetGlyphs}
      data-backend={stats?.backend}
      data-dpr={stats?.dpr}
      data-gpu-history-length={stats?.gpuHistoryLength}
      data-gpu-timing-supported={stats?.gpuTimingSupported}
      data-testid="bitmap-live-viewport"
      ref={containerRef}
    >
      <canvas
        aria-label={`Live bitmap benchmark using ${backend}`}
        className="absolute inset-0 size-full"
        ref={canvasRef}
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-3 py-2 font-mono text-[9px] text-muted">
        <span>
          BAKED {stats?.strikePpem ?? 16} PX · RENDERED {stats?.renderedPpem ?? 16} DEVICE PX ·{' '}
          {(stats?.scaleRatio ?? 1).toFixed(2)}×
        </span>
        <span>{dpr}× DPR</span>
      </div>
      {stats === undefined && error === undefined && (
        <div className="absolute inset-0 grid place-items-center font-mono text-[9px] text-dim">
          INITIALIZING {backend.toUpperCase()}
        </div>
      )}
      {error !== undefined && (
        <div className="absolute inset-0 grid place-items-center p-3 text-center text-[10px] text-danger">
          {error}
        </div>
      )}
    </div>
  )
}

function MtsdfTextViewport({
  backend,
  dpr,
  fontSize,
  grid,
  textConfiguration,
  onStats,
}: {
  readonly backend: GraphicsBackend
  readonly dpr: 1 | 2
  readonly fontSize: number
  readonly grid: boolean
  readonly textConfiguration: LiveTextConfiguration
  readonly onStats: (stats: LiveTextStats) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<MtsdfTextPreview>(undefined)
  const previewLifecycleRef = useRef<Promise<void>>(Promise.resolve())
  const [stats, setStats] = useState<MtsdfTextLiveStats>()
  const [error, setError] = useState<string>()
  const { anchor, direction, features, fontFixture, language, layoutWidthRatio, text, textAlign } =
    textConfiguration
  const publishStats = useEffectEvent((next: MtsdfTextLiveStats) => {
    setStats(next)
    onStats(next)
    setError(undefined)
  })
  const publishError = useEffectEvent((caught: unknown) => {
    if (caught instanceof DOMException && caught.name === 'AbortError') return
    setError(caught instanceof Error ? caught.message : String(caught))
  })
  const previewConfiguration = useEffectEvent(() => ({
    anchor,
    direction,
    features,
    fontSize: fontSize / dpr,
    language,
    layoutWidthRatio,
    showGrid: grid,
    text,
    textAlign,
  }))

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (canvas === null || container === null) return
    const controller = new AbortController()
    const configuration = previewConfiguration()
    let preview: MtsdfTextPreview | undefined
    let cancelled = false
    const resize = (): void => {
      if (preview === undefined) return
      const bounds = container.getBoundingClientRect()
      preview.resize(Math.max(1, bounds.width), Math.max(1, bounds.height))
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    const initialization = previewLifecycleRef.current.then(async () => {
      const { createMtsdfTextPreview } = await import('./renderer/mtsdf-text')
      if (cancelled) return
      const bounds = container.getBoundingClientRect()
      const created = await createMtsdfTextPreview({
        anchor: configuration.anchor,
        backend,
        canvas,
        dpr,
        fontSize: configuration.fontSize,
        fontFixture,
        height: Math.max(1, bounds.height),
        showGrid: configuration.showGrid,
        layoutWidth: Math.max(120, bounds.width * configuration.layoutWidthRatio),
        text: configuration.text,
        textAlign: configuration.textAlign,
        language: configuration.language,
        direction: configuration.direction,
        features: configuration.features,
        width: Math.max(1, bounds.width),
        signal: controller.signal,
        onError: publishError,
        onStats: publishStats,
      })
      if (cancelled) {
        await created.dispose()
        return
      }
      preview = created
      previewRef.current = created
      resize()
    })
    void initialization.catch(publishError)
    return () => {
      cancelled = true
      controller.abort()
      observer.disconnect()
      previewLifecycleRef.current = initialization.then(
        async () => {
          if (preview === undefined) return
          const current = preview
          preview = undefined
          if (previewRef.current === current) previewRef.current = undefined
          await current.dispose()
        },
        () => undefined,
      )
    }
  }, [backend, dpr, fontFixture])

  useEffect(() => {
    previewRef.current?.setGridVisible(grid)
  }, [grid])

  useEffect(() => {
    const preview = previewRef.current
    if (preview === undefined) return
    void preview
      .update({
        anchor,
        direction,
        features,
        fontSize: fontSize / dpr,
        language,
        layoutWidthRatio,
        text,
        textAlign,
      })
      .catch(publishError)
  }, [anchor, direction, dpr, features, fontSize, language, layoutWidthRatio, text, textAlign])

  return (
    <div
      className="relative min-h-[360px] flex-1 overflow-hidden rounded border border-border bg-background"
      data-canvas-grid={String(grid)}
      data-anchor={anchor}
      data-artifact-bytes={stats?.artifactBytes}
      data-atlas-gpu-bytes={stats?.atlasGpuBytes}
      data-backend={stats?.backend}
      data-dpr={stats?.dpr}
      data-draw-count={stats?.drawCount}
      data-fps-history-length={stats?.fpsHistoryLength}
      data-frame-count={stats?.frameCount}
      data-frames-per-second={stats?.framesPerSecond}
      data-font-fixture={fontFixture}
      data-glyph-count={stats?.glyphCount}
      data-gpu-history-length={stats?.gpuHistoryLength}
      data-gpu-timing-supported={stats?.gpuTimingSupported}
      data-layout-width={stats?.layoutWidth}
      data-layout-width-ratio={layoutWidthRatio}
      data-line-count={stats?.lineCount}
      data-median-gpu-ms={stats?.medianGpuMs}
      data-median-submit-ms={stats?.medianSubmitMs}
      data-missing-glyph-count={stats?.missingGlyphCount}
      data-rendered-device-px={fontSize}
      data-scale-ratio={fontSize / 64}
      data-startup-ms={stats?.startupMs}
      data-upload-frame-gpu-ms={stats?.uploadFrameGpuMs}
      data-upload-frame-complete-ms={stats?.uploadFrameCompleteMs}
      data-submit-history-length={stats?.submitHistoryLength}
      data-source-text-length={text.length}
      data-text-align={textAlign}
      data-timeline-tick={textConfiguration.timelineTick}
      data-testid="mtsdf-live-viewport"
      ref={containerRef}
    >
      <canvas
        aria-label={`Live MSDF benchmark using ${backend}`}
        className="absolute inset-0 size-full"
        ref={canvasRef}
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-3 py-2 font-mono text-[9px] text-muted">
        <span>
          MTSDF 64 PX/EM · RENDERED {fontSize} DEVICE PX · {(fontSize / 64).toFixed(2)}×
        </span>
        <span>{dpr}× DPR</span>
      </div>
      {stats === undefined && error === undefined && (
        <div className="absolute inset-0 grid place-items-center font-mono text-[9px] text-dim">
          LOADING MSDF {backend.toUpperCase()}
        </div>
      )}
      {error !== undefined && (
        <div className="absolute inset-0 grid place-items-center p-3 text-center text-[10px] text-danger">
          {error}
        </div>
      )}
    </div>
  )
}

function ComparisonWorkloadViewport({
  amount,
  animationEnabled,
  animationSpeed,
  backend,
  dpr,
  fontFixture,
  fontSize,
  grid,
  layoutWidthRatio,
  paintOpacity,
  paintShadowEnabled,
  paintStrokeWidth,
  showLayoutBounds,
  technique,
  workload,
  onStats,
}: {
  readonly amount: number
  readonly animationEnabled: boolean
  readonly animationSpeed: number
  readonly backend: GraphicsBackend
  readonly dpr: 1 | 2
  readonly fontFixture: SelectableFontFixture
  readonly fontSize: number
  readonly grid: boolean
  readonly layoutWidthRatio: number
  readonly paintOpacity: number
  readonly paintShadowEnabled: boolean
  readonly paintStrokeWidth: number
  readonly showLayoutBounds: boolean
  readonly technique: 'bitmap' | 'mtsdf'
  readonly workload: ComparisonWorkloadId
  readonly onStats: (stats: LiveTextStats) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<ComparisonWorkloadPreview>(undefined)
  const previewLifecycleRef = useRef<Promise<void>>(Promise.resolve())
  const panGestureRef = useRef<
    { readonly pointerId: number; readonly x: number; readonly y: number } | undefined
  >(undefined)
  const surfaceKey = `${backend}:${String(dpr)}:${fontFixture}:${technique}:${workload}`
  const [publishedStats, setPublishedStats] = useState<
    Readonly<{
      fontFixture: SelectableFontFixture
      key: string
      value: ComparisonWorkloadStats
    }>
  >()
  const stats = publishedStats?.value
  const [error, setError] = useState<string>()
  const publishStats = useEffectEvent((key: string, next: ComparisonWorkloadStats) => {
    if (key !== surfaceKey) return
    setPublishedStats({ fontFixture, key, value: next })
    onStats(next)
    setError(undefined)
  })
  const publishError = useEffectEvent((caught: unknown) => {
    if (caught instanceof DOMException && caught.name === 'AbortError') return
    setError(caught instanceof Error ? caught.message : String(caught))
  })
  const currentConfiguration = useEffectEvent(() => ({
    amount,
    animationEnabled,
    animationSpeed,
    fontFixture,
    fontSize: fontSize / dpr,
    layoutWidthRatio,
    paintOpacity,
    paintShadowEnabled,
    paintStrokeWidth,
    showGrid: grid,
    showLayoutBounds,
    workload,
  }))

  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (canvas === null || container === null) return
    const controller = new AbortController()
    const effectSurfaceKey = surfaceKey
    let preview: ComparisonWorkloadPreview | undefined
    let cancelled = false
    const resize = (): void => {
      if (preview === undefined) return
      const bounds = container.getBoundingClientRect()
      preview.resize(Math.max(1, bounds.width), Math.max(1, bounds.height))
    }
    const observer = new ResizeObserver(resize)
    observer.observe(container)
    const initialization = previewLifecycleRef.current.then(async () => {
      const { createComparisonWorkloadPreview } = await import('./renderer/comparison-workload')
      if (cancelled) return
      const bounds = container.getBoundingClientRect()
      const configuration = currentConfiguration()
      const created = await createComparisonWorkloadPreview({
        ...configuration,
        backend,
        canvas,
        dpr,
        height: Math.max(1, bounds.height),
        signal: controller.signal,
        technique,
        width: Math.max(1, bounds.width),
        onError: publishError,
        onStats: (next) => publishStats(effectSurfaceKey, next),
      })
      if (cancelled) {
        await created.dispose()
        return
      }
      preview = created
      previewRef.current = created
      resize()
    })
    void initialization.catch(publishError)
    return () => {
      cancelled = true
      controller.abort()
      observer.disconnect()
      previewLifecycleRef.current = initialization.then(
        async () => {
          if (preview === undefined) return
          const current = preview
          preview = undefined
          if (previewRef.current === current) previewRef.current = undefined
          await current.dispose()
        },
        () => undefined,
      )
    }
  }, [backend, dpr, fontFixture, surfaceKey, technique, workload])

  useEffect(() => {
    const preview = previewRef.current
    if (preview === undefined) return
    void preview.update(currentConfiguration()).catch(publishError)
  }, [
    amount,
    animationEnabled,
    animationSpeed,
    dpr,
    fontFixture,
    fontSize,
    layoutWidthRatio,
    paintOpacity,
    paintShadowEnabled,
    paintStrokeWidth,
    grid,
    showLayoutBounds,
    workload,
  ])

  const rangeLabel =
    workload === 'text-ladder' ? '8–512 DEVICE PX' : `RENDERED ${fontSize} DEVICE PX`
  function beginPan(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (workload !== 'text-ladder' || event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    panGestureRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
  }
  function continuePan(event: ReactPointerEvent<HTMLCanvasElement>): void {
    const gesture = panGestureRef.current
    if (gesture?.pointerId !== event.pointerId) return
    previewRef.current?.panBy(event.clientX - gesture.x, event.clientY - gesture.y)
    panGestureRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY }
  }
  function endPan(event: ReactPointerEvent<HTMLCanvasElement>): void {
    if (panGestureRef.current?.pointerId !== event.pointerId) return
    panGestureRef.current = undefined
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }
  return (
    <div
      className="relative min-h-[360px] flex-1 overflow-hidden rounded border border-border bg-background"
      data-canvas-grid={String(grid)}
      data-artifact-bytes={stats?.artifactBytes}
      data-atlas-gpu-bytes={stats?.atlasGpuBytes}
      data-backend={stats?.backend}
      data-dpr={stats?.dpr}
      data-draw-count={stats?.drawCount}
      data-first-draw-ms={stats?.firstDrawMs}
      data-font-fixture={publishedStats?.fontFixture ?? fontFixture}
      data-font-load-ms={stats?.fontLoadMs}
      data-frames-per-second={stats?.framesPerSecond}
      data-glyph-count={stats?.glyphCount}
      data-gpu-history-length={stats?.gpuHistoryLength}
      data-gpu-timing-supported={stats?.gpuTimingSupported}
      data-layout-width={stats?.layoutWidth}
      data-line-count={stats?.lineCount}
      data-median-gpu-ms={stats?.medianGpuMs}
      data-median-submit-ms={stats?.medianSubmitMs}
      data-missing-glyph-count={stats?.missingGlyphCount}
      data-p95-gpu-ms={stats?.p95GpuMs}
      data-p95-submit-ms={stats?.p95SubmitMs}
      data-renderer-init-ms={stats?.rendererInitMs}
      data-configuration-revision={stats?.configurationRevision}
      data-paint-opacity={
        stats?.workload === 'paint-effects' ? stats.appliedPaintOpacity : undefined
      }
      data-paint-shadow-enabled={
        stats?.workload === 'paint-effects' ? String(stats.appliedPaintShadowEnabled) : undefined
      }
      data-paint-stroke-width={
        stats?.workload === 'paint-effects' ? stats.appliedPaintStrokeWidth : undefined
      }
      data-paint-revision={stats?.workload === 'paint-effects' ? stats.paintRevision : undefined}
      data-paint-update-ms={
        stats?.workload === 'paint-effects' ? stats.lastPaintUpdateMs : undefined
      }
      data-presentation-pending={publishedStats !== undefined && publishedStats.key !== surfaceKey}
      data-layout-bounds-visible={
        stats?.workload === 'dynamic-layout' ? String(stats.appliedShowLayoutBounds) : undefined
      }
      data-reflow-count={stats?.reflowCount}
      data-reflow-ms={stats?.lastReflowMs}
      data-rendered-device-px={stats === undefined ? undefined : stats.appliedFontSize * dpr}
      data-startup-ms={stats?.startupMs}
      data-source-text-length={stats?.sourceTextLength}
      data-submit-history-length={stats?.submitHistoryLength}
      data-text-ready-ms={stats?.textReadyMs}
      data-technique={technique}
      data-testid="comparison-live-viewport"
      data-total-gpu-bytes={stats?.totalGpuBytes}
      data-upload-frame-gpu-ms={stats?.uploadFrameGpuMs}
      data-upload-frame-complete-ms={stats?.uploadFrameCompleteMs}
      data-workload={stats?.workload}
      data-workload-amount={
        stats === undefined ||
        workloadAmountLabel(stats.workload, stats.appliedAmount) === undefined
          ? undefined
          : stats.appliedAmount
      }
      data-animation-enabled={
        stats?.workload === 'dynamic-layout' || stats?.workload === 'paint-effects'
          ? String(stats.appliedAnimationEnabled)
          : undefined
      }
      data-animation-speed={
        stats?.workload === 'dynamic-layout' || stats?.workload === 'paint-effects'
          ? stats.appliedAnimationSpeed
          : undefined
      }
      ref={containerRef}
    >
      <canvas
        aria-label={`Live ${technique === 'mtsdf' ? 'MSDF' : 'bitmap'} ${workload} benchmark using ${backend}`}
        className={`absolute inset-0 size-full ${workload === 'text-ladder' ? 'cursor-grab touch-none active:cursor-grabbing' : ''}`}
        ref={canvasRef}
        onDoubleClick={() => previewRef.current?.resetView()}
        onPointerCancel={endPan}
        onPointerDown={beginPan}
        onPointerMove={continuePan}
        onPointerUp={endPan}
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-3 py-2 font-mono text-[9px] text-muted">
        <span>
          {technique === 'mtsdf' ? 'MTSDF 64 PX/EM' : 'BITMAP 16 PX STRIKE'} · {rangeLabel}
        </span>
        <span>{workload === 'text-ladder' ? `DRAG TO PAN · ${dpr}× DPR` : `${dpr}× DPR`}</span>
      </div>
      {publishedStats === undefined && error === undefined && (
        <div className="absolute inset-0 grid place-items-center font-mono text-[9px] text-dim">
          LOADING {technique === 'mtsdf' ? 'MSDF' : 'BITMAP'} {workload.toUpperCase()}
        </div>
      )}
      {error !== undefined && (
        <div className="absolute inset-0 grid place-items-center p-3 text-center text-[10px] text-danger">
          {error}
        </div>
      )}
    </div>
  )
}

function LiveCost({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="border-b border-r border-border px-3 py-2 last:border-r-0">
      <p className="font-mono text-[8px] uppercase tracking-wider text-dim">{label}</p>
      <p className="mt-1 font-mono text-[11px] text-foreground">{value}</p>
    </div>
  )
}

function Sparkline({
  cursor,
  emptyLabel,
  id,
  label,
  length,
  maximum,
  minimum,
  tone,
  unit,
  values,
}: {
  readonly cursor: LiveFrameHistoryCursor | undefined
  readonly emptyLabel?: string
  readonly id: 'cpu' | 'fps' | 'gpu'
  readonly label: string
  readonly length: number
  readonly maximum: number | undefined
  readonly minimum: number | undefined
  readonly tone: 'cyan' | 'success' | 'warning'
  readonly unit: 'fps' | 'ms'
  readonly values: Float32Array | undefined
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (canvas === null || cursor === undefined || values === undefined) return
    const context = canvas.getContext('2d')
    if (context === null) return
    const width = canvas.width
    const height = canvas.height
    context.strokeStyle = getComputedStyle(canvas).getPropertyValue(`--${tone}`)
    context.lineWidth = 1.5
    let animationFrame = 0
    const draw = (): void => {
      const historyLength = cursor.length
      let chartMaximum = 1
      const start = historyLength === values.length ? cursor.nextIndex : 0
      for (let index = 0; index < historyLength; index += 1) {
        chartMaximum = Math.max(chartMaximum, values[(start + index) % values.length] ?? 0)
      }
      context.clearRect(0, 0, width, height)
      context.beginPath()
      for (let index = 0; index < historyLength; index += 1) {
        const value = values[(start + index) % values.length] ?? 0
        const x = historyLength < 2 ? 0 : (index / (historyLength - 1)) * width
        const y = height - (value / chartMaximum) * (height - 4) - 2
        if (index === 0) context.moveTo(x, y)
        else context.lineTo(x, y)
      }
      context.stroke()
      animationFrame = requestAnimationFrame(draw)
    }
    animationFrame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(animationFrame)
  }, [cursor, tone, values])
  return (
    <div className="bg-surface p-3" data-testid={`sparkline-${id}`} data-tone={tone}>
      <div
        className={`flex items-baseline justify-between gap-2 font-mono text-[8px] uppercase tracking-wider ${sparklineToneClass(tone)}`}
      >
        <p>{label}</p>
        <p className="text-right tabular-nums">
          LOW {formatSparklineValue(minimum, unit)} · HIGH {formatSparklineValue(maximum, unit)}
        </p>
      </div>
      <div className="relative mt-2 h-[42px] w-full">
        <canvas
          aria-label={`${label} history`}
          className="absolute inset-0 size-full"
          height={42}
          ref={canvasRef}
          width={180}
        />
        {length === 0 && emptyLabel !== undefined && (
          <span className="absolute inset-0 grid place-items-center font-mono text-[8px] text-dim">
            {emptyLabel}
          </span>
        )}
      </div>
    </div>
  )
}

function formatSparklineValue(value: number | undefined, unit: 'fps' | 'ms'): string {
  if (value === undefined) return '—'
  return unit === 'fps' ? value.toFixed(1) : `${value.toFixed(2)} ms`
}

function sparklineToneClass(tone: 'cyan' | 'success' | 'warning'): string {
  switch (tone) {
    case 'cyan':
      return 'text-cyan'
    case 'success':
      return 'text-success'
    case 'warning':
      return 'text-warning'
  }
}

function Controls({
  animationEnabled,
  animationSpeed,
  backend,
  conformanceView,
  dpr,
  fontFixture,
  liveStats,
  fontSize,
  layoutWidthPercent,
  paintOpacityPercent,
  paintShadowEnabled,
  paintStrokePercent,
  selectedFontFixture,
  workloadAmount,
  mode,
  technique,
  workload,
  samples,
  showcaseFrame,
  showcaseState,
  showGrid,
  showLayoutBounds,
  warmup,
  webgpu,
  onBackend,
  onAnimationEnabled,
  onAnimationSpeed,
  onConformanceReset,
  onConformanceZoom,
  onDpr,
  onFontSize,
  onLayoutWidthPercent,
  onPaintOpacityPercent,
  onPaintShadowEnabled,
  onPaintStrokePercent,
  onSelectedFontFixture,
  onWorkloadAmount,
  onSamples,
  onShowcase,
  onShowGrid,
  onShowLayoutBounds,
  onWarmup,
}: {
  readonly animationEnabled: boolean
  readonly animationSpeed: number
  readonly backend: GraphicsBackend
  readonly conformanceView: ConformanceView
  readonly dpr: 1 | 2
  readonly fontFixture: BenchmarkFontFixture
  readonly liveStats: LiveTextStats | undefined
  readonly fontSize: number
  readonly layoutWidthPercent: number
  readonly paintOpacityPercent: number
  readonly paintShadowEnabled: boolean
  readonly paintStrokePercent: number
  readonly selectedFontFixture: SelectableFontFixture
  readonly workloadAmount: number
  readonly mode: HarnessMode
  readonly technique: RasterTechnique
  readonly workload: string
  readonly samples: number
  readonly showcaseFrame: AdvancedShapingFrame
  readonly showcaseState: AdvancedShapingState
  readonly showGrid: boolean
  readonly showLayoutBounds: boolean
  readonly warmup: number
  readonly webgpu: boolean
  readonly onBackend: (backend: GraphicsBackend) => void
  readonly onAnimationEnabled: (value: boolean) => void
  readonly onAnimationSpeed: (value: number) => void
  readonly onConformanceReset: () => void
  readonly onConformanceZoom: (zoom: number) => void
  readonly onDpr: (dpr: 1 | 2) => void
  readonly onFontSize: (value: number) => void
  readonly onLayoutWidthPercent: (value: number) => void
  readonly onPaintOpacityPercent: (value: number) => void
  readonly onPaintShadowEnabled: (value: boolean) => void
  readonly onPaintStrokePercent: (value: number) => void
  readonly onSelectedFontFixture: (value: SelectableFontFixture) => void
  readonly onWorkloadAmount: (value: number) => void
  readonly onSamples: (value: number) => void
  readonly onShowcase: (command: AdvancedShapingCommand) => void
  readonly onShowGrid: (value: boolean) => void
  readonly onShowLayoutBounds: (value: boolean) => void
  readonly onWarmup: (value: number) => void
}) {
  return (
    <section className="grid min-w-0 gap-4 [&>*]:min-w-0" data-testid="controls">
      <div>
        <p className="eyebrow">Inspection controls</p>
        <h2 className="mt-1 text-base font-semibold">Render configuration</h2>
      </div>
      {workload !== 'advanced-shaping' && (
        <div className="min-[1200px]:hidden">
          <SelectField
            label="Font fixture"
            value={selectedFontFixture}
            onChange={(value) => onSelectedFontFixture(selectableFontFixture(value))}
          >
            {SELECTABLE_FONT_FIXTURES.map((fixture) => (
              <option key={fixture.id} value={fixture.id}>
                {fixture.label} · {fixture.metadata}
              </option>
            ))}
          </SelectField>
        </div>
      )}
      <div>
        <p className="mb-2 font-mono text-[9px] uppercase text-dim">Backend</p>
        <div className="grid grid-cols-2 gap-2">
          <Button
            disabled={!webgpu}
            variant={backend === 'webgpu' ? 'primary' : 'secondary'}
            onClick={() => onBackend('webgpu')}
          >
            WebGPU
          </Button>
          <Button
            variant={backend === 'webgl2' ? 'primary' : 'secondary'}
            onClick={() => onBackend('webgl2')}
          >
            WebGL2
          </Button>
        </div>
      </div>
      <div>
        <p className="mb-2 font-mono text-[9px] uppercase text-dim">Device pixel ratio</p>
        <div className="grid grid-cols-2 gap-2">
          <Button variant={dpr === 1 ? 'primary' : 'secondary'} onClick={() => onDpr(1)}>
            1× DPR
          </Button>
          <Button variant={dpr === 2 ? 'primary' : 'secondary'} onClick={() => onDpr(2)}>
            2× DPR
          </Button>
        </div>
      </div>
      <div className="border-y border-border py-2">
        <Toggle checked={showGrid} label="Show canvas grid" onChange={onShowGrid} />
      </div>
      {mode === 'conformance' && (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 rounded-md border border-border bg-surface p-3">
          <Field
            label={`Zoom · ${conformanceView.zoom.toFixed(2)}×`}
            max={8}
            min={1}
            step={0.25}
            type="range"
            value={conformanceView.zoom}
            onChange={(event) => onConformanceZoom(event.currentTarget.valueAsNumber)}
          />
          <Button variant="secondary" onClick={onConformanceReset}>
            Reset zoom
          </Button>
        </div>
      )}
      {mode === 'benchmark' && (
        <div className="grid gap-3 rounded-md border border-border bg-surface p-3">
          <p className="eyebrow">Live workload</p>
          {workload === 'text-ladder' ? (
            <p className="font-mono text-[9px] uppercase text-muted">
              Rendered range · 8–512 device px
            </p>
          ) : (
            <Field
              label={`Rendered size · ${fontSize} device px`}
              max={96}
              min={8}
              step={1}
              type="range"
              value={fontSize}
              onChange={(event) => onFontSize(event.currentTarget.valueAsNumber)}
            />
          )}
          {workloadHasLayoutWidth(workload) && (
            <Field
              label={`Layout width · ${layoutWidthPercent}%`}
              max={100}
              min={40}
              step={2}
              type="range"
              value={layoutWidthPercent}
              onChange={(event) => onLayoutWidthPercent(event.currentTarget.valueAsNumber)}
            />
          )}
          {workloadAmountLabel(workload, workloadAmount) !== undefined && (
            <Field
              label={workloadAmountLabel(workload, workloadAmount)!}
              max={100}
              min={0}
              step={1}
              type="range"
              value={workloadAmount}
              onChange={(event) => onWorkloadAmount(event.currentTarget.valueAsNumber)}
            />
          )}
          {(workload === 'dynamic-layout' || workload === 'paint-effects') && (
            <>
              <Toggle checked={animationEnabled} label="Animate" onChange={onAnimationEnabled} />
              <Field
                label={`Animation speed · ${animationSpeed}%`}
                max={100}
                min={0}
                step={1}
                type="range"
                value={animationSpeed}
                onChange={(event) => onAnimationSpeed(event.currentTarget.valueAsNumber)}
              />
            </>
          )}
          {workload === 'dynamic-layout' && (
            <Toggle
              checked={showLayoutBounds}
              label="Show layout bounds"
              onChange={onShowLayoutBounds}
            />
          )}
          {workload === 'paint-effects' && (
            <>
              <Field
                label={`Opacity · ${paintOpacityPercent}%`}
                max={100}
                min={0}
                step={1}
                type="range"
                value={paintOpacityPercent}
                onChange={(event) => onPaintOpacityPercent(event.currentTarget.valueAsNumber)}
              />
              <Field
                disabled={technique !== 'mtsdf'}
                label={
                  technique === 'mtsdf'
                    ? `Stroke width · ${paintStrokePercent}%`
                    : 'Stroke width · unavailable for bitmap'
                }
                max={100}
                min={0}
                step={1}
                type="range"
                value={technique === 'mtsdf' ? paintStrokePercent : 0}
                onChange={(event) => onPaintStrokePercent(event.currentTarget.valueAsNumber)}
              />
              <Toggle
                checked={technique === 'mtsdf' && paintShadowEnabled}
                disabled={technique !== 'mtsdf'}
                label={technique === 'mtsdf' ? 'Shadow' : 'Shadow · unavailable for bitmap'}
                onChange={onPaintShadowEnabled}
              />
            </>
          )}
          <p className="min-h-[30px] text-[10px] leading-relaxed text-muted">
            {liveWorkloadControlDescription(workload, technique)}
          </p>
        </div>
      )}
      {mode === 'benchmark' && workload === 'advanced-shaping' && (
        <div className="grid gap-3 rounded-md border border-border bg-surface p-3">
          <p className="eyebrow">Shaping timeline</p>
          <SelectField
            label="Case"
            value={showcaseState.caseId}
            onChange={(caseId) => {
              const definition = ADVANCED_SHAPING_CASES.find((entry) => entry.id === caseId)
              if (definition !== undefined) {
                onShowcase({ kind: 'select-case', caseId: definition.id })
              }
            }}
          >
            {ADVANCED_SHAPING_CASES.map((definition) => (
              <option key={definition.id} value={definition.id}>
                {definition.label}
              </option>
            ))}
          </SelectField>
          <TextareaField
            label="Live text"
            value={showcaseFrame.text}
            onChange={(event) => onShowcase({ kind: 'edit', text: event.currentTarget.value })}
          />
          <div className="grid grid-cols-2 gap-1.5">
            <Button
              variant={showcaseState.playing ? 'primary' : 'secondary'}
              onClick={() => onShowcase({ kind: showcaseState.playing ? 'pause' : 'play' })}
            >
              {showcaseState.playing ? 'Pause' : 'Play'}
            </Button>
            <Button onClick={() => onShowcase({ kind: 'reset' })}>Reset</Button>
          </div>
          <Field
            label={`Timeline · ${showcaseFrame.tick} / ${showcaseFrame.tickCount}`}
            max={showcaseFrame.tickCount}
            min={0}
            step={1}
            type="range"
            value={showcaseFrame.tick}
            onChange={(event) =>
              onShowcase({ kind: 'seek', tick: event.currentTarget.valueAsNumber })
            }
          />
          <p className="font-mono text-[9px] leading-relaxed text-muted">
            {showcaseFrame.caseDefinition.language.toUpperCase()} ·{' '}
            {showcaseFrame.caseDefinition.direction.toUpperCase()} · WIDTH{' '}
            {(showcaseFrame.widthPermille / 10).toFixed(0)}%
          </p>
        </div>
      )}
      {mode === 'conformance' && (
        <div className="grid grid-cols-2 gap-2">
          <Field
            label="Warmup"
            min={0}
            type="number"
            value={warmup}
            onChange={(event) => onWarmup(event.currentTarget.valueAsNumber)}
          />
          <Field
            label="Samples"
            min={1}
            type="number"
            value={samples}
            onChange={(event) => onSamples(event.currentTarget.valueAsNumber)}
          />
        </div>
      )}
      <div className="rounded-md border border-border bg-surface p-3">
        <p className="eyebrow">Measurement policy</p>
        <p className="mt-2 text-[10px] leading-relaxed text-muted">
          {mode === 'benchmark'
            ? 'Tracks live frame rate, CPU submission cost, retained bytes, and backend GPU time when timestamp queries are available.'
            : 'The finite suite includes readback, reference composition, comparison, clipping, and hashing.'}
        </p>
      </div>
      <PayloadInspector fontFixture={fontFixture} liveStats={liveStats} technique={technique} />
      <a
        className="text-[9px] text-muted underline decoration-border underline-offset-4 hover:text-foreground"
        href="/font-notices.txt"
        target="_blank"
        rel="noreferrer"
      >
        Font licenses &amp; notices
      </a>
    </section>
  )
}

function PayloadInspector({
  fontFixture,
  liveStats,
  technique,
}: {
  readonly fontFixture: BenchmarkFontFixture
  readonly liveStats: LiveTextStats | undefined
  readonly technique: RasterTechnique
}) {
  if (technique === 'slug') {
    return (
      <div className="rounded-md border border-border bg-surface p-3">
        <p className="eyebrow">Selected payloads</p>
        <p className="mt-2 text-[10px] text-dim">Slug payload evidence begins in Milestone 9.</p>
      </div>
    )
  }
  const runtime = measuredPackageSize(`${technique}-runtime-js`)
  const shaper = measuredPackageSize('text-shaper-wasm')
  const bakerHost = measuredPackageSize(`${technique}-baker-js`)
  const bakerWasm = measuredPackageSize(`${technique}-baker-wasm`)
  const libraryTransferBytes = runtime.gzipBytes + shaper.gzipBytes
  const bakerTransferBytes = bakerHost.gzipBytes + bakerWasm.gzipBytes
  const bitmapStats = liveStats?.technique === 'bitmap' ? liveStats : undefined
  const mtsdfFixture = technique === 'mtsdf' ? mtsdfFixtureFor(fontFixture) : undefined
  const bitmapFixture = technique === 'bitmap' ? bitmapFixtureFor(fontFixture) : undefined
  const fontTransferBytes =
    technique === 'mtsdf' ? mtsdfFixture?.compressed.bytes : bitmapFixture?.bytes
  const textureGpuBytes =
    technique === 'mtsdf'
      ? mtsdfFixture?.raster.runtimeTextureArray.mipmappedBytes
      : (bitmapStats?.atlasGpuBytes ?? bitmapFixture?.raster.decodedGpuBytes)
  const pages =
    technique === 'mtsdf'
      ? (mtsdfFixture?.raster.pages ?? []).map((page) => ({
          key: String(page.index),
          label: `Page ${page.index + 1} · ${page.width}×${page.height}`,
          embeddedBytes: page.encodedBytes,
          gpuBytes: page.decodedGpuBytes,
        }))
      : (bitmapStats?.atlasPages ?? bitmapFixture?.raster.pages ?? []).map((page) => ({
          key: `16-${'pageIndex' in page ? page.pageIndex : page.index}`,
          label: `16 px · page ${('pageIndex' in page ? page.pageIndex : page.index) + 1} · ${page.width}×${page.height}`,
          embeddedBytes: 'encodedBytes' in page ? page.encodedBytes : undefined,
          gpuBytes: 'gpuBytes' in page ? page.gpuBytes : page.decodedGpuBytes,
        }))

  return (
    <>
      <div
        className="rounded-md border border-border bg-surface p-3"
        data-testid="payload-inspector"
      >
        <div className="flex items-center justify-between gap-2">
          <p className="eyebrow">Selected payloads</p>
          <span className="font-mono text-[8px] uppercase text-dim">download</span>
        </div>
        <div className="mt-3 grid gap-2 border-b border-border pb-3">
          <PayloadRow
            label={runtime.label}
            status="loaded"
            value={formatBytes(runtime.gzipBytes)}
          />
          <PayloadRow label={shaper.label} status="loaded" value={formatBytes(shaper.gzipBytes)} />
          <PayloadRow
            emphasis
            label="Loaded library total"
            status="loaded"
            value={formatBytes(libraryTransferBytes)}
          />
        </div>
        <div className="grid gap-2 border-b border-border py-3">
          <PayloadRow
            label={bakerHost.label}
            status="unloaded"
            value={formatBytes(bakerHost.gzipBytes)}
          />
          <PayloadRow
            label={bakerWasm.label}
            status="unloaded"
            value={formatBytes(bakerWasm.gzipBytes)}
          />
          <PayloadRow
            emphasis
            label="Optional baker total"
            status="unloaded"
            value={formatBytes(bakerTransferBytes)}
          />
        </div>
        <div className="grid gap-2 pt-3">
          <PayloadRow
            emphasis
            label="Font assets · download"
            value={formatBytes(fontTransferBytes)}
          />
          {technique === 'mtsdf' && (
            <PayloadRow
              label="Decoded font artifact · CPU"
              value={formatBytes(mtsdfFixture?.uncompressed.bytes)}
            />
          )}
        </div>
      </div>
      <div
        className="rounded-md border border-border bg-surface p-3"
        data-testid="gpu-resource-inspector"
      >
        <div className="flex items-center justify-between gap-2">
          <p className="eyebrow">GPU resources</p>
          <span className="font-mono text-[8px] uppercase text-dim">GPU memory</span>
        </div>
        <div className="mt-3 grid gap-2 pb-3">
          <PayloadRow
            emphasis
            label="Atlas texture memory · GPU"
            value={formatBytes(textureGpuBytes)}
          />
          {technique === 'mtsdf' && (
            <PayloadRow
              label="MTSDF"
              value={`${mtsdfFixture?.configuration.emSize ?? 64} px/em · ${mtsdfFixture?.configuration.pixelRange ?? 8} px range`}
            />
          )}
        </div>
        <div className="border-t border-border pt-3">
          <p className="font-mono text-[9px] uppercase text-muted">
            Texture pages · {pages.length}
          </p>
          <div className="mt-2 grid max-h-56 gap-2 overflow-auto pr-1">
            {pages.length === 0 ? (
              <p className="text-[9px] text-dim">Page dimensions appear after the font loads.</p>
            ) : (
              pages.map((page) => (
                <PayloadRow
                  key={page.key}
                  label={page.label}
                  value={`${page.embeddedBytes === undefined ? '' : `${formatBytes(page.embeddedBytes)} embedded KTX2 · `}${formatBytes(page.gpuBytes)} GPU memory`}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </>
  )
}

function PayloadRow({
  emphasis = false,
  label,
  status,
  value,
}: {
  readonly emphasis?: boolean
  readonly label: string
  readonly status?: 'loaded' | 'unloaded'
  readonly value: string
}) {
  return (
    <div className={`flex items-center gap-2 text-[10px] ${emphasis ? 'font-medium' : ''}`}>
      {status !== undefined && (
        <span
          className={`size-1.5 shrink-0 rounded-full ${status === 'loaded' ? 'bg-success' : 'bg-dim'}`}
        />
      )}
      <span className={emphasis ? 'text-foreground' : 'text-muted'}>{label}</span>
      {status !== undefined && (
        <span className="font-mono text-[8px] uppercase text-dim">{status}</span>
      )}
      <span className="ml-auto whitespace-nowrap font-mono text-dim">{value}</span>
    </div>
  )
}

interface MeasuredPackageSize {
  readonly id: string
  readonly label: string
  readonly status: string
  readonly gzipBytes: number
}

function measuredPackageSize(id: string): MeasuredPackageSize {
  const entry = packageSizes.entries.find((candidate) => candidate.id === id)
  if (entry?.status !== 'measured') throw new Error(`Missing measured package size: ${id}`)
  return entry
}

function MobileSheet({
  children,
  title,
  onClose,
}: {
  readonly children: ReactNode
  readonly title: string
  readonly onClose: () => void
}) {
  return (
    <section className="fixed inset-x-0 bottom-[58px] z-20 max-h-[calc(100vh-86px)] overflow-auto rounded-t-xl border border-border bg-chrome p-4 shadow-2xl">
      <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border" />
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">{title}</h1>
        <Button aria-label="Close controls" onClick={onClose}>
          ×
        </Button>
      </div>
      {children}
    </section>
  )
}

function MobileNavigation({
  location,
  onLocation,
}: {
  readonly location: HarnessLocation
  readonly onLocation: (value: Partial<HarnessLocation>) => void
}) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 grid h-[58px] grid-cols-4 border-t border-border bg-chrome p-2 min-[1200px]:hidden">
      {(['scene', 'controls', 'report', 'export'] as const).map((view) => (
        <button
          className={`rounded-md font-mono text-[10px] capitalize ${location.view === view ? 'bg-surface-active text-foreground' : 'text-dim'}`}
          key={view}
          type="button"
          onClick={() => onLocation({ view })}
        >
          {view}
        </button>
      ))}
    </nav>
  )
}
