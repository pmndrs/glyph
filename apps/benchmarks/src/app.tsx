import {
  Suspense,
  use,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type ReactNode,
} from 'react'

import {
  BENCHMARK_IPSUM_INTER_GLYPH_COUNT,
  BENCHMARK_IPSUM_TEXT,
} from './benchmark/benchmark-ipsum'
import {
  ADVANCED_SHAPING_CASES,
  advanceAdvancedShaping,
  advancedShapingFrame,
  initialAdvancedShapingState,
  updateAdvancedShaping,
  type AdvancedShapingCommand,
  type AdvancedShapingFrame,
  type AdvancedShapingFontFixture,
  type AdvancedShapingState,
} from './benchmark/advanced-shaping'
import type { BenchmarkSummary, RunnerEvent } from './benchmark/contracts'
import { environmentResource } from './benchmark/environment'
import { runRegisteredBenchmark } from './benchmark/execution'
import { captureBitmapTextStats, type LiveBenchmarkCapture } from './benchmark/product-result'
import {
  readHarnessLocation,
  writeHarnessLocation,
  type GraphicsBackend,
  type HarnessLocation,
  type HarnessMode,
} from './benchmark/url-state'
import { ExportPanel } from './components/export-panel'
import { Report } from './components/report'
import { Button, Chip, Field, Metric, SelectField, TextareaField, Toggle } from './components/ui'
import packageSizes from './generated/package-sizes.json'
import type {
  BitmapTextConformanceCapture,
  BitmapTextLiveStats,
  BitmapTextPreview,
  BitmapTextPreviewUpdate,
} from './renderer/bitmap-text'

interface WorkloadOption {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly available: boolean
}

interface LiveTextConfiguration extends Omit<BitmapTextPreviewUpdate, 'fontSize'> {
  readonly fontFixture: AdvancedShapingFontFixture
  readonly expectedGlyphCount: number | undefined
  readonly timelineTick: number | undefined
}

const EMPTY_FONT_FEATURES: BitmapTextPreviewUpdate['features'] = []
const showcaseFontLabels: Readonly<Record<AdvancedShapingFontFixture, string>> = {
  inter: 'Inter Regular 4.1',
  amiri: 'Amiri Regular 1.002',
  'noto-sans-devanagari': 'Noto Sans Devanagari',
  'dot-gothic-16': 'DotGothic16 Japanese',
}

const benchmarkWorkloads: readonly WorkloadOption[] = [
  {
    id: 'benchmark-ipsum',
    label: 'Benchmark ipsum',
    description: 'Paragraph-scale native-strike text with continuous rendering.',
    available: true,
  },
  {
    id: 'advanced-shaping',
    label: 'Advanced shaping',
    description: 'Editable deterministic playback across complex shaping and line breaking.',
    available: true,
  },
  {
    id: 'text-ladder',
    label: 'Text ladder',
    description: 'Native and scaled strike quality across screen-space sizes.',
    available: false,
  },
  {
    id: 'off-axis-3d',
    label: 'Off-axis / 3D',
    description: 'Perspective transforms and oblique sampling.',
    available: false,
  },
  {
    id: 'dynamic-layout',
    label: 'Dynamic layout',
    description: 'Continuous container reflow and authoritative reshaping.',
    available: false,
  },
  {
    id: 'paragraph-stress',
    label: 'Paragraph stress',
    description: 'High-volume layout, batching, and memory pressure.',
    available: false,
  },
]

const conformanceWorkloads: readonly WorkloadOption[] = [
  {
    id: 'bitmap-frame',
    label: 'Bitmap frame',
    description: 'Candidate, CPU reference, exact difference, resize, and clipping checks.',
    available: true,
  },
]

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
  const [summary, setSummary] = useState<BenchmarkSummary>()
  const [event, setEvent] = useState<RunnerEvent>()
  const [liveStats, setLiveStats] = useState<BitmapTextLiveStats>()
  const [liveCapture, setLiveCapture] = useState<LiveBenchmarkCapture>()
  const [error, setError] = useState<string>()
  const [dpr, setDpr] = useState<1 | 2>(defaultDeviceDpr)
  const [samples, setSamples] = useState(3)
  const [warmup, setWarmup] = useState(1)
  const [showGrid, setShowGrid] = useState(true)
  const [fontSize, setFontSize] = useState(16)
  const [layoutWidthPercent, setLayoutWidthPercent] = useState(82)
  const [showcaseState, setShowcaseState] = useState(initialAdvancedShapingState)
  const [isPending, startTransition] = useTransition()

  const workload = workloadById(location.mode, location.workload)
  const showcaseFrame = advancedShapingFrame(showcaseState)
  const available = location.technique === 'bitmap' && workload.available
  const backendAvailable = location.backend !== 'webgpu' || environment.webgpu

  function setLocation(next: Partial<HarnessLocation>): void {
    const value = { ...location, ...next }
    if (
      next.mode !== undefined ||
      next.technique !== undefined ||
      next.backend !== undefined ||
      next.workload !== undefined
    ) {
      setLiveStats(undefined)
      setSummary(undefined)
      setLiveCapture(undefined)
    }
    setLocationState(value)
    globalThis.history?.replaceState(null, '', writeHarnessLocation(value))
  }

  function selectMode(mode: HarnessMode): void {
    setLocation({
      mode,
      workload: mode === 'benchmark' ? 'benchmark-ipsum' : 'bitmap-frame',
      view: 'scene',
    })
  }

  function runConformance(): void {
    setError(undefined)
    startTransition(async () => {
      try {
        const value = await runRegisteredBenchmark({
          targetId: `bitmap-text-${location.backend}`,
          scenarioId: 'bitmap-text-frame',
          input: {},
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
      environment,
      stats: captureBitmapTextStats(liveStats),
    })
  }

  function dispatchShowcase(command: AdvancedShapingCommand): void {
    setShowcaseState((state) => updateAdvancedShaping(state, command))
    setLiveCapture(undefined)
  }

  const advanceShowcase = useEffectEvent(() => {
    setShowcaseState((state) => advanceAdvancedShaping(state))
  })
  useEffect(() => {
    if (!showcaseState.playing || showcaseState.editedText !== undefined) return
    let animationFrame = 0
    let lastTickAt = performance.now()
    const animate = (timestamp: number): void => {
      if (timestamp - lastTickAt >= 140) {
        advanceShowcase()
        lastTickAt = timestamp
      }
      animationFrame = requestAnimationFrame(animate)
    }
    animationFrame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(animationFrame)
  }, [showcaseState.editedText, showcaseState.playing])

  const controls = (
    <Controls
      backend={location.backend}
      dpr={dpr}
      mode={location.mode}
      workload={location.workload}
      showcaseFrame={showcaseFrame}
      showcaseState={showcaseState}
      fontSize={fontSize}
      layoutWidthPercent={layoutWidthPercent}
      samples={samples}
      showGrid={showGrid}
      warmup={warmup}
      webgpu={environment.webgpu}
      onBackend={(backend) => setLocation({ backend })}
      onDpr={(value) => {
        setDpr(value)
        setLiveStats(undefined)
        setSummary(undefined)
        setLiveCapture(undefined)
      }}
      onFontSize={(value) => {
        setFontSize(value)
        setLiveCapture(undefined)
      }}
      onLayoutWidthPercent={(value) => {
        setLayoutWidthPercent(value)
        setLiveCapture(undefined)
      }}
      onSamples={setSamples}
      onShowcase={dispatchShowcase}
      onShowGrid={setShowGrid}
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
            location={location}
            showcaseFrame={showcaseFrame}
            onLocation={setLocation}
          />
          <main className="min-w-0 overflow-auto border-r border-border bg-background p-4">
            <Scene
              dpr={dpr}
              error={error}
              event={event}
              grid={showGrid}
              liveCapture={liveCapture}
              liveStats={liveStats}
              location={location}
              fontSize={fontSize}
              layoutWidthPercent={layoutWidthPercent}
              summary={summary}
              showcaseFrame={showcaseFrame}
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
                dpr={dpr}
                error={error}
                event={event}
                grid={showGrid}
                liveCapture={liveCapture}
                liveStats={liveStats}
                location={location}
                fontSize={fontSize}
                layoutWidthPercent={layoutWidthPercent}
                summary={summary}
                showcaseFrame={showcaseFrame}
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

function workloadById(mode: HarnessMode, id: string): WorkloadOption {
  const workloads = mode === 'benchmark' ? benchmarkWorkloads : conformanceWorkloads
  return workloads.find((workload) => workload.id === id) ?? workloads[0]!
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
            className={`min-h-7 rounded px-2 py-1.5 text-[10px] capitalize sm:px-3 sm:text-[11px] ${mode === value ? 'bg-surface-active text-foreground' : 'text-dim'}`}
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
  location,
  showcaseFrame,
  onLocation,
}: {
  readonly location: HarnessLocation
  readonly showcaseFrame: AdvancedShapingFrame
  readonly onLocation: (value: Partial<HarnessLocation>) => void
}) {
  const workloads = location.mode === 'benchmark' ? benchmarkWorkloads : conformanceWorkloads
  return (
    <aside className="overflow-auto border-r border-border bg-chrome p-3">
      <p className="eyebrow">Technique</p>
      <div className="mt-2 grid grid-cols-3 gap-1">
        {(['bitmap', 'mtsdf', 'slug'] as const).map((technique) => (
          <button
            className={`rounded-md border px-2 py-2 text-[10px] capitalize ${location.technique === technique ? 'border-accent bg-surface-active' : 'border-border bg-surface text-dim'}`}
            disabled={technique !== 'bitmap'}
            key={technique}
            type="button"
            onClick={() => onLocation({ technique })}
          >
            {technique}
          </button>
        ))}
      </div>
      <p className="eyebrow mb-2 mt-5">
        {location.mode === 'benchmark' ? 'Live workloads' : 'Conformance checks'}
      </p>
      <nav className="grid gap-1">
        {workloads.map((workload) => (
          <button
            className={`relative rounded-md px-4 py-3 text-left ${location.workload === workload.id ? 'bg-surface-active text-foreground' : 'text-muted hover:bg-surface'} disabled:cursor-not-allowed disabled:opacity-40`}
            disabled={!workload.available}
            key={workload.id}
            type="button"
            onClick={() => onLocation({ workload: workload.id })}
          >
            <span
              className={`absolute left-1.5 top-3 h-4 w-[3px] rounded-full ${location.workload === workload.id ? 'bg-accent' : 'bg-border'}`}
            />
            <span className="block text-xs">{workload.label}</span>
            <span className="mt-1 block font-mono text-[8px] leading-relaxed text-dim">
              {workload.available ? workload.description : `PLANNED · ${workload.description}`}
            </span>
          </button>
        ))}
      </nav>
      <div className="mt-5 rounded-md border border-border bg-surface p-3">
        <p className="eyebrow">Pinned fixture</p>
        <p className="mt-2 text-xs">
          {location.workload === 'advanced-shaping'
            ? showcaseFontLabels[showcaseFrame.caseDefinition.fontFixture]
            : 'Inter Regular 4.1'}
        </p>
        <p className="mt-1 font-mono text-[9px] text-dim">16 px grayscale bitmap strike</p>
      </div>
    </aside>
  )
}

function Scene({
  dpr,
  error,
  event,
  fontSize,
  grid,
  layoutWidthPercent,
  liveCapture,
  liveStats,
  location,
  showcaseFrame,
  summary,
  onLiveStats,
}: {
  readonly dpr: 1 | 2
  readonly error: string | undefined
  readonly event: RunnerEvent | undefined
  readonly fontSize: number
  readonly grid: boolean
  readonly layoutWidthPercent: number
  readonly liveCapture: LiveBenchmarkCapture | undefined
  readonly liveStats: BitmapTextLiveStats | undefined
  readonly location: HarnessLocation
  readonly showcaseFrame: AdvancedShapingFrame
  readonly summary: BenchmarkSummary | undefined
  readonly onLiveStats: (stats: BitmapTextLiveStats) => void
}) {
  const workload = workloadById(location.mode, location.workload)
  const liveFontFixture =
    location.workload === 'advanced-shaping' ? showcaseFrame.caseDefinition.fontFixture : 'inter'
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
          <Chip tone="accent">Bitmap</Chip>
          <Chip>{location.backend === 'webgpu' ? 'WebGPU' : 'WebGL2 fallback'}</Chip>
          <Chip>{dpr}× DPR</Chip>
        </div>
      </header>
      {location.mode === 'benchmark' ? (
        <BenchmarkSurface
          backend={location.backend}
          dpr={dpr}
          fontSize={fontSize}
          grid={grid}
          layoutWidthPercent={layoutWidthPercent}
          key={`${location.backend}-${String(dpr)}-${liveFontFixture}`}
          showcaseFrame={showcaseFrame}
          stats={liveStats}
          workload={location.workload}
          onStats={onLiveStats}
        />
      ) : (
        <ConformanceSurface
          backend={location.backend}
          dpr={dpr}
          event={event}
          key={`${location.backend}-${String(dpr)}`}
          summary={summary}
        />
      )}
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

function BenchmarkSurface({
  backend,
  dpr,
  fontSize,
  grid,
  layoutWidthPercent,
  showcaseFrame,
  stats,
  workload,
  onStats,
}: {
  readonly backend: GraphicsBackend
  readonly dpr: 1 | 2
  readonly fontSize: number
  readonly grid: boolean
  readonly layoutWidthPercent: number
  readonly showcaseFrame: AdvancedShapingFrame
  readonly stats: BitmapTextLiveStats | undefined
  readonly workload: string
  readonly onStats: (stats: BitmapTextLiveStats) => void
}) {
  const advanced = workload === 'advanced-shaping'
  const textConfiguration: LiveTextConfiguration = advanced
    ? {
        direction: showcaseFrame.caseDefinition.direction,
        expectedGlyphCount: undefined,
        features: showcaseFrame.caseDefinition.features,
        fontFixture: showcaseFrame.caseDefinition.fontFixture,
        language: showcaseFrame.caseDefinition.language,
        layoutWidthRatio: showcaseFrame.widthPermille / 1000,
        text: showcaseFrame.text,
        timelineTick: showcaseFrame.tick,
      }
    : {
        direction: 'ltr',
        expectedGlyphCount: BENCHMARK_IPSUM_INTER_GLYPH_COUNT,
        features: EMPTY_FONT_FEATURES,
        fontFixture: 'inter',
        language: 'en',
        layoutWidthRatio: layoutWidthPercent / 100,
        text: BENCHMARK_IPSUM_TEXT,
        timelineTick: undefined,
      }
  return (
    <div className="grid min-h-0 grid-rows-[auto_auto_minmax(360px,1fr)] gap-3">
      <div className="grid grid-cols-2 overflow-hidden rounded-md border border-border bg-surface md:grid-cols-4">
        <Metric
          label="Live FPS"
          value={stats === undefined ? '—' : stats.framesPerSecond.toFixed(1)}
        />
        <Metric label="CPU frame submit" value={formatMs(stats?.medianSubmitMs)} />
        <Metric
          label="GPU frame"
          value={
            stats?.gpuFrameMs === undefined
              ? stats?.gpuTimingSupported === true
                ? 'resolving'
                : 'unavailable'
              : formatMs(stats.gpuFrameMs)
          }
        />
        <Metric
          label="Glyphs / draws"
          value={stats === undefined ? '—' : `${stats.glyphCount} / ${stats.drawCount}`}
        />
      </div>
      <div className="grid gap-3 xl:grid-cols-[1.15fr_1fr]">
        <div className="grid grid-cols-2 overflow-hidden rounded-md border border-border bg-surface sm:grid-cols-3">
          <LiveCost label="Renderer init" value={formatMs(stats?.rendererInitMs)} />
          <LiveCost label="Font fetch + register" value={formatMs(stats?.fontLoadMs)} />
          <LiveCost label="Text ready" value={formatMs(stats?.textReadyMs)} />
          <LiveCost label="First draw submit" value={formatMs(stats?.firstDrawMs)} />
          <LiveCost label="Total startup" value={formatMs(stats?.startupMs)} />
          <LiveCost
            label="Artifact / GPU"
            value={`${formatBytes(stats?.artifactBytes)} / ${formatBytes(stats?.totalGpuBytes)}`}
          />
        </div>
        <div className="grid grid-cols-3 gap-px overflow-hidden rounded-md border border-border bg-border">
          <Sparkline
            label="CPU frame ms"
            length={stats?.submitHistoryLength ?? 0}
            nextIndex={stats?.submitHistoryNextIndex ?? 0}
            values={stats?.submitHistory}
          />
          <Sparkline
            label="FPS"
            length={stats?.fpsHistoryLength ?? 0}
            nextIndex={stats?.fpsHistoryNextIndex ?? 0}
            values={stats?.fpsHistory}
          />
          <Sparkline
            emptyLabel={
              stats?.gpuTimingSupported === true ? 'Resolving GPU timing' : 'GPU timing unavailable'
            }
            label="GPU frame ms"
            length={stats?.gpuHistoryLength ?? 0}
            nextIndex={stats?.gpuHistoryNextIndex ?? 0}
            values={stats?.gpuHistory}
          />
        </div>
      </div>
      <div className="flex min-h-0 flex-col rounded-md border border-border bg-surface p-3">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <p className="eyebrow">Realtime scene</p>
            <p className="mt-1 text-xs text-muted">
              {advanced
                ? `${showcaseFrame.caseDefinition.label} reshapes at exact timeline states while the live viewport reflows.`
                : 'Paragraph-scale text renders continuously and reflows with its live viewport.'}
            </p>
          </div>
          <span className="shrink-0 font-mono text-[9px] text-success">LIVE</span>
        </div>
        <BitmapTextViewport
          backend={backend}
          dpr={dpr}
          fontSize={fontSize}
          grid={grid}
          textConfiguration={textConfiguration}
          onStats={onStats}
        />
      </div>
    </div>
  )
}

function ConformanceSurface({
  backend,
  dpr,
  event,
  summary,
}: {
  readonly backend: GraphicsBackend
  readonly dpr: 1 | 2
  readonly event: RunnerEvent | undefined
  readonly summary: BenchmarkSummary | undefined
}) {
  const [capture, setCapture] = useState<BitmapTextConformanceCapture>()
  const [error, setError] = useState<string>()
  const publishCapture = useEffectEvent((value: BitmapTextConformanceCapture) => {
    setCapture(value)
    setError(undefined)
  })
  const publishError = useEffectEvent((caught: unknown) => {
    if (caught instanceof DOMException && caught.name === 'AbortError') return
    setError(caught instanceof Error ? caught.message : String(caught))
  })
  useEffect(() => {
    const controller = new AbortController()
    void import('./renderer/bitmap-text')
      .then(({ captureBitmapTextConformance }) =>
        captureBitmapTextConformance({ backend, dpr, signal: controller.signal }),
      )
      .then(publishCapture)
      .catch(publishError)
    return () => controller.abort()
  }, [backend, dpr])

  return (
    <div className="grid min-h-0 grid-rows-[auto_minmax(360px,1fr)_auto] gap-3">
      <div className="grid grid-cols-2 overflow-hidden rounded-md border border-border bg-surface md:grid-cols-4">
        <Metric
          label="Reference mismatch"
          value={capture === undefined ? '—' : String(capture.mismatchBytes)}
        />
        <Metric
          label="Half-coverage ink"
          value={capture === undefined ? '—' : String(capture.inkPixels)}
        />
        <Metric label="Render submit (diagnostic)" value={formatMs(capture?.renderSubmitMs)} />
        <Metric label="Suite duration" value={formatMs(summary?.medianMs ?? event?.medianMs)} />
      </div>
      <div className="grid min-h-0 gap-3 xl:grid-cols-3">
        <PixelPanel capture={capture} kind="candidate" label="Candidate" />
        <PixelPanel capture={capture} kind="reference" label="CPU reference" />
        <PixelPanel capture={capture} kind="difference" label="Difference ×1" />
      </div>
      <div className="rounded-md border border-border bg-surface p-3">
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`size-2 rounded-full ${summary?.status === 'passed' ? 'bg-success' : 'bg-dim'}`}
          />
          <span className="font-medium">Finite conformance suite</span>
          <span className="ml-auto font-mono text-[10px] text-muted">
            {summary?.validation ?? 'Run conformance to test full-frame and clipped output.'}
          </span>
        </div>
        <p className="mt-2 text-[10px] text-dim">
          End-to-end suite duration includes readback, CPU composition, comparison, clipping, and
          hashing. It is test cost, not renderer performance.
        </p>
      </div>
      {error !== undefined && <p className="text-xs text-danger">{error}</p>}
    </div>
  )
}

function PixelPanel({
  capture,
  kind,
  label,
}: {
  readonly capture: BitmapTextConformanceCapture | undefined
  readonly kind: 'candidate' | 'reference' | 'difference'
  readonly label: string
}) {
  function drawCapture(canvas: HTMLCanvasElement | null): void {
    if (canvas === null || capture === undefined) return
    canvas.width = capture.width
    canvas.height = capture.height
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('Unable to create conformance inspection canvas')
    context.putImageData(
      new ImageData(new Uint8ClampedArray(capture[kind]), capture.width, capture.height),
      0,
      0,
    )
  }
  return (
    <figure className="flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-panel">
      <figcaption className="border-b border-border px-3 py-2 font-mono text-[9px] uppercase tracking-wider text-muted">
        {label}
      </figcaption>
      <div className="grid min-h-[240px] flex-1 place-items-center overflow-hidden p-3">
        {capture === undefined ? (
          <span className="font-mono text-[9px] text-dim">GENERATING</span>
        ) : (
          <canvas
            className="h-auto max-h-full w-full [image-rendering:pixelated]"
            ref={drawCapture}
          />
        )}
      </div>
    </figure>
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
  const [error, setError] = useState<string>()
  const {
    direction,
    expectedGlyphCount,
    features,
    fontFixture,
    language,
    layoutWidthRatio,
    text,
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
    direction,
    expectedGlyphCount,
    features,
    fontFixture,
    fontSize: fontSize / dpr,
    language,
    layoutWidthRatio,
    text,
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
        backend,
        canvas,
        dpr,
        ...(configuration.expectedGlyphCount === undefined
          ? {}
          : { expectedGlyphCount: configuration.expectedGlyphCount }),
        fontFixture: configuration.fontFixture,
        fontSize: configuration.fontSize,
        height: Math.max(1, bounds.height),
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
    const preview = previewRef.current
    if (preview === undefined) return
    void preview
      .update({
        fontSize: fontSize / dpr,
        layoutWidthRatio,
        text,
        language,
        direction,
        features,
      })
      .then((snapshot) => {
        publishSettledRevision(snapshot.revision)
        publishSettledTimelineTick(timelineTick)
        publishSettledTextLength(text.length)
      })
      .catch(publishError)
  }, [direction, dpr, features, fontSize, language, layoutWidthRatio, text, timelineTick])

  return (
    <div
      className={`benchmark-grid relative min-h-[360px] flex-1 overflow-hidden rounded border border-border bg-panel ${grid ? 'is-visible' : ''}`}
      data-layout-width={stats?.layoutWidth}
      data-line-count={stats?.lineCount}
      data-glyph-count={stats?.glyphCount}
      data-missing-glyph-count={stats?.missingGlyphCount}
      data-settled-revision={settledRevision}
      data-settled-text-length={settledTextLength}
      data-settled-tick={settledTimelineTick}
      data-backend={stats?.backend}
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

function LiveCost({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="border-b border-r border-border px-3 py-2 last:border-r-0">
      <p className="font-mono text-[8px] uppercase tracking-wider text-dim">{label}</p>
      <p className="mt-1 font-mono text-[11px] text-foreground">{value}</p>
    </div>
  )
}

function Sparkline({
  emptyLabel,
  label,
  length,
  nextIndex,
  values,
}: {
  readonly emptyLabel?: string
  readonly label: string
  readonly length: number
  readonly nextIndex: number
  readonly values: Float32Array | undefined
}) {
  function draw(canvas: HTMLCanvasElement | null): void {
    if (canvas === null || values === undefined || length === 0) return
    const context = canvas.getContext('2d')
    if (context === null) return
    const width = canvas.width
    const height = canvas.height
    let maximum = 1
    const start = length === values.length ? nextIndex : 0
    for (let index = 0; index < length; index += 1) {
      maximum = Math.max(maximum, values[(start + index) % values.length] ?? 0)
    }
    context.clearRect(0, 0, width, height)
    context.beginPath()
    for (let index = 0; index < length; index += 1) {
      const value = values[(start + index) % values.length] ?? 0
      const x = length < 2 ? 0 : (index / (length - 1)) * width
      const y = height - (value / maximum) * (height - 4) - 2
      if (index === 0) context.moveTo(x, y)
      else context.lineTo(x, y)
    }
    context.strokeStyle = getComputedStyle(canvas).getPropertyValue('--cyan')
    context.lineWidth = 1.5
    context.stroke()
  }
  return (
    <div className="bg-surface p-3">
      <p className="font-mono text-[8px] uppercase tracking-wider text-dim">{label}</p>
      <div className="relative mt-2 h-[42px] w-full">
        <canvas
          aria-label={`${label} history`}
          className="absolute inset-0 size-full"
          height={42}
          ref={draw}
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

function Controls({
  backend,
  dpr,
  fontSize,
  layoutWidthPercent,
  mode,
  workload,
  samples,
  showcaseFrame,
  showcaseState,
  showGrid,
  warmup,
  webgpu,
  onBackend,
  onDpr,
  onFontSize,
  onLayoutWidthPercent,
  onSamples,
  onShowcase,
  onShowGrid,
  onWarmup,
}: {
  readonly backend: GraphicsBackend
  readonly dpr: 1 | 2
  readonly fontSize: number
  readonly layoutWidthPercent: number
  readonly mode: HarnessMode
  readonly workload: string
  readonly samples: number
  readonly showcaseFrame: AdvancedShapingFrame
  readonly showcaseState: AdvancedShapingState
  readonly showGrid: boolean
  readonly warmup: number
  readonly webgpu: boolean
  readonly onBackend: (backend: GraphicsBackend) => void
  readonly onDpr: (dpr: 1 | 2) => void
  readonly onFontSize: (value: number) => void
  readonly onLayoutWidthPercent: (value: number) => void
  readonly onSamples: (value: number) => void
  readonly onShowcase: (command: AdvancedShapingCommand) => void
  readonly onShowGrid: (value: boolean) => void
  readonly onWarmup: (value: number) => void
}) {
  return (
    <section className="grid gap-4" data-testid="controls">
      <div>
        <p className="eyebrow">Inspection controls</p>
        <h2 className="mt-1 text-base font-semibold">Render configuration</h2>
      </div>
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
      {mode === 'benchmark' && (
        <div className="grid gap-3 rounded-md border border-border bg-surface p-3">
          <p className="eyebrow">Live workload</p>
          <Field
            label={`Rendered size · ${fontSize} device px`}
            max={24}
            min={12}
            step={1}
            type="range"
            value={fontSize}
            onChange={(event) => onFontSize(event.currentTarget.valueAsNumber)}
          />
          {workload !== 'advanced-shaping' && (
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
          <p className="text-[10px] leading-relaxed text-muted">
            {workload === 'advanced-shaping'
              ? 'The authored timeline changes layout width and commits exact paragraph states.'
              : 'Resizing the scene or changing its layout width commits a new paragraph reflow.'}
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
          <div className="grid grid-cols-4 gap-1.5">
            <Button onClick={() => onShowcase({ kind: 'step', ticks: -1 })}>−1</Button>
            <Button
              variant={showcaseState.playing ? 'primary' : 'secondary'}
              onClick={() => onShowcase({ kind: showcaseState.playing ? 'pause' : 'play' })}
            >
              {showcaseState.playing ? 'Pause' : 'Play'}
            </Button>
            <Button onClick={() => onShowcase({ kind: 'step', ticks: 1 })}>+1</Button>
            <Button onClick={() => onShowcase({ kind: 'restore-authored-text' })}>Reset</Button>
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
      <div className="border-y border-border py-2">
        <Toggle checked={showGrid} label="Show canvas grid" onChange={onShowGrid} />
      </div>
      <div className="rounded-md border border-border bg-surface p-3">
        <p className="eyebrow">Measurement policy</p>
        <p className="mt-2 text-[10px] leading-relaxed text-muted">
          {mode === 'benchmark'
            ? 'Tracks live frame rate, CPU submission cost, retained bytes, and backend GPU time when timestamp queries are available.'
            : 'The finite suite includes readback, reference composition, comparison, clipping, and hashing.'}
        </p>
      </div>
      <div className="rounded-md border border-border bg-surface p-3">
        <p className="eyebrow">Selected payloads</p>
        <div className="mt-2 grid gap-2">
          {packageSizes.entries
            .filter((entry) =>
              ['browser-core', 'text-shaper-wasm', 'font-baker-wasm'].includes(entry.id),
            )
            .map((entry) => (
              <div className="flex items-center gap-2 text-[10px]" key={entry.id}>
                <span className="truncate text-muted">{entry.label}</span>
                <span className="ml-auto font-mono text-dim">{formatBytes(entry.rawBytes)}</span>
              </div>
            ))}
        </div>
      </div>
    </section>
  )
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
