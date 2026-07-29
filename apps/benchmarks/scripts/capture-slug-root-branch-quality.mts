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

const executable = fileURLToPath(new URL('../node_modules/.bin/vitexec', import.meta.url))
const cwd = fileURLToPath(new URL('..', import.meta.url))
const output = new URL(
  '../fixtures/autoresearch/slug-root-branch-001/quality-chromium149.json',
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
    './vitexec/slug-root-branch-quality.probe.ts',
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
  throw new Error(`root-branch quality capture failed with status ${String(code)}`)
}
const marker = /slug-root-branch-quality-ready (\{[^\n]+\})/.exec(transcript)?.[1]
if (marker === undefined) throw new Error('root-branch quality capture omitted its result marker')
const value: unknown = JSON.parse(marker)
assertObservation(value, manifest.baseCommit, candidateCommit)
await mkdir(new URL('../fixtures/autoresearch/slug-root-branch-001/', import.meta.url), {
  recursive: true,
})
await writeFile(output, `${JSON.stringify(value, null, 2)}\n`)

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
): asserts candidate is Record<string, unknown> {
  const observation = objectRecord(candidate, 'root-branch quality observation')
  if (
    observation.schemaVersion !== 0 ||
    observation.kind !== 'slug-root-branch-quality-observation' ||
    observation.experimentId !== 'slug-root-branch-001' ||
    observation.baseCommit !== expectedBaseCommit ||
    observation.candidateCommit !== expectedCandidateCommit ||
    typeof observation.capturedAt !== 'string' ||
    Number.isNaN(Date.parse(observation.capturedAt)) ||
    !Array.isArray(observation.observations) ||
    observation.observations.length !== 28 ||
    !Array.isArray(observation.shaderPrograms) ||
    observation.shaderPrograms.length !== 4
  ) {
    throw new TypeError('root-branch quality observation has an invalid envelope')
  }
  const expectedPrograms = new Set([
    'webgpu-baseline',
    'webgpu-root-branch',
    'webgl2-baseline',
    'webgl2-root-branch',
  ])
  for (const candidateProgram of observation.shaderPrograms) {
    const program = objectRecord(candidateProgram, 'root-branch shader program')
    const identity = `${String(program.backend)}-${String(program.variant)}`
    const isCandidate = program.variant === 'root-branch'
    if (
      !expectedPrograms.delete(identity) ||
      (program.backend !== 'webgpu' && program.backend !== 'webgl2') ||
      (program.variant !== 'baseline' && !isCandidate) ||
      program.language !== (program.backend === 'webgpu' ? 'wgsl' : 'glsl') ||
      typeof program.sourceBytes !== 'number' ||
      !Number.isSafeInteger(program.sourceBytes) ||
      program.sourceBytes <= 0 ||
      typeof program.sha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(program.sha256) ||
      program.rootConditionBranches !== (isCandidate ? 4 : 8) ||
      program.candidateContributionVariables !== isCandidate
    ) {
      throw new TypeError(`invalid or duplicate root-branch shader program ${identity}`)
    }
  }
  if (expectedPrograms.size !== 0) {
    throw new TypeError('root-branch quality observation omitted generated shader programs')
  }
  const expectedIdentities = new Set(
    ['webgpu', 'webgl2'].flatMap((backend) =>
      [1, 2].flatMap((dpr) =>
        FONT_FIXTURES.map((fontFixture) => `${backend}-${String(dpr)}-${fontFixture}`),
      ),
    ),
  )
  for (const candidateEntry of observation.observations) {
    const entry = objectRecord(candidateEntry, 'root-branch quality entry')
    const identity = `${String(entry.backend)}-${String(entry.dpr)}-${String(entry.fontFixture)}`
    if (
      !expectedIdentities.delete(identity) ||
      (entry.backend !== 'webgpu' && entry.backend !== 'webgl2') ||
      (entry.dpr !== 1 && entry.dpr !== 2) ||
      typeof entry.fontFixture !== 'string' ||
      !FONT_FIXTURES.includes(entry.fontFixture as (typeof FONT_FIXTURES)[number]) ||
      entry.exactBaselinePixels !== true ||
      typeof entry.hash !== 'string' ||
      !/^[0-9a-f]{64}$/.test(entry.hash)
    ) {
      throw new TypeError(`invalid or duplicate root-branch quality entry ${identity}`)
    }
    for (const metricName of [
      'glyphCount',
      'evaluatedCurves',
      'meanAbsoluteError',
      'maximumError',
      'errorPixels',
      'severeErrorPixels',
    ]) {
      finiteNonNegative(entry[metricName], `${identity}.${metricName}`)
    }
  }
  if (expectedIdentities.size !== 0) {
    throw new TypeError('root-branch quality observation omitted required corpus cells')
  }
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
