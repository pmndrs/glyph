import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
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
  readonly order: string
  readonly variant: Variant
  readonly stats: Record<string, unknown>
}
interface ShardObservation extends Record<string, unknown> {
  readonly backend: Backend
  readonly runs: readonly CapturedRun[]
}
interface CapturedShard {
  readonly backend: Backend
  readonly file: string
  readonly sha256: string
  readonly observation: ShardObservation
}

const executable = fileURLToPath(new URL('../node_modules/.bin/vitexec', import.meta.url))
const cwd = fileURLToPath(new URL('..', import.meta.url))
const packet = new URL('../fixtures/autoresearch/slug-outline-zero-branch-001/', import.meta.url)
const output = new URL('performance-chromium149.json', packet)
const shardFiles = {
  webgpu: 'performance-webgpu-chromium149.json',
  webgl2: 'performance-webgl2-chromium149.json',
} as const
const manifest = objectRecord(
  JSON.parse(await readFile(new URL('experiment-v0.json', packet), 'utf8')),
  'outline zero-branch experiment',
)
const baseCommit = fullCommit(manifest.baseCommit, 'baseCommit')
const candidateCommit = await headCommit()
await assertCandidateSnapshot(baseCommit, candidateCommit)

await mkdir(packet, { recursive: true })
const shards: CapturedShard[] = []
for (const backend of ['webgpu', 'webgl2'] as const) {
  shards.push(await loadOrCaptureShard(backend))
}
const combinedRuns = shards.flatMap((shard) => shard.observation.runs)
const summaries = summarize(combinedRuns)
const decision = decide(summaries)
const primaryObservation = shards[0]!.observation
const combined = {
  schemaVersion: 0,
  kind: 'slug-outline-zero-branch-performance-observation',
  experimentId: 'slug-outline-zero-branch-001',
  baseCommit,
  candidateCommit,
  capturedAt: new Date().toISOString(),
  technique: primaryObservation.technique,
  delivery: primaryObservation.delivery,
  workload: primaryObservation.workload,
  fontFixture: primaryObservation.fontFixture,
  viewport: primaryObservation.viewport,
  dpr: primaryObservation.dpr,
  fontSizes: primaryObservation.fontSizes,
  pairsPerBackend: primaryObservation.pairsPerBackend,
  steadyStateReportCount: primaryObservation.steadyStateReportCount,
  environment: primaryObservation.environment,
  gpuAdapter: primaryObservation.gpuAdapter,
  shards: shards.map((shard) => ({
    backend: shard.backend,
    file: shard.file,
    sha256: shard.sha256,
    capturedAt: shard.observation.capturedAt,
  })),
  runs: combinedRuns,
  summaries,
  decision,
}
await writeFile(output, `${JSON.stringify(combined, null, 2)}\n`)

async function loadOrCaptureShard(backend: Backend): Promise<CapturedShard> {
  const file = shardFiles[backend]
  const target = new URL(file, packet)
  try {
    const retained = await readFile(target, 'utf8')
    const observation = assertShardObservation(
      JSON.parse(retained),
      baseCommit,
      candidateCommit,
      backend,
    )
    process.stdout.write(`reusing validated ${backend} outline performance shard\n`)
    return { backend, file, sha256: sha256(retained), observation }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    process.stdout.write(`capturing ${backend} outline performance shard: ${reason}\n`)
  }

  const child = spawn(
    executable,
    [
      '--gpu',
      '--path',
      `/?runner=probe&baseCommit=${baseCommit}&candidateCommit=${candidateCommit}&backend=${backend}`,
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
    throw new Error(
      `${backend} outline zero-branch performance capture failed with status ${String(code)}`,
    )
  }
  const marker = /slug-outline-zero-branch-performance-ready (\{[^\n]+\})/.exec(transcript)?.[1]
  if (marker === undefined) {
    throw new Error(`${backend} outline zero-branch performance capture omitted its result`)
  }
  const observation = assertShardObservation(
    JSON.parse(marker),
    baseCommit,
    candidateCommit,
    backend,
  )
  const retained = `${JSON.stringify(observation, null, 2)}\n`
  await writeFile(target, retained)
  return { backend, file, sha256: sha256(retained), observation }
}

function assertShardObservation(
  candidate: unknown,
  expectedBaseCommit: string,
  expectedCandidateCommit: string,
  expectedBackend: Backend,
): ShardObservation {
  const record = objectRecord(candidate, 'outline zero-branch performance observation')
  if (
    record.schemaVersion !== 0 ||
    record.kind !== 'slug-outline-zero-branch-performance-observation' ||
    record.experimentId !== 'slug-outline-zero-branch-001' ||
    record.baseCommit !== expectedBaseCommit ||
    record.candidateCommit !== expectedCandidateCommit ||
    record.backend !== expectedBackend ||
    record.technique !== 'slug' ||
    record.delivery !== 'baked' ||
    record.workload !== 'paint-effects' ||
    record.fontFixture !== 'inter' ||
    record.dpr !== 2 ||
    record.pairsPerBackend !== 64 ||
    record.steadyStateReportCount !== 12 ||
    !Array.isArray(record.runs) ||
    record.runs.length !== 128
  ) {
    throw new TypeError(`${expectedBackend} performance shard has an invalid envelope`)
  }
  if (
    typeof record.capturedAt !== 'string' ||
    !Number.isFinite(Date.parse(record.capturedAt)) ||
    !sameNumberArray(record.fontSizes, [16, 40, 128]) ||
    !sameNumberRecord(record.viewport, { width: 1500, height: 950 })
  ) {
    throw new TypeError(`${expectedBackend} performance shard changed its capture contract`)
  }
  objectRecord(record.environment, `${expectedBackend} performance environment`)
  const expectedRuns = expectedRunIdentities(expectedBackend)
  const capturedRuns: CapturedRun[] = []
  for (const [index, candidateRun] of record.runs.entries()) {
    const run = objectRecord(candidateRun, 'outline zero-branch run')
    const stats = objectRecord(run.stats, 'outline zero-branch run stats')
    const expected = expectedRuns[index]!
    if (
      run.id !== expected.id ||
      run.backend !== expectedBackend ||
      run.fontSize !== expected.fontSize ||
      run.paintStrokePattern !== expected.paintStrokePattern ||
      run.pair !== expected.pair ||
      run.order !== expected.order ||
      run.variant !== expected.variant ||
      stats.technique !== 'slug' ||
      stats.backend !== expectedBackend ||
      stats.dpr !== 2 ||
      stats.gpuTimingSupported !== true ||
      stats.missingGlyphCount !== 0 ||
      stats.drawCount !== 1 ||
      stats.appliedFontSize !== expected.fontSize ||
      stats.appliedPaintStrokePattern !== expected.paintStrokePattern ||
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
    capturedRuns.push(run as unknown as CapturedRun)
  }
  return { ...record, backend: expectedBackend, runs: capturedRuns }
}

function expectedRunIdentities(backend: Backend): readonly Omit<CapturedRun, 'stats'>[] {
  const expected: Array<Omit<CapturedRun, 'stats'>> = []
  let mixedPair = 0
  for (let pair = 0; pair < 64; pair += 1) {
    const paintStrokePattern = pair % 4 === 3 ? 'all' : 'alternating'
    const fontSize =
      paintStrokePattern === 'all'
        ? [16, 40, 128][Math.floor(pair / 4) % 3]!
        : [16, 40, 128][mixedPair++ % 3]!
    const variants: readonly Variant[] =
      pair % 2 === 0
        ? ['multiply-zero', 'zero-width-branch']
        : ['zero-width-branch', 'multiply-zero']
    const order = variants.join('-then-')
    for (const variant of variants) {
      expected.push({
        id: `${backend}-${paintStrokePattern}-${String(fontSize)}px-p${String(pair)}-${variant}`,
        backend,
        fontSize,
        paintStrokePattern,
        pair,
        order,
        variant,
      })
    }
  }
  return expected
}

function sameNumberArray(candidate: unknown, expected: readonly number[]): boolean {
  return (
    Array.isArray(candidate) &&
    candidate.length === expected.length &&
    candidate.every((value, index) => value === expected[index])
  )
}

function sameNumberRecord(candidate: unknown, expected: Readonly<Record<string, number>>): boolean {
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) return false
  const record = candidate as Record<string, unknown>
  const keys = Object.keys(expected)
  return keys.every((key) => record[key] === expected[key])
}

function sha256(contents: string): string {
  return createHash('sha256').update(contents).digest('hex')
}

function summarize(capturedRuns: readonly CapturedRun[]): readonly Record<string, unknown>[] {
  const results: Record<string, unknown>[] = []
  for (const backend of ['webgpu', 'webgl2'] as const) {
    for (const fontSize of [16, 40, 128] as const) {
      const selected = capturedRuns.filter(
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
        capturedRuns.filter(
          (run) => run.backend === backend && run.paintStrokePattern === 'alternating',
        ),
      ),
    )
    for (const fontSize of [16, 40, 128] as const) {
      results.push(
        summary(
          backend,
          'all',
          fontSize,
          capturedRuns.filter(
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
        capturedRuns.filter((run) => run.backend === backend && run.paintStrokePattern === 'all'),
      ),
    )
  }
  return results
}

function summary(
  backend: Backend,
  paintStrokePattern: 'all' | 'alternating',
  fontSize: number | 'all-sizes',
  capturedRuns: readonly CapturedRun[],
): Record<string, unknown> {
  const baseline = capturedRuns.filter((run) => run.variant === 'multiply-zero')
  const candidate = capturedRuns.filter((run) => run.variant === 'zero-width-branch')
  assertStableResources(capturedRuns)
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

function assertStableResources(capturedRuns: readonly CapturedRun[]): void {
  const firstRun = capturedRuns[0]
  if (firstRun === undefined)
    throw new Error('outline zero-branch resource comparison requires runs')
  for (const name of [
    'artifactBytes',
    'slugCurveGpuBytes',
    'slugHeaderGpuBytes',
    'slugReferenceGpuBytes',
    'slugGpuBytes',
  ]) {
    const expected = metric(firstRun, name)
    for (const run of capturedRuns) {
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
    '?? apps/benchmarks/fixtures/autoresearch/slug-outline-zero-branch-001/quality-chromium149.json',
    '?? apps/benchmarks/fixtures/autoresearch/slug-outline-zero-branch-001/performance-chromium149.json',
    '?? apps/benchmarks/fixtures/autoresearch/slug-outline-zero-branch-001/performance-webgl2-chromium149.json',
    '?? apps/benchmarks/fixtures/autoresearch/slug-outline-zero-branch-001/performance-webgpu-chromium149.json',
    '?? apps/benchmarks/fixtures/autoresearch/slug-outline-zero-branch-001/generated/multiply-zero.webgl2.glsl',
    '?? apps/benchmarks/fixtures/autoresearch/slug-outline-zero-branch-001/generated/multiply-zero.webgpu.wgsl',
    '?? apps/benchmarks/fixtures/autoresearch/slug-outline-zero-branch-001/generated/zero-width-branch.webgl2.glsl',
    '?? apps/benchmarks/fixtures/autoresearch/slug-outline-zero-branch-001/generated/zero-width-branch.webgpu.wgsl',
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
