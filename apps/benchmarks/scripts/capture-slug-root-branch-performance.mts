import { execFile, spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const FONT_FIXTURES = [
  'inter',
  'amiri',
  'noto-sans-devanagari',
  'dot-gothic-16',
  'noto-sans-cjk-showcase',
  'source-serif-4',
  'dancing-script',
] as const
type FontFixture = (typeof FONT_FIXTURES)[number]

const executable = fileURLToPath(new URL('../node_modules/.bin/vitexec', import.meta.url))
const cwd = fileURLToPath(new URL('..', import.meta.url))
const output = new URL(
  '../fixtures/autoresearch/slug-root-branch-001/performance-chromium149.json',
  import.meta.url,
)
const manifest = assertManifest(
  JSON.parse(
    await readFile(
      new URL('../fixtures/autoresearch/slug-root-branch-001/experiment-v0.json', import.meta.url),
      'utf8',
    ),
  ),
)
const candidateCommit = await headCommit()
await assertCandidateSnapshot(manifest.baseCommit, candidateCommit)
const child = spawn(
  executable,
  [
    '--gpu',
    '--path',
    `/?runner=probe&baseCommit=${encodeURIComponent(manifest.baseCommit)}&candidateCommit=${encodeURIComponent(candidateCommit)}`,
    './vitexec/slug-root-branch-performance.probe.ts',
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
  throw new Error(`root-branch performance capture failed with status ${String(code)}`)
}
const marker = /slug-root-branch-performance-ready (\{[^\n]+\})/.exec(transcript)?.[1]
if (marker === undefined)
  throw new Error('root-branch performance capture omitted its result marker')
const parsed: unknown = JSON.parse(marker)
const observation = assertObservation(parsed, manifest.baseCommit, candidateCommit)
const value = { ...observation, summaries: summarize(observation.runs) }
await mkdir(new URL('../fixtures/autoresearch/slug-root-branch-001/', import.meta.url), {
  recursive: true,
})
await writeFile(output, `${JSON.stringify(value, null, 2)}\n`)

interface CapturedRun {
  readonly backend: 'webgpu' | 'webgl2'
  readonly fontFixture: FontFixture
  readonly round: number
  readonly variant: 'baseline' | 'root-branch'
  readonly stats: Record<string, unknown>
}

async function headCommit(): Promise<string> {
  const execute = promisify(execFile)
  const { stdout } = await execute('git', ['rev-parse', 'HEAD'], { cwd })
  const commit = stdout.trim()
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('Git did not return a full base commit')
  return commit
}

async function assertCandidateSnapshot(baseCommit: string, snapshotCommit: string): Promise<void> {
  if (snapshotCommit === baseCommit) throw new Error('root-branch candidate equals its base commit')
  const execute = promisify(execFile)
  const { stdout } = await execute('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd,
  })
  if (stdout.length !== 0) {
    throw new Error('root-branch capture requires a clean committed candidate snapshot')
  }
  try {
    await execute('git', ['merge-base', '--is-ancestor', baseCommit, snapshotCommit], { cwd })
  } catch {
    throw new Error('root-branch base commit is not an ancestor of the candidate commit')
  }
}

function assertManifest(candidate: unknown): { readonly baseCommit: string } {
  const record = objectRecord(candidate, 'root-branch experiment manifest')
  if (
    record.schemaVersion !== 0 ||
    record.experimentId !== 'slug-root-branch-001' ||
    typeof record.baseCommit !== 'string' ||
    !/^[0-9a-f]{40}$/.test(record.baseCommit)
  ) {
    throw new TypeError('root-branch experiment manifest is invalid')
  }
  return record as { readonly baseCommit: string }
}

function assertObservation(
  candidate: unknown,
  expectedBaseCommit: string,
  expectedCandidateCommit: string,
): Record<string, unknown> & { readonly runs: readonly CapturedRun[] } {
  const candidateObservation = objectRecord(candidate, 'root-branch performance observation')
  if (
    candidateObservation.schemaVersion !== 0 ||
    candidateObservation.kind !== 'slug-root-branch-performance-observation' ||
    candidateObservation.experimentId !== 'slug-root-branch-001' ||
    candidateObservation.baseCommit !== expectedBaseCommit ||
    candidateObservation.candidateCommit !== expectedCandidateCommit ||
    candidateObservation.dpr !== 2 ||
    candidateObservation.roundCount !== 5 ||
    candidateObservation.steadyStateReportCount !== 12 ||
    !Array.isArray(candidateObservation.runs) ||
    candidateObservation.runs.length !== 140
  ) {
    throw new TypeError('root-branch performance observation has an invalid envelope')
  }
  const runs: CapturedRun[] = []
  const expectedIds = new Set(
    ['webgpu', 'webgl2'].flatMap((backend) =>
      FONT_FIXTURES.flatMap((fontFixture) =>
        Array.from({ length: 5 }, (_, round) =>
          (['baseline', 'root-branch'] as const).map(
            (variant) => `${backend}-${fontFixture}-r${String(round)}-${variant}`,
          ),
        ).flat(),
      ),
    ),
  )
  for (const candidateRun of candidateObservation.runs) {
    const run = objectRecord(candidateRun, 'root-branch performance run')
    const stats = objectRecord(run.stats, 'root-branch run stats')
    if (
      typeof run.id !== 'string' ||
      !expectedIds.delete(run.id) ||
      (run.backend !== 'webgpu' && run.backend !== 'webgl2') ||
      typeof run.fontFixture !== 'string' ||
      !FONT_FIXTURES.includes(run.fontFixture as FontFixture) ||
      (run.variant !== 'baseline' && run.variant !== 'root-branch') ||
      typeof run.round !== 'number' ||
      !Number.isInteger(run.round) ||
      run.round < 0 ||
      run.round >= 5 ||
      stats.technique !== 'slug' ||
      stats.backend !== run.backend ||
      stats.dpr !== 2 ||
      stats.gpuTimingSupported !== true
    ) {
      throw new TypeError('root-branch performance run identity or stats are invalid')
    }
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
  if (expectedIds.size !== 0) {
    throw new TypeError('root-branch performance observation omitted required paired runs')
  }
  return { ...candidateObservation, runs }
}

function summarize(runs: readonly CapturedRun[]): readonly Record<string, unknown>[] {
  const summaries: Record<string, unknown>[] = []
  for (const backend of ['webgpu', 'webgl2'] as const) {
    for (const fontFixture of FONT_FIXTURES) {
      const selected = runs.filter(
        (run) => run.backend === backend && run.fontFixture === fontFixture,
      )
      const baseline = selected.filter((run) => run.variant === 'baseline')
      const rootBranch = selected.filter((run) => run.variant === 'root-branch')
      assertStableResources(selected)
      const pairedGpuPercent = baseline.map((base) => {
        const candidate = rootBranch.find((run) => run.round === base.round)
        if (candidate === undefined) throw new Error('root-branch run lacks its paired baseline')
        return percent(metric(candidate, 'medianGpuMs'), metric(base, 'medianGpuMs'))
      })
      summaries.push({
        backend,
        fontFixture,
        baselineMedianGpuMs: median(baseline.map((run) => metric(run, 'medianGpuMs'))),
        rootBranchMedianGpuMs: median(rootBranch.map((run) => metric(run, 'medianGpuMs'))),
        medianPairedGpuPercent: median(pairedGpuPercent),
        pairedGpuPercent,
        baselineMedianSubmitMs: median(baseline.map((run) => metric(run, 'medianSubmitMs'))),
        rootBranchMedianSubmitMs: median(rootBranch.map((run) => metric(run, 'medianSubmitMs'))),
        baselineGpuBytes: metric(baseline[0]!, 'slugGpuBytes'),
        rootBranchGpuBytes: metric(rootBranch[0]!, 'slugGpuBytes'),
        baselineArtifactBytes: metric(baseline[0]!, 'artifactBytes'),
        rootBranchArtifactBytes: metric(rootBranch[0]!, 'artifactBytes'),
      })
    }
  }
  return summaries
}

function assertStableResources(runs: readonly CapturedRun[]): void {
  const first = runs[0]
  if (first === undefined) throw new Error('root-branch resource comparison requires runs')
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
        throw new Error(`${run.backend} ${run.fontFixture} changed ${name} across graph variants`)
      }
    }
  }
}

function metric(run: CapturedRun, name: string): number {
  const metricValue = run.stats[name]
  finiteNonNegative(metricValue, `${run.backend}.${run.fontFixture}.${run.variant}.${name}`)
  return metricValue
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
