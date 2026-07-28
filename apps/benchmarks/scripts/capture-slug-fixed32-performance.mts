import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const executable = fileURLToPath(new URL('../node_modules/.bin/vitexec', import.meta.url))
const cwd = fileURLToPath(new URL('..', import.meta.url))
const output = new URL(
  '../fixtures/autoresearch/slug-fixed32-bands-001/performance-chromium149.json',
  import.meta.url,
)
const child = spawn(
  executable,
  ['--gpu', '--path', '/?runner=probe', './vitexec/slug-fixed32-performance.probe.ts'],
  { cwd, stdio: ['ignore', 'pipe', 'pipe'] },
)

let transcript = ''
for (const stream of [child.stdout, child.stderr]) {
  stream.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    transcript += text
    process.stdout.write(text)
  })
}
const code = await new Promise<number | null>((resolve, reject) => {
  child.once('error', reject)
  child.once('exit', resolve)
})
if (code !== 0 || transcript.includes('[error]')) {
  throw new Error(`fixed-32 performance capture failed with status ${String(code)}`)
}
const marker = /slug-fixed32-performance-ready (\{[^\n]+\})/.exec(transcript)?.[1]
if (marker === undefined) throw new Error('fixed-32 performance capture omitted its result marker')
const parsed: unknown = JSON.parse(marker)
const observation = assertObservation(parsed)
const value = { ...observation, summaries: summarize(observation.runs) }
await writeFile(output, `${JSON.stringify(value, null, 2)}\n`)

interface CapturedRun {
  readonly backend: 'webgpu' | 'webgl2'
  readonly fontFixture: 'inter' | 'noto-sans-cjk-showcase'
  readonly round: number
  readonly variant: 'fixed16' | 'fixed32'
  readonly stats: Record<string, unknown>
}

function assertObservation(candidate: unknown): Record<string, unknown> & {
  readonly runs: readonly CapturedRun[]
} {
  const candidateObservation = objectRecord(candidate, 'fixed-32 performance observation')
  if (
    candidateObservation.schemaVersion !== 0 ||
    candidateObservation.kind !== 'slug-fixed32-performance-observation' ||
    candidateObservation.experimentId !== 'slug-fixed32-bands-001' ||
    candidateObservation.dpr !== 2 ||
    candidateObservation.roundCount !== 5 ||
    candidateObservation.steadyStateReportCount !== 12 ||
    !Array.isArray(candidateObservation.runs) ||
    candidateObservation.runs.length !== 40
  ) {
    throw new TypeError('fixed-32 performance observation has an invalid envelope')
  }
  const runs: CapturedRun[] = []
  const ids = new Set<string>()
  for (const candidateRun of candidateObservation.runs) {
    const run = objectRecord(candidateRun, 'fixed-32 performance run')
    const stats = objectRecord(run.stats, 'fixed-32 run stats')
    if (
      typeof run.id !== 'string' ||
      ids.has(run.id) ||
      (run.backend !== 'webgpu' && run.backend !== 'webgl2') ||
      (run.fontFixture !== 'inter' && run.fontFixture !== 'noto-sans-cjk-showcase') ||
      (run.variant !== 'fixed16' && run.variant !== 'fixed32') ||
      typeof run.round !== 'number' ||
      !Number.isInteger(run.round) ||
      run.round < 0 ||
      run.round >= 5 ||
      stats.technique !== 'slug' ||
      stats.backend !== run.backend ||
      stats.dpr !== 2 ||
      stats.gpuTimingSupported !== true
    ) {
      throw new TypeError('fixed-32 performance run identity or stats are invalid')
    }
    ids.add(run.id)
    for (const metricName of [
      'medianSubmitMs',
      'p95SubmitMs',
      'medianGpuMs',
      'p95GpuMs',
      'artifactBytes',
      'slugCurveGpuBytes',
      'slugHeaderGpuBytes',
      'slugReferenceGpuBytes',
      'slugGpuBytes',
    ]) {
      finiteNonNegative(stats[metricName], `${run.id}.${metricName}`)
    }
    for (const history of ['submitHistory', 'gpuHistory']) {
      const samples = stats[history]
      if (!Array.isArray(samples) || samples.length < 12) {
        throw new TypeError(`${run.id}.${history} must retain twelve samples`)
      }
      for (const sample of samples) finiteNonNegative(sample, `${run.id}.${history}`)
    }
    runs.push(run as unknown as CapturedRun)
  }
  return { ...candidateObservation, runs }
}

function summarize(runs: readonly CapturedRun[]): readonly Record<string, unknown>[] {
  const summaries: Record<string, unknown>[] = []
  for (const backend of ['webgpu', 'webgl2'] as const) {
    for (const fontFixture of ['inter', 'noto-sans-cjk-showcase'] as const) {
      const selected = runs.filter(
        (run) => run.backend === backend && run.fontFixture === fontFixture,
      )
      const fixed16 = selected.filter((run) => run.variant === 'fixed16')
      const fixed32 = selected.filter((run) => run.variant === 'fixed32')
      const pairedGpuPercent = fixed16.map((base) => {
        const candidate = fixed32.find((run) => run.round === base.round)
        if (candidate === undefined) throw new Error('fixed-32 run lacks its paired baseline')
        return percent(metric(candidate, 'medianGpuMs'), metric(base, 'medianGpuMs'))
      })
      summaries.push({
        backend,
        fontFixture,
        fixed16MedianGpuMs: median(fixed16.map((run) => metric(run, 'medianGpuMs'))),
        fixed32MedianGpuMs: median(fixed32.map((run) => metric(run, 'medianGpuMs'))),
        medianPairedGpuPercent: median(pairedGpuPercent),
        pairedGpuPercent,
        fixed16MedianSubmitMs: median(fixed16.map((run) => metric(run, 'medianSubmitMs'))),
        fixed32MedianSubmitMs: median(fixed32.map((run) => metric(run, 'medianSubmitMs'))),
        fixed16GpuBytes: metric(fixed16[0]!, 'slugGpuBytes'),
        fixed32GpuBytes: metric(fixed32[0]!, 'slugGpuBytes'),
        fixed16ArtifactBytes: metric(fixed16[0]!, 'artifactBytes'),
        fixed32ArtifactBytes: metric(fixed32[0]!, 'artifactBytes'),
      })
    }
  }
  return summaries
}

function metric(run: CapturedRun, name: string): number {
  const metricValue = run.stats[name]
  finiteNonNegative(metricValue, `${run.backend}.${run.fontFixture}.${run.variant}.${name}`)
  return metricValue
}

function percent(candidate: number, base: number): number {
  if (base === 0) throw new RangeError('paired percentage requires a nonzero baseline')
  return ((candidate - base) / base) * 100
}

function median(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError('median requires samples')
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!
}

function objectRecord(input: unknown, label: string): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError(`${label} must be an object`)
  }
  return input as Record<string, unknown>
}

function finiteNonNegative(
  candidateMetric: unknown,
  label: string,
): asserts candidateMetric is number {
  if (
    typeof candidateMetric !== 'number' ||
    !Number.isFinite(candidateMetric) ||
    candidateMetric < 0
  ) {
    throw new TypeError(`${label} must be finite and non-negative`)
  }
}
