import { Fragment } from 'react'
import type { BenchmarkSummary } from '../benchmark/contracts'
import type { LiveBenchmarkCapture } from '../benchmark/product-result'
import packageSizes from '../generated/package-sizes.json'
import { Metric } from './ui'

function ms(value: number | undefined): string {
  return value === undefined ? '—' : `${value.toFixed(2)} ms`
}

function bytes(value: number | undefined): string {
  if (value === undefined) return '—'
  if (value < 1024) return `${value} B`
  return `${(value / 1024).toFixed(1)} KiB`
}

export function Report({
  liveCapture,
  summary,
}: {
  readonly liveCapture?: LiveBenchmarkCapture | undefined
  readonly summary: BenchmarkSummary | undefined
}) {
  if (liveCapture !== undefined) return <LiveReport capture={liveCapture} />
  const metrics = summary?.measurements[0]?.metrics
  return (
    <section className="grid gap-3" data-testid="report">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Latest benchmark report</p>
          <h2 className="mt-1 text-xl font-semibold">Run summary</h2>
          <p className="mt-1 text-xs text-muted">
            {summary?.completedAt ?? 'Run a supported target to collect evidence.'}
          </p>
        </div>
      </header>
      <div className="grid grid-cols-3 overflow-hidden rounded-md border border-border bg-surface">
        <Metric label="P50" value={ms(summary?.medianMs)} />
        <Metric label="P95" value={ms(summary?.p95Ms)} />
        <Metric label="Output" value={bytes(summary?.outputBytes)} />
      </div>
      <div className="rounded-md border border-border bg-surface p-3">
        <div className="flex items-center gap-2 text-xs">
          <span className={`size-2 rounded-full ${summary ? 'bg-success' : 'bg-dim'}`} />
          <span className="font-medium text-foreground">Correctness</span>
          <span className="ml-auto font-mono text-[10px] text-muted">
            {summary?.validation ?? 'awaiting run'}
          </span>
        </div>
      </div>
      {metrics !== undefined && (
        <div className="rounded-md border border-border bg-surface p-3">
          <p className="eyebrow">Target evidence</p>
          <dl className="mt-2 grid grid-cols-[1fr_auto] gap-y-2 text-xs">
            {Object.entries(metrics).map(([label, value]) => (
              <Fragment key={label}>
                <dt className="text-dim">{label}</dt>
                <dd className="font-mono text-[10px] text-muted">{value}</dd>
              </Fragment>
            ))}
          </dl>
        </div>
      )}
      <div className="rounded-md border border-border bg-surface p-3">
        <p className="eyebrow">Independent package-size lane</p>
        <div className="mt-2 grid gap-2">
          {packageSizes.entries.map((entry) => (
            <div className="flex items-center gap-3 text-xs" key={entry.id}>
              <span
                className={`size-2 rounded-full ${entry.status === 'measured' ? 'bg-success' : 'bg-warning'}`}
              />
              <span className="text-foreground">{entry.label}</span>
              <span className="ml-auto font-mono text-[10px] text-muted">
                {entry.status === 'measured'
                  ? `${bytes(entry.rawBytes)} raw · ${bytes(entry.brotliBytes)} br`
                  : 'not landed'}
              </span>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-md border border-border bg-surface p-3">
        <p className="eyebrow">Environment</p>
        <dl className="mt-2 grid grid-cols-[7rem_1fr] gap-y-2 text-xs">
          <dt className="text-dim">Runtime</dt>
          <dd className="truncate text-muted">{summary?.environment.browser ?? '—'}</dd>
          <dt className="text-dim">Threads</dt>
          <dd className="text-muted">{summary?.environment.hardwareConcurrency ?? '—'}</dd>
          <dt className="text-dim">WebGPU</dt>
          <dd className="text-muted">
            {summary?.environment.webgpu === true ? 'available' : 'unavailable'}
          </dd>
        </dl>
      </div>
    </section>
  )
}

function LiveReport({ capture }: { readonly capture: LiveBenchmarkCapture }) {
  const { stats } = capture
  return (
    <section className="grid gap-3" data-testid="report">
      <header>
        <p className="eyebrow">Captured live benchmark</p>
        <h2 className="mt-1 text-xl font-semibold">Consumer cost snapshot</h2>
        <p className="mt-1 font-mono text-[9px] text-muted">{capture.capturedAt}</p>
      </header>
      <div className="grid grid-cols-3 overflow-hidden rounded-md border border-border bg-surface">
        <Metric label="FPS" value={stats.framesPerSecond.toFixed(1)} />
        <Metric label="CPU frame · P50" value={ms(stats.medianSubmitMs)} />
        <Metric
          label="GPU frame · P50"
          value={
            stats.medianGpuMs === undefined
              ? stats.gpuTimingSupported
                ? 'resolving'
                : 'unavailable'
              : ms(stats.medianGpuMs)
          }
        />
      </div>
      <div className="rounded-md border border-border bg-surface p-3">
        <p className="eyebrow">Selection</p>
        <p className="mt-2 text-xs text-muted">
          {capture.technique} · {capture.backend} · {capture.workload} · {capture.fontFixture} ·{' '}
          {capture.dpr}× DPR
        </p>
      </div>
      <div className="rounded-md border border-border bg-surface p-3">
        <p className="eyebrow">System samples</p>
        <p className="mt-1 text-xs text-muted">
          {stats.textUpdateTimings.sampleCount} committed text updates ·{' '}
          {stats.submitHistory.length} CPU frames · {stats.gpuHistory.length} GPU frames
        </p>
        <div className="mt-3 grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-2 text-xs">
          <span className="font-mono text-[9px] uppercase text-dim">System</span>
          <span className="font-mono text-[9px] uppercase text-dim">P50</span>
          <span className="font-mono text-[9px] uppercase text-dim">P95</span>
          <TimingRow
            label="Schedule text update"
            median={stats.textUpdateTimings.medianScheduleMs}
            p95={stats.textUpdateTimings.p95ScheduleMs}
          />
          <TimingRow
            label="Text ready · shape + layout + batches"
            median={stats.textUpdateTimings.medianReadyMs}
            p95={stats.textUpdateTimings.p95ReadyMs}
          />
          <TimingRow
            label="Update benchmark scene"
            median={stats.textUpdateTimings.medianSceneMs}
            p95={stats.textUpdateTimings.p95SceneMs}
          />
          <TimingRow
            label="Total text update"
            median={stats.textUpdateTimings.medianTotalMs}
            p95={stats.textUpdateTimings.p95TotalMs}
          />
          <TimingRow
            label="Frame submission"
            median={stats.medianSubmitMs}
            p95={stats.p95SubmitMs}
          />
          <TimingRow label="GPU frame" median={stats.medianGpuMs} p95={stats.p95GpuMs} />
        </div>
      </div>
      <div className="rounded-md border border-border bg-surface p-3">
        <p className="eyebrow">Startup</p>
        <dl className="mt-2 grid grid-cols-[1fr_auto] gap-y-2 text-xs">
          <dt className="text-dim">Renderer init</dt>
          <dd className="font-mono text-[10px] text-muted">{ms(stats.rendererInitMs)}</dd>
          <dt className="text-dim">Font fetch + register</dt>
          <dd className="font-mono text-[10px] text-muted">{ms(stats.fontLoadMs)}</dd>
          <dt className="text-dim">Text ready</dt>
          <dd className="font-mono text-[10px] text-muted">{ms(stats.textReadyMs)}</dd>
          <dt className="text-dim">First draw submit</dt>
          <dd className="font-mono text-[10px] text-muted">{ms(stats.firstDrawMs)}</dd>
          <dt className="text-dim">Total startup</dt>
          <dd className="font-mono text-[10px] text-muted">{ms(stats.startupMs)}</dd>
        </dl>
      </div>
      <div className="rounded-md border border-border bg-surface p-3">
        <p className="eyebrow">Retained cost</p>
        <dl className="mt-2 grid grid-cols-[1fr_auto] gap-y-2 text-xs">
          <dt className="text-dim">Font artifact</dt>
          <dd className="font-mono text-[10px] text-muted">{bytes(stats.artifactBytes)}</dd>
          <dt className="text-dim">Atlas GPU</dt>
          <dd className="font-mono text-[10px] text-muted">{bytes(stats.atlasGpuBytes)}</dd>
          <dt className="text-dim">Total tracked GPU</dt>
          <dd className="font-mono text-[10px] text-muted">{bytes(stats.totalGpuBytes)}</dd>
          <dt className="text-dim">Glyphs / draws</dt>
          <dd className="font-mono text-[10px] text-muted">
            {stats.glyphCount} / {stats.drawCount}
          </dd>
        </dl>
      </div>
    </section>
  )
}

function TimingRow({
  label,
  median,
  p95,
}: {
  label: string
  median: number | undefined
  p95: number | undefined
}) {
  return (
    <>
      <span className="text-dim">{label}</span>
      <span className="text-right font-mono text-[10px] text-muted">{ms(median)}</span>
      <span className="text-right font-mono text-[10px] text-muted">{ms(p95)}</span>
    </>
  )
}
