import type { BenchmarkSummary } from '../benchmark/contracts'
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

export function Report({ summary }: { readonly summary: BenchmarkSummary | undefined }) {
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
        <Metric label="Median" value={ms(summary?.medianMs)} />
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
