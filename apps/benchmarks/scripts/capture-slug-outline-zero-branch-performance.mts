import { execFile, spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

type Backend = 'webgpu' | 'webgl2'
type Variant = 'multiply-zero' | 'zero-width-branch'
interface CapturedRun {
  readonly id: string
  readonly backend: Backend
  readonly fontSize: number
  readonly paintStrokePattern: 'all' | 'alternating'
  readonly pair: number
  readonly variant: Variant
  readonly stats: Record<string, unknown>
}

const executable = fileURLToPath(new URL('../node_modules/.bin/vitexec', import.meta.url))
const cwd = fileURLToPath(new URL('..', import.meta.url))
const packet = new URL('../fixtures/autoresearch/slug-outline-zero-branch-001/', import.meta.url)
const output = new URL('performance-chromium149.json', packet)
const manifest = objectRecord(
  JSON.parse(await readFile(new URL('experiment-v0.json', packet), 'utf8')),
  'outline zero-branch experiment',
)
const baseCommit = fullCommit(manifest.baseCommit, 'baseCommit')
const candidateCommit = await headCommit()
await assertCandidateSnapshot(baseCommit, candidateCommit)

const child = spawn(
  executable,
  [
    '--gpu',
    '--path',
    `/?runner=probe&baseCommit=${baseCommit}&candidateCommit=${candidateCommit}`,
    './vitexec/slug-outline-zero-branch-performance.probe.ts',
  ],
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
  throw new Error(`outline zero-branch performance capture failed with status ${String(code)}`)
}
const marker = /slug-outline-zero-branch-performance-ready (\{[^\n]+\})/.exec(transcript)?.[1]
if (marker === undefined) {
  throw new Error('outline zero-branch performance capture omitted its result')
}
const observation = assertObservation(JSON.parse(marker), baseCommit, candidateCommit)
const summaries = summarize(observation.runs)
const decision = decide(summaries)
await mkdir(packet, { recursive: true })
await writeFile(output, `${JSON.stringify({ ...observation, summaries, decision }, null, 2)}\n`)

function assertObservation(
  candidate: unknown,
  expectedBaseCommit: string,
  expectedCandidateCommit: string,
): Record<string, unknown> & { readonly runs: readonly CapturedRun[] } {
  const record = objectRecord(candidate, 'outline zero-branch performance observation')
  if (
    record.schemaVersion !== 0 ||
    record.kind !== 'slug-outline-zero-branch-performance-observation' ||
    record.experimentId !== 'slug-outline-zero-branch-001' ||
    record.baseCommit !== expectedBaseCommit ||
    record.candidateCommit !== expectedCandidateCommit ||
    record.dpr !== 2 ||
    record.pairsPerBackend !== 64 ||
    record.steadyStateReportCount !== 12 ||
    !Array.isArray(record.runs) ||
    record.runs.length !== 256
  ) {
    throw new TypeError('outline zero-branch performance observation has an invalid envelope')
  }
  const expectedIds = new Set(
    (['webgpu', 'webgl2'] as const).flatMap((backend) =>
      Array.from({ length: 64 }, (_, pair) => {
        const paintStrokePattern = pair % 4 === 3 ? 'all' : 'alternating'
        const mixedPair = pair - Math.floor(pair / 4)
        const fontSize =
          paintStrokePattern === 'all'
            ? [16, 40, 128][Math.floor(pair / 4) % 3]!
            : [16, 40, 128][mixedPair % 3]!
        return (['multiply-zero', 'zero-width-branch'] as const).map(
          (variant) =>
            `${backend}-${paintStrokePattern}-${String(fontSize)}px-p${String(pair)}-${variant}`,
        )
      }).flat(),
    ),
  )
  const runs: CapturedRun[] = []
  for (const candidateRun of record.runs) {
    const run = objectRecord(candidateRun, 'outline zero-branch run')
    const stats = objectRecord(run.stats, 'outline zero-branch run stats')
    if (
      typeof run.id !== 'string' ||
      !expectedIds.delete(run.id) ||
      (run.backend !== 'webgpu' && run.backend !== 'webgl2') ||
      ![16, 40, 128].includes(run.fontSize as number) ||
      (run.paintStrokePattern !== 'all' && run.paintStrokePattern !== 'alternating') ||
      typeof run.pair !== 'number' ||
      !Number.isInteger(run.pair) ||
      run.pair < 0 ||
      run.pair >= 64 ||
      (run.variant !== 'multiply-zero' && run.variant !== 'zero-width-branch') ||
      stats.technique !== 'slug' ||
      stats.backend !== run.backend ||
      stats.dpr !== 2 ||
      stats.gpuTimingSupported !== true ||
      stats.missingGlyphCount !== 0 ||
      stats.drawCount !== 1 ||
      stats.appliedPaintStrokePattern !== run.paintStrokePattern ||
      stats.appliedPaintStrokeWidth !== 0.1
    ) {
      throw new TypeError('outline zero-branch run identity or product stats are invalid')
    }
    for (const name of [
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
      finiteNonNegative(stats[name], `${run.id}.${name}`)
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
  if (expectedIds.size !== 0) throw new TypeError('outline zero-branch runs are incomplete')
  return { ...record, runs }
}

function summarize(runs: readonly CapturedRun[]): readonly Record<string, unknown>[] {
  const results: Record<string, unknown>[] = []
  for (const backend of ['webgpu', 'webgl2'] as const) {
    for (const fontSize of [16, 40, 128] as const) {
      const selected = runs.filter(
        (run) =>
          run.backend === backend &&
          run.paintStrokePattern === 'alternating' &&
          run.fontSize === fontSize,
      )
      results.push(summary(backend, 'alternating', fontSize, selected))
    }
    results.push(
      summary(
        backend,
        'alternating',
        'all-sizes',
        runs.filter((run) => run.backend === backend && run.paintStrokePattern === 'alternating'),
      ),
    )
    for (const fontSize of [16, 40, 128] as const) {
      results.push(
        summary(
          backend,
          'all',
          fontSize,
          runs.filter(
            (run) =>
              run.backend === backend &&
              run.paintStrokePattern === 'all' &&
              run.fontSize === fontSize,
          ),
        ),
      )
    }
    results.push(
      summary(
        backend,
        'all',
        'all-sizes',
        runs.filter((run) => run.backend === backend && run.paintStrokePattern === 'all'),
      ),
    )
  }
  return results
}

function summary(
  backend: Backend,
  paintStrokePattern: 'all' | 'alternating',
  fontSize: number | 'all-sizes',
  runs: readonly CapturedRun[],
): Record<string, unknown> {
  const baseline = runs.filter((run) => run.variant === 'multiply-zero')
  const candidate = runs.filter((run) => run.variant === 'zero-width-branch')
  assertStableResources(runs)
  const pairedGpuPercent = baseline.map((base) => {
    const match = candidate.find((run) => run.pair === base.pair)
    if (match === undefined) throw new Error('outline zero-branch run lacks its paired baseline')
    return percent(metric(match, 'medianGpuMs'), metric(base, 'medianGpuMs'))
  })
  const pairedGpuMedianConfidence95 = bootstrapMedianConfidence95(pairedGpuPercent)
  return {
    backend,
    paintStrokePattern,
    fontSize,
    pairCount: pairedGpuPercent.length,
    baselineMedianGpuMs: median(baseline.map((run) => metric(run, 'medianGpuMs'))),
    candidateMedianGpuMs: median(candidate.map((run) => metric(run, 'medianGpuMs'))),
    medianPairedGpuPercent: median(pairedGpuPercent),
    pairedGpuMedianConfidence95,
    minimumPairedGpuPercent: Math.min(...pairedGpuPercent),
    maximumPairedGpuPercent: Math.max(...pairedGpuPercent),
    pairedGpuPercent,
    baselineMedianSubmitMs: median(baseline.map((run) => metric(run, 'medianSubmitMs'))),
    candidateMedianSubmitMs: median(candidate.map((run) => metric(run, 'medianSubmitMs'))),
    baselineGpuBytes: metric(baseline[0]!, 'slugGpuBytes'),
    candidateGpuBytes: metric(candidate[0]!, 'slugGpuBytes'),
    baselineArtifactBytes: metric(baseline[0]!, 'artifactBytes'),
    candidateArtifactBytes: metric(candidate[0]!, 'artifactBytes'),
  }
}

function decide(entries: readonly Record<string, unknown>[]): Record<string, unknown> {
  const overall = entries.filter(
    (entry) => entry.paintStrokePattern === 'alternating' && entry.fontSize === 'all-sizes',
  )
  const scales = entries.filter(
    (entry) => entry.paintStrokePattern === 'alternating' && entry.fontSize !== 'all-sizes',
  )
  const guards = entries.filter((entry) => entry.paintStrokePattern === 'all')
  const accepted =
    overall.every((entry) => metricValue(entry, 'medianPairedGpuPercent') <= -5) &&
    overall.every(
      (entry) =>
        metricValue(
          objectRecord(entry.pairedGpuMedianConfidence95, 'paired GPU confidence'),
          'high',
        ) < 0,
    ) &&
    scales.every((entry) => metricValue(entry, 'medianPairedGpuPercent') <= 2) &&
    guards.every((entry) => metricValue(entry, 'medianPairedGpuPercent') <= 2)
  return {
    status: accepted ? 'accepted' : 'rejected',
    minimumImprovementPercent: 5,
    maximumScaleRegressionPercent: 2,
    allOutlinedGuardMaximumRegressionPercent: 2,
    reason: accepted
      ? 'candidate cleared both dual-backend paired GPU gates without a scale regression'
      : 'candidate did not clear the precommitted dual-backend paired GPU gate',
  }
}

function bootstrapMedianConfidence95(values: readonly number[]): {
  readonly low: number
  readonly high: number
} {
  if (values.length < 2) throw new RangeError('paired bootstrap requires at least two values')
  let state = 0x51_47_2a_d3
  const estimates: number[] = []
  for (let sample = 0; sample < 10_000; sample += 1) {
    const resampled: number[] = []
    for (let index = 0; index < values.length; index += 1) {
      state ^= state << 13
      state ^= state >>> 17
      state ^= state << 5
      const selected = (state >>> 0) % values.length
      resampled.push(values[selected]!)
    }
    estimates.push(median(resampled))
  }
  estimates.sort((left, right) => left - right)
  return {
    low: estimates[Math.floor(estimates.length * 0.025)]!,
    high: estimates[Math.ceil(estimates.length * 0.975) - 1]!,
  }
}

function assertStableResources(runs: readonly CapturedRun[]): void {
  const first = runs[0]
  if (first === undefined) throw new Error('outline zero-branch resource comparison requires runs')
  for (const name of [
    'artifactBytes',
    'slugCurveGpuBytes',
    'slugHeaderGpuBytes',
    'slugReferenceGpuBytes',
    'slugGpuBytes',
  ]) {
    const expected = metric(first, name)
    for (const run of runs) {
      if (metric(run, name) !== expected) {
        throw new Error(`${run.backend} ${String(run.fontSize)}px changed ${name}`)
      }
    }
  }
}

async function headCommit(): Promise<string> {
  const execute = promisify(execFile)
  const { stdout } = await execute('git', ['rev-parse', 'HEAD'], { cwd })
  return fullCommit(stdout.trim(), 'HEAD')
}

async function assertCandidateSnapshot(
  expectedBaseCommit: string,
  expectedCandidateCommit: string,
): Promise<void> {
  if (expectedBaseCommit === expectedCandidateCommit)
    throw new Error('outline zero-branch candidate equals its base')
  const execute = promisify(execFile)
  const { stdout } = await execute('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd,
  })
  const allowed = new Set([
    '?? fixtures/autoresearch/slug-outline-zero-branch-001/quality-chromium149.json',
    '?? fixtures/autoresearch/slug-outline-zero-branch-001/performance-chromium149.json',
    '?? fixtures/autoresearch/slug-outline-zero-branch-001/generated/multiply-zero.webgl2.glsl',
    '?? fixtures/autoresearch/slug-outline-zero-branch-001/generated/multiply-zero.webgpu.wgsl',
    '?? fixtures/autoresearch/slug-outline-zero-branch-001/generated/zero-width-branch.webgl2.glsl',
    '?? fixtures/autoresearch/slug-outline-zero-branch-001/generated/zero-width-branch.webgpu.wgsl',
  ])
  const unexpected = stdout
    .trim()
    .split('\n')
    .filter((line) => line.length > 0 && !allowed.has(line))
  if (unexpected.length !== 0) {
    throw new Error(
      `outline zero-branch capture requires a committed candidate: ${unexpected.join(', ')}`,
    )
  }
  try {
    await execute(
      'git',
      ['merge-base', '--is-ancestor', expectedBaseCommit, expectedCandidateCommit],
      { cwd },
    )
  } catch {
    throw new Error('outline zero-branch base is not an ancestor of the candidate')
  }
}

function metric(run: CapturedRun, name: string): number {
  const value = run.stats[name]
  finiteNonNegative(value, `${run.id}.${name}`)
  return value
}

function metricValue(record: Record<string, unknown>, name: string): number {
  const value = record[name]
  finiteNonNegativeOrSigned(value, name)
  return value
}

function percent(candidate: number, baseline: number): number {
  if (baseline === 0) throw new RangeError('paired percentage requires a nonzero baseline')
  return ((candidate - baseline) / baseline) * 100
}

function median(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError('median requires samples')
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1]! + sorted[middle]!) / 2 : sorted[middle]!
}

function fullCommit(candidate: unknown, label: string): string {
  if (typeof candidate !== 'string' || !/^[0-9a-f]{40}$/.test(candidate)) {
    throw new TypeError(`${label} must be a full Git commit`)
  }
  return candidate
}

function objectRecord(input: unknown, label: string): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError(`${label} must be an object`)
  }
  return input as Record<string, unknown>
}

function finiteNonNegative(candidate: unknown, label: string): asserts candidate is number {
  if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate < 0) {
    throw new TypeError(`${label} must be finite and non-negative`)
  }
}

function finiteNonNegativeOrSigned(candidate: unknown, label: string): asserts candidate is number {
  if (typeof candidate !== 'number' || !Number.isFinite(candidate)) {
    throw new TypeError(`${label} must be finite`)
  }
}
