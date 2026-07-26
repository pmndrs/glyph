import { useState } from 'react'
import type { BenchmarkSummary } from '../benchmark/contracts'
import { Button, Toggle } from './ui'

export function ExportPanel({ summary }: { readonly summary: BenchmarkSummary | undefined }) {
  const [environment, setEnvironment] = useState(true)
  const [measurements, setMeasurements] = useState(true)
  const value = JSON.stringify(
    summary === undefined
      ? { status: 'no-run' }
      : {
          ...summary,
          environment: environment ? summary.environment : undefined,
          measurements: measurements ? summary.measurements : undefined,
        },
    null,
    2,
  )

  function download(): void {
    const anchor = document.createElement('a')
    const objectUrl = URL.createObjectURL(new Blob([value], { type: 'application/json' }))
    anchor.href = objectUrl
    anchor.download = 'pmndrs-text-benchmark.json'
    anchor.click()
    queueMicrotask(() => URL.revokeObjectURL(objectUrl))
  }

  return (
    <section className="grid gap-3" data-testid="export-panel">
      <header>
        <p className="eyebrow">Portable evidence</p>
        <h2 className="mt-1 text-xl font-semibold">Export results</h2>
        <p className="mt-1 text-xs text-muted">Download raw measurements and their environment.</p>
      </header>
      <div className="rounded-md border border-border bg-surface p-3">
        <p className="eyebrow mb-2">Included data</p>
        <Toggle checked={measurements} label="Measurements" onChange={setMeasurements} />
        <Toggle checked={environment} label="Environment" onChange={setEnvironment} />
      </div>
      <pre className="max-h-72 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-[10px] leading-relaxed text-muted">
        {value}
      </pre>
      <div className="grid grid-cols-2 gap-2">
        <Button
          disabled={summary === undefined}
          onClick={() => navigator.clipboard.writeText(value)}
        >
          Copy JSON
        </Button>
        <Button disabled={summary === undefined} variant="primary" onClick={download}>
          Download JSON
        </Button>
      </div>
    </section>
  )
}
