import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const executable = fileURLToPath(new URL('../node_modules/.bin/vitexec', import.meta.url))
const cwd = fileURLToPath(new URL('..', import.meta.url))
const output = new URL(
  '../fixtures/results/slug-outline-performance-chromium149.json',
  import.meta.url,
)
const EXPECTED_BACKENDS = ['webgpu', 'webgl2'] as const
const EXPECTED_DPRS = [1, 2] as const
const EXPECTED_LOGICAL_GLYPH_COUNT = 268
const EXPECTED_VARIANTS = [
  { label: 'fill', paintStrokeWidth: 0, paintStrokePattern: 'all', expectedDrawCount: 1 },
  { label: 'outline', paintStrokeWidth: 0.1, paintStrokePattern: 'all', expectedDrawCount: 1 },
  {
    label: 'mixed',
    paintStrokeWidth: 0.1,
    paintStrokePattern: 'alternating',
    expectedDrawCount: 1,
  },
] as const
const REQUIRED_STATS = [
  'rendererInitMs',
  'fontLoadMs',
  'textReadyMs',
  'firstDrawMs',
  'uploadFrameGpuMs',
  'uploadFrameCompleteMs',
  'startupMs',
  'medianSubmitMs',
  'p95SubmitMs',
  'medianGpuMs',
  'p95GpuMs',
  'glyphCount',
  'missingGlyphCount',
  'drawCount',
  'artifactBytes',
  'slugCurveGpuBytes',
  'slugHeaderGpuBytes',
  'slugReferenceGpuBytes',
  'slugGpuBytes',
  'framebufferGpuBytes',
  'totalGpuBytes',
] as const

const child = spawn(
  executable,
  ['--gpu', '--path', '/?runner=probe', './vitexec/slug-outline-performance.probe.ts'],
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
    `Slug outline performance capture failed${code === 0 ? ' in the browser' : ` with status ${String(code)}`}`,
  )
}
const marker = /slug-outline-performance-ready (\{[^\n]+\})/.exec(transcript)?.[1]
if (marker === undefined) throw new Error('Slug outline performance omitted its result marker')
const value: unknown = JSON.parse(marker)
assertObservation(value)
await writeFile(output, `${JSON.stringify(value, null, 2)}\n`)

function assertObservation(candidate: unknown): asserts candidate is Record<string, unknown> {
  const observation = objectRecord(candidate, 'Slug outline performance')
  if (
    observation.schemaVersion !== 0 ||
    observation.kind !== 'slug-outline-performance-observation' ||
    observation.technique !== 'slug' ||
    observation.delivery !== 'baked' ||
    observation.workload !== 'paint-effects' ||
    observation.fontFixture !== 'inter' ||
    observation.animationEnabled !== false ||
    observation.steadyStateReportCount !== 12 ||
    typeof observation.capturedAt !== 'string' ||
    Number.isNaN(Date.parse(observation.capturedAt))
  ) {
    throw new TypeError('Slug outline performance has an invalid envelope')
  }
  const viewport = objectRecord(observation.viewport, 'Slug outline performance viewport')
  if (viewport.width !== 1500 || viewport.height !== 950) {
    throw new TypeError('Slug outline performance used an unexpected viewport')
  }
  const environment = objectRecord(observation.environment, 'Slug outline performance environment')
  if (environment.webgpu !== true) {
    throw new TypeError('Slug outline performance environment must report WebGPU')
  }
  const gpuAdapter = objectRecord(observation.gpuAdapter, 'Slug outline performance GPU adapter')
  if (typeof gpuAdapter.vendor !== 'string' || typeof gpuAdapter.architecture !== 'string') {
    throw new TypeError('Slug outline performance GPU adapter identity must use strings')
  }
  if (!Array.isArray(observation.cases)) {
    throw new TypeError('Slug outline performance cases must be an array')
  }

  const expectedCases = new Map(
    EXPECTED_BACKENDS.flatMap((backend) =>
      EXPECTED_DPRS.flatMap((dpr) =>
        EXPECTED_VARIANTS.map((variant) => [
          `${backend}-${dpr}x-inter-${variant.label}`,
          { backend, dpr, ...variant },
        ]),
      ),
    ),
  )
  const observedIds = new Set<string>()
  for (const candidateCase of observation.cases) {
    const entry = objectRecord(candidateCase, 'Slug outline performance case')
    const expected =
      typeof entry.id === 'string' && !observedIds.has(entry.id)
        ? expectedCases.get(entry.id)
        : undefined
    if (
      expected === undefined ||
      entry.backend !== expected.backend ||
      entry.dpr !== expected.dpr ||
      entry.variant !== expected.label ||
      entry.expectedDrawCount !== expected.expectedDrawCount ||
      entry.requestedPaintStrokePattern !== expected.paintStrokePattern ||
      entry.requestedPaintStrokeWidth !== expected.paintStrokeWidth
    ) {
      throw new TypeError('Slug outline performance case identity is invalid or duplicated')
    }
    observedIds.add(entry.id as string)
    const stats = objectRecord(entry.stats, `${entry.id} stats`)
    if (
      stats.technique !== 'slug' ||
      stats.backend !== expected.backend ||
      stats.dpr !== expected.dpr ||
      stats.workload !== 'paint-effects' ||
      stats.gpuTimingSupported !== true ||
      stats.appliedAnimationEnabled !== false ||
      stats.appliedPaintShadowEnabled !== false ||
      stats.appliedPaintStrokePattern !== expected.paintStrokePattern ||
      stats.appliedPaintStrokeWidth !== expected.paintStrokeWidth ||
      stats.drawCount !== expected.expectedDrawCount
    ) {
      throw new TypeError(`${entry.id} stats do not authenticate the requested outline case`)
    }
    for (const name of REQUIRED_STATS) finiteNonNegative(stats[name], `${entry.id}.${name}`)
    for (const name of ['submitHistory', 'fpsHistory', 'gpuHistory']) {
      const samples = stats[name]
      if (!Array.isArray(samples) || samples.length < 12) {
        throw new TypeError(`${entry.id}.${name} must retain at least 12 raw samples`)
      }
      for (const [index, sample] of samples.entries()) {
        finiteNonNegative(sample, `${entry.id}.${name}[${index}]`)
      }
    }
    if (
      stats.slugGpuBytes !==
        (stats.slugCurveGpuBytes as number) +
          (stats.slugHeaderGpuBytes as number) +
          (stats.slugReferenceGpuBytes as number) ||
      stats.atlasGpuBytes !== stats.slugGpuBytes ||
      stats.totalGpuBytes !== (stats.slugGpuBytes as number) + (stats.framebufferGpuBytes as number)
    ) {
      throw new TypeError(`${entry.id} resource-byte accounting is inconsistent`)
    }
    if (
      stats.missingGlyphCount !== 0 ||
      stats.glyphCount !== EXPECTED_LOGICAL_GLYPH_COUNT ||
      stats.slugReferenceCount === 0
    ) {
      throw new TypeError(`${entry.id} did not render complete analytic glyphs`)
    }
  }
  if (observedIds.size !== expectedCases.size) {
    throw new TypeError(
      `Slug outline performance retained ${observedIds.size} of ${expectedCases.size} required cases`,
    )
  }
}

function objectRecord(input: unknown, label: string): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError(`${label} must be an object`)
  }
  return input as Record<string, unknown>
}

function finiteNonNegative(metric: unknown, label: string): asserts metric is number {
  if (typeof metric !== 'number' || !Number.isFinite(metric) || metric < 0) {
    throw new TypeError(`${label} must be a finite non-negative number`)
  }
}
