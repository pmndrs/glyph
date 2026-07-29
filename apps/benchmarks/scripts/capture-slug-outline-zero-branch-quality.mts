import { execFile, spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const executable = fileURLToPath(new URL('../node_modules/.bin/vitexec', import.meta.url))
const cwd = fileURLToPath(new URL('..', import.meta.url))
const packet = new URL('../fixtures/autoresearch/slug-outline-zero-branch-001/', import.meta.url)
const output = new URL('quality-chromium149.json', packet)
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
    './vitexec/slug-outline-zero-branch-quality.probe.ts',
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
  throw new Error(`outline zero-branch quality capture failed with status ${String(code)}`)
}
const marker = /slug-outline-zero-branch-quality-ready (\{[^\n]+\})/.exec(transcript)?.[1]
if (marker === undefined) throw new Error('outline zero-branch quality capture omitted its result')
const observation = assertObservation(JSON.parse(marker), baseCommit, candidateCommit)
await mkdir(packet, { recursive: true })
const generated = new URL('generated/', packet)
await mkdir(generated, { recursive: true })
const retainedShaders = []
for (const candidateShader of observation.shaders) {
  const shader = objectRecord(candidateShader, 'outline zero-branch shader record')
  const backend = shader.backend as 'webgpu' | 'webgl2'
  const suffix = backend === 'webgpu' ? 'wgsl' : 'glsl'
  const baselineSource = requiredString(shader.baselineSource, `${backend}.baselineSource`)
  const candidateSource = requiredString(shader.candidateSource, `${backend}.candidateSource`)
  await Promise.all([
    writeFile(new URL(`multiply-zero.${backend}.${suffix}`, generated), baselineSource),
    writeFile(new URL(`zero-width-branch.${backend}.${suffix}`, generated), candidateSource),
  ])
  const { baselineSource: _baselineSource, candidateSource: _candidateSource, ...retained } = shader
  retainedShaders.push(retained)
}
await writeFile(
  output,
  `${JSON.stringify({ ...observation, shaders: retainedShaders }, null, 2)}\n`,
)

function assertObservation(
  candidate: unknown,
  expectedBaseCommit: string,
  expectedCandidateCommit: string,
): Record<string, unknown> & { readonly shaders: readonly unknown[] } {
  const record = objectRecord(candidate, 'outline zero-branch quality observation')
  if (
    record.schemaVersion !== 0 ||
    record.kind !== 'slug-outline-zero-branch-quality-observation' ||
    record.experimentId !== 'slug-outline-zero-branch-001' ||
    record.baseCommit !== expectedBaseCommit ||
    record.candidateCommit !== expectedCandidateCommit ||
    record.authority !== 'exact-mixed-and-all-framebuffers-with-membership-negative-control' ||
    !Array.isArray(record.cases) ||
    record.cases.length !== 8 ||
    !Array.isArray(record.shaders) ||
    record.shaders.length !== 2
  ) {
    throw new TypeError('outline zero-branch quality observation has an invalid envelope')
  }
  const expectedCells = new Set(
    ['webgpu', 'webgl2'].flatMap((backend) =>
      [1, 2].flatMap((dpr) =>
        ['alternating', 'all'].map((pattern) => `${backend}-${String(dpr)}-${pattern}`),
      ),
    ),
  )
  for (const candidateCase of record.cases) {
    const entry = objectRecord(candidateCase, 'outline zero-branch quality cell')
    const id = `${String(entry.backend)}-${String(entry.dpr)}-${String(entry.paintStrokePattern)}`
    if (
      !expectedCells.delete(id) ||
      entry.width !== 720 ||
      entry.height !== 340 ||
      entry.drawCount !== 1 ||
      entry.exactPixels !== true ||
      entry.baselineHash !== entry.candidateHash ||
      typeof entry.baselineHash !== 'string' ||
      !/^[0-9a-f]{64}$/.test(entry.baselineHash)
    ) {
      throw new TypeError('outline zero-branch quality cell is invalid')
    }
    finitePositive(entry.glyphCount, `${id}.glyphCount`)
    finiteNonNegative(entry.baselineRenderSubmitMs, `${id}.baselineRenderSubmitMs`)
    finiteNonNegative(entry.candidateRenderSubmitMs, `${id}.candidateRenderSubmitMs`)
  }
  if (expectedCells.size !== 0)
    throw new TypeError('outline zero-branch quality cells are incomplete')
  if (
    !Array.isArray(record.membershipNegativeControls) ||
    record.membershipNegativeControls.length !== 4
  ) {
    throw new TypeError('outline zero-branch membership negative controls are incomplete')
  }
  for (const candidateControl of record.membershipNegativeControls) {
    const control = objectRecord(candidateControl, 'outline-membership negative control')
    if (
      control.alternatingHash === control.allHash ||
      typeof control.alternatingHash !== 'string' ||
      typeof control.allHash !== 'string'
    ) {
      throw new TypeError('outline-membership negative control hashes are invalid')
    }
    finitePositive(control.changedPixelCount, 'outline-membership changedPixelCount')
  }
  const expectedShaders = new Set(['webgpu', 'webgl2'])
  for (const candidateShader of record.shaders) {
    const entry = objectRecord(candidateShader, 'outline zero-branch shader record')
    if (
      typeof entry.backend !== 'string' ||
      !expectedShaders.delete(entry.backend) ||
      entry.distinctPrograms !== true ||
      entry.baselineSha256 === entry.candidateSha256 ||
      typeof entry.baselineSha256 !== 'string' ||
      typeof entry.candidateSha256 !== 'string' ||
      !/^[0-9a-f]{64}$/.test(entry.baselineSha256) ||
      !/^[0-9a-f]{64}$/.test(entry.candidateSha256)
    ) {
      throw new TypeError('outline zero-branch shader record is invalid')
    }
    finitePositive(entry.baselineBytes, `${entry.backend}.baselineBytes`)
    finitePositive(entry.candidateBytes, `${entry.backend}.candidateBytes`)
    finiteNonNegative(entry.baselineGreaterThanCount, `${entry.backend}.baselineGreaterThanCount`)
    finitePositive(entry.candidateGreaterThanCount, `${entry.backend}.candidateGreaterThanCount`)
    if (
      (entry.candidateGreaterThanCount as number) <
      (entry.baselineGreaterThanCount as number) + 2
    ) {
      throw new TypeError(`${entry.backend} candidate omitted its visibility comparisons`)
    }
    requiredString(entry.baselineSource, `${entry.backend}.baselineSource`)
    requiredString(entry.candidateSource, `${entry.backend}.candidateSource`)
  }
  if (expectedShaders.size !== 0)
    throw new TypeError('outline zero-branch shader records are incomplete')
  return record as Record<string, unknown> & { readonly shaders: readonly unknown[] }
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

function requiredString(candidate: unknown, label: string): string {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`)
  }
  return candidate
}

function finiteNonNegative(candidate: unknown, label: string): asserts candidate is number {
  if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate < 0) {
    throw new TypeError(`${label} must be finite and non-negative`)
  }
}

function finitePositive(candidate: unknown, label: string): asserts candidate is number {
  finiteNonNegative(candidate, label)
  if (candidate === 0) throw new TypeError(`${label} must be positive`)
}
