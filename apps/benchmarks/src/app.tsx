import { Suspense, use, useState, useTransition, type ReactNode } from 'react'
import type { BenchmarkSummary, RunnerEvent } from './benchmark/contracts'
import { environmentResource } from './benchmark/environment'
import { defaultControls, runRegisteredBenchmark } from './benchmark/execution'
import { missingCapabilities } from './benchmark/runner'
import { plannedScenarios, scenarioById, scenarios } from './benchmark/scenarios'
import { targetById, targets } from './benchmark/targets'
import {
  readHarnessLocation,
  writeHarnessLocation,
  type HarnessLocation,
} from './benchmark/url-state'
import { ExportPanel } from './components/export-panel'
import { Report } from './components/report'
import { Button, Chip, Field, Metric, SelectField, Toggle } from './components/ui'

const sampleSizes = [8, 10, 12, 16, 24, 32, 48, 72, 96] as const

function formatMs(value: number | undefined): string {
  return value === undefined ? '—' : `${value.toFixed(2)} ms`
}

function ShellFallback() {
  return (
    <div className="grid min-h-screen place-items-center bg-background text-sm text-muted">
      Loading harness…
    </div>
  )
}

export function App() {
  return (
    <Suspense fallback={<ShellFallback />}>
      <Harness />
    </Suspense>
  )
}

function Harness() {
  const environment = use(environmentResource())
  const [location, setLocationState] = useState(() => readHarnessLocation(locationSearch()))
  const [fontBytes, setFontBytes] = useState<Uint8Array>()
  const [fontName, setFontName] = useState('Inter Regular 4.1 · canonical')
  const [summary, setSummary] = useState<BenchmarkSummary>()
  const [event, setEvent] = useState<RunnerEvent>()
  const [error, setError] = useState<string>()
  const [samples, setSamples] = useState(defaultControls.samples)
  const [warmup, setWarmup] = useState(defaultControls.warmup)
  const [showGrid, setShowGrid] = useState(true)
  const [isPending, startTransition] = useTransition()

  const target = targetById(location.target)
  const scenario = scenarioById(location.scenario)
  const input = fontBytes === undefined ? {} : { fontBytes }
  const targetStatus = target.status(input)
  const missing = missingCapabilities(target, scenario)
  const ready = targetStatus === 'ready' && missing.length === 0 && !isPending

  function setLocation(next: Partial<HarnessLocation>): void {
    const value = { ...location, ...next }
    setLocationState(value)
    globalThis.history?.replaceState(null, '', writeHarnessLocation(value))
  }

  function run(): void {
    setError(undefined)
    startTransition(async () => {
      try {
        const value = await runRegisteredBenchmark({
          targetId: target.id,
          scenarioId: scenario.id,
          input,
          controls: { samples, warmup },
          environment,
          onEvent: setEvent,
        })
        setSummary(value)
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught))
      }
    })
  }

  async function loadFont(file: File | undefined): Promise<void> {
    if (file === undefined) return
    setFontName(file.name)
    setFontBytes(new Uint8Array(await file.arrayBuffer()))
  }

  const controls = (
    <Controls
      fontName={fontName}
      samples={samples}
      showGrid={showGrid}
      warmup={warmup}
      onFont={loadFont}
      onSamples={setSamples}
      onShowGrid={setShowGrid}
      onWarmup={setWarmup}
    />
  )

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopBar
        environmentLabel={environment.webgpu ? 'WebGPU available' : 'WebGPU unavailable'}
        pending={isPending}
        ready={ready}
        samples={samples}
        onRun={run}
      />
      <div className="hidden h-[calc(100vh-52px)] min-h-[680px] grid-cols-[240px_minmax(560px,1fr)_300px] lg:grid">
        <ScenarioRail fontName={fontName} location={location} onLocation={setLocation} />
        <main className="min-w-0 overflow-auto border-r border-border bg-background p-4">
          <Scene
            error={error}
            event={event}
            grid={showGrid}
            location={location}
            summary={summary}
            onLocation={setLocation}
          />
        </main>
        <aside className="overflow-auto bg-chrome p-4">{controls}</aside>
      </div>
      <div className="pb-[58px] lg:hidden">
        <main className="min-h-[calc(100vh-110px)] p-3">
          {location.view === 'scene' && (
            <Scene
              error={error}
              event={event}
              grid={showGrid}
              location={location}
              summary={summary}
              onLocation={setLocation}
            />
          )}
          {location.view === 'controls' && (
            <MobileSheet title="Controls" onClose={() => setLocation({ view: 'scene' })}>
              {controls}
              <Button
                className="mt-3 h-10 w-full"
                disabled={!ready}
                variant="primary"
                onClick={run}
              >
                Run suite
              </Button>
            </MobileSheet>
          )}
          {location.view === 'report' && <Report summary={summary} />}
          {location.view === 'export' && <ExportPanel summary={summary} />}
        </main>
        <MobileNavigation location={location} onLocation={setLocation} />
      </div>
    </div>
  )
}

function locationSearch(): string {
  return typeof globalThis.location === 'undefined' ? '' : globalThis.location.search
}

function TopBar({
  environmentLabel,
  pending,
  ready,
  samples,
  onRun,
}: {
  readonly environmentLabel: string
  readonly pending: boolean
  readonly ready: boolean
  readonly samples: number
  readonly onRun: () => void
}) {
  return (
    <header className="flex h-[52px] items-center gap-2 border-b border-border bg-chrome px-3 lg:px-4">
      <div className="grid size-7 place-items-center rounded-md bg-accent font-serif text-lg">
        a
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold leading-none">pmndrs/text</div>
        <div className="mt-1 font-mono text-[9px] text-dim">BENCHMARK HARNESS</div>
      </div>
      <div className="flex-1" />
      <div className="hidden items-center gap-2 md:flex">
        <Chip tone={environmentLabel.includes('available') ? 'success' : 'warning'}>
          {environmentLabel}
        </Chip>
        <Chip tone="accent">warm · {samples} samples</Chip>
        <Chip>working tree</Chip>
      </div>
      <Button disabled={!ready} variant="primary" onClick={onRun}>
        {pending ? 'Running…' : 'Run suite'}
      </Button>
    </header>
  )
}

function ScenarioRail({
  fontName,
  location,
  onLocation,
}: {
  readonly fontName: string
  readonly location: HarnessLocation
  readonly onLocation: (value: Partial<HarnessLocation>) => void
}) {
  return (
    <aside className="overflow-auto border-r border-border bg-chrome p-3">
      <p className="eyebrow">Fixture</p>
      <div className="mt-2 rounded-md border border-border bg-surface p-2.5">
        <div className="text-xs font-medium">Font fixture</div>
        <div className="mt-1 truncate font-mono text-[9px] text-dim">{fontName}</div>
      </div>
      <p className="eyebrow mb-2 mt-4">Scenarios</p>
      <nav className="grid gap-1">
        {scenarios.map((scenario) => (
          <RailButton
            active={location.scenario === scenario.id}
            key={scenario.id}
            label={scenario.label}
            onClick={() => onLocation({ scenario: scenario.id })}
          />
        ))}
        {plannedScenarios.map((label) => (
          <RailButton disabled key={label} label={label} />
        ))}
      </nav>
      <p className="eyebrow mb-2 mt-4">Targets</p>
      <div className="grid gap-2">
        {targets.map((target) => (
          <button
            className={`rounded-md border p-2 text-left transition-colors ${
              location.target === target.id
                ? 'border-accent bg-surface-active'
                : 'border-border bg-surface hover:bg-surface-raised'
            }`}
            key={target.id}
            type="button"
            onClick={() => onLocation({ target: target.id })}
          >
            <div className="flex items-center gap-2 text-xs">
              <span className={`target-dot target-dot-${target.color}`} />
              <span>{target.label}</span>
              <span className="ml-auto text-dim">
                {target.id === 'synthetic' || target.id === 'font-baker' ? '✓' : '—'}
              </span>
            </div>
            <div className="mt-1 pl-[15px] font-mono text-[9px] text-dim">{target.detail}</div>
          </button>
        ))}
      </div>
    </aside>
  )
}

function RailButton({
  active = false,
  disabled = false,
  label,
  onClick,
}: {
  readonly active?: boolean
  readonly disabled?: boolean
  readonly label: string
  readonly onClick?: () => void
}) {
  return (
    <button
      className={`relative h-9 rounded-md px-5 text-left text-xs ${
        active ? 'bg-surface-active text-foreground' : 'text-muted hover:bg-surface'
      } disabled:cursor-not-allowed disabled:opacity-40`}
      disabled={disabled}
      type="button"
      onClick={onClick}
    >
      <span
        className={`absolute left-2 top-2.5 h-4 w-[3px] rounded-full ${active ? 'bg-accent' : 'bg-border'}`}
      />
      {label}
      {disabled && <span className="float-right font-mono text-[9px]">planned</span>}
    </button>
  )
}

function Scene({
  error,
  event,
  grid,
  location,
  summary,
  onLocation,
}: {
  readonly error: string | undefined
  readonly event: RunnerEvent | undefined
  readonly grid: boolean
  readonly location: HarnessLocation
  readonly summary: BenchmarkSummary | undefined
  readonly onLocation: (value: Partial<HarnessLocation>) => void
}) {
  const target = targetById(location.target)
  const scenario = scenarioById(location.scenario)
  return (
    <section
      className="mx-auto grid max-w-[1100px] gap-3"
      data-completed-at={summary?.completedAt}
      data-testid="scene"
    >
      <header className="flex min-h-[62px] items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Scenario · {scenario.id}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">{scenario.label}</h1>
          <p className="mt-1 max-w-2xl text-xs text-muted">{scenario.description}</p>
        </div>
        <div className="hidden gap-1 sm:flex">
          <Button>1×</Button>
          <Button>2×</Button>
          <Button>{grid ? 'Grid on' : 'Grid off'}</Button>
        </div>
      </header>
      <div className="overflow-hidden rounded-md border border-border bg-surface">
        <div className="flex h-[42px] items-center gap-2 border-b border-border px-3">
          <Chip tone={target.status({}) === 'unavailable' ? 'warning' : 'accent'}>
            {target.label}
          </Chip>
          <Chip tone={summary?.status === 'passed' ? 'success' : 'neutral'}>
            {summary?.status === 'passed' ? 'oracle locked' : 'awaiting validation'}
          </Chip>
          <span className="ml-auto font-mono text-[9px] text-dim">SHARED RUNNER · V0</span>
        </div>
        <div className={`benchmark-grid min-h-[420px] p-4 ${grid ? 'is-visible' : ''}`}>
          <div className="grid gap-3 md:grid-cols-3">
            {['Load target', 'Run samples', 'Validate output'].map((label, index) => {
              const complete = event?.phase === 'complete' || (event !== undefined && index === 0)
              return (
                <div className="rounded-md border border-border bg-panel/95 p-4" key={label}>
                  <div className="flex items-center gap-2">
                    <span
                      className={`grid size-6 place-items-center rounded-full font-mono text-[10px] ${complete ? 'bg-success text-black' : 'bg-surface-active text-muted'}`}
                    >
                      {complete ? '✓' : index + 1}
                    </span>
                    <span className="text-sm font-medium">{label}</span>
                  </div>
                  <p className="mt-3 font-mono text-[10px] leading-relaxed text-dim">
                    {index === 0 && target.detail}
                    {index === 1 && `${event?.completed ?? 0} / ${event?.total ?? 0} samples`}
                    {index === 2 && (summary?.validation ?? 'No accepted sample yet')}
                  </p>
                </div>
              )
            })}
          </div>
          <div className="mt-3 rounded-md border border-border bg-panel/95 p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <p className="eyebrow">Raster readiness ladder</p>
                <p className="mt-1 text-xs text-muted">
                  Capability-gated until real render adapters land.
                </p>
              </div>
              <span className="font-mono text-[9px] text-warning">NO FABRICATED METRICS</span>
            </div>
            <div className="grid grid-cols-[48px_repeat(3,1fr)] overflow-hidden rounded border border-border text-xs">
              <div className="cell cell-head">PX</div>
              {['Bitmap', 'MSDF', 'Slug'].map((label) => (
                <div className="cell cell-head" key={label}>
                  {label}
                </div>
              ))}
              {sampleSizes.map((size) => (
                <SampleRow key={size} size={size} />
              ))}
            </div>
          </div>
          {error && (
            <div className="mt-3 rounded-md border border-danger/50 bg-danger/10 p-3 text-xs text-danger">
              {error}
            </div>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 overflow-hidden rounded-md border border-border bg-surface sm:grid-cols-4">
        <Metric label="Median" value={formatMs(summary?.medianMs)} />
        <Metric label="P95" value={formatMs(summary?.p95Ms)} />
        <Metric label="Samples" value={String(summary?.measurements.length ?? 0)} />
        <Metric label="Validation" value={summary?.status ?? 'awaiting'} />
      </div>
      <div className="flex gap-2 lg:hidden">
        <Button className="flex-1" onClick={() => onLocation({ view: 'controls' })}>
          Controls
        </Button>
        <Button className="flex-1" onClick={() => onLocation({ view: 'report' })}>
          Report
        </Button>
      </div>
    </section>
  )
}

function SampleRow({ size }: { readonly size: number }) {
  return (
    <>
      <div className="cell font-mono text-dim">{size}</div>
      <div className="cell text-dim">unavailable</div>
      <div className="cell text-dim">unavailable</div>
      <div className="cell text-dim">unavailable</div>
    </>
  )
}

function Controls({
  fontName,
  samples,
  showGrid,
  warmup,
  onFont,
  onSamples,
  onShowGrid,
  onWarmup,
}: {
  readonly fontName: string
  readonly samples: number
  readonly showGrid: boolean
  readonly warmup: number
  readonly onFont: (file: File | undefined) => Promise<void>
  readonly onSamples: (value: number) => void
  readonly onShowGrid: (value: boolean) => void
  readonly onWarmup: (value: number) => void
}) {
  return (
    <section className="grid gap-4" data-testid="controls">
      <div>
        <p className="eyebrow">Run controls</p>
        <h2 className="mt-1 text-base font-semibold">Benchmark settings</h2>
      </div>
      <Field
        accept=".ttf,.otf,.ttc,.woff,.woff2"
        label="Font fixture"
        title={fontName}
        type="file"
        onChange={(event) => onFont(event.currentTarget.files?.[0])}
      />
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
      <SelectField label="Measurement mode" value="wall" onChange={() => undefined}>
        <option value="wall">Wall clock</option>
      </SelectField>
      <div className="border-y border-border py-2">
        <Toggle checked={showGrid} label="Show baseline grid" onChange={onShowGrid} />
        <Toggle checked={false} label="Collect GPU timestamps" onChange={() => undefined} />
      </div>
      <div className="rounded-md border border-border bg-surface p-3">
        <div className="flex items-center gap-2 text-xs">
          <span className="size-2 rounded-full bg-success" />
          <span>Runner schema valid</span>
          <span className="ml-auto font-mono text-[9px] text-dim">v0</span>
        </div>
      </div>
      <div className="rounded-md border border-border bg-surface p-3">
        <p className="eyebrow">Fixture</p>
        <p className="mt-2 truncate font-mono text-[10px] text-muted">{fontName}</p>
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
        <div>
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="font-mono text-[9px] text-dim">LOCAL RUN CONFIGURATION</p>
        </div>
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
    <nav className="fixed inset-x-0 bottom-0 z-30 grid h-[58px] grid-cols-4 border-t border-border bg-chrome p-2 lg:hidden">
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
