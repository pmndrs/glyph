import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const executable = fileURLToPath(new URL('../node_modules/.bin/vitexec', import.meta.url))
const cwd = fileURLToPath(new URL('..', import.meta.url))
const output = new URL(
  '../fixtures/results/icon-grid-retained-evidence-chromium149.json',
  import.meta.url,
)
const child = spawn(
  executable,
  [
    '--gpu',
    '--timeout',
    '300',
    '--path',
    '/?mode=benchmark&technique=bitmap&backend=webgpu&delivery=baked&dpr=1&font=inter&workload=icon-grid',
    './vitexec/icon-grid.probe.ts',
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
  throw new Error(`Icon-grid retained-evidence capture failed with status ${String(code)}`)
}
const marker = /icon-grid-retained-evidence-ready (\{[^\n]+\})/.exec(transcript)?.[1]
if (marker === undefined) throw new Error('Icon-grid capture omitted its result marker')
const value: unknown = JSON.parse(marker)
assertObservation(value)
await writeFile(output, `${JSON.stringify(value, null, 2)}\n`)

function assertObservation(candidate: unknown): asserts candidate is Record<string, unknown> {
  const observation = object(candidate, 'Icon-grid retained evidence')
  if (
    observation.schemaVersion !== 0 ||
    observation.kind !== 'icon-grid-retained-evidence' ||
    observation.authority !== 'causal-window-revision-and-exact-assignment-signature' ||
    observation.catalogItemCount !== 1_402 ||
    typeof observation.capturedAt !== 'string' ||
    Number.isNaN(Date.parse(observation.capturedAt)) ||
    typeof observation.browser !== 'string' ||
    !Array.isArray(observation.cases) ||
    observation.cases.length !== 3
  ) {
    throw new TypeError('Icon-grid retained evidence has an invalid envelope')
  }
  const environment = object(observation.environment, 'Icon-grid environment')
  if (environment.webgpu !== true) throw new TypeError('Icon-grid evidence requires WebGPU')
  const adapter = object(observation.gpuAdapter, 'Icon-grid GPU adapter')
  if (typeof adapter.vendor !== 'string' || typeof adapter.architecture !== 'string') {
    throw new TypeError('Icon-grid evidence requires a GPU adapter identity')
  }
  const provenance = object(observation.provenance, 'Icon-grid provenance')
  if (
    provenance.catalogPath !==
      'apps/benchmarks/fixtures/fonts/font-awesome-free-6.7.2/icons.json' ||
    provenance.catalogFixtureSha256 !==
      '1619fee77e078bc015218bd2c0ac0ae045c307b843bd09dba99c52e20ae5079d' ||
    provenance.catalogVersion !== '6.7.2' ||
    provenance.catalogSourceUrl !==
      'https://raw.githubusercontent.com/FortAwesome/Font-Awesome/6.7.2/metadata/icons.json' ||
    provenance.catalogSourceSha256 !==
      'a3a705d0e03c4fbdf1a61aece3d8fd462024b33794187ef7ee2a0764439170eb' ||
    provenance.fontPath !==
      'apps/benchmarks/fixtures/fonts/font-awesome-free-6.7.2/fa-solid-900.ttf' ||
    provenance.fontSha256 !== 'af19d135d3a935b3ebfbd80320716ffe1202052c5f68dc2c5f1abc57005ac605' ||
    !hexDigest(provenance.assignmentCatalogSha256)
  ) {
    throw new TypeError('Icon-grid evidence changed its authenticated fixture provenance')
  }
  const expectedTechniques = new Set(['bitmap', 'mtsdf', 'slug'])
  for (const candidateCase of observation.cases) {
    const evidence = object(candidateCase, 'Icon-grid technique evidence')
    if (
      typeof evidence.technique !== 'string' ||
      !expectedTechniques.delete(evidence.technique) ||
      evidence.traversal !== 'two-axis-serpentine-75-percent-viewport-stride' ||
      evidence.observedAssignmentCount !== 1_402 ||
      evidence.finalMissingGlyphCount !== 0 ||
      evidence.resetMissingGlyphCount !== 0
    ) {
      throw new TypeError('Icon-grid technique evidence is incomplete')
    }
    for (const field of [
      'horizontalStops',
      'verticalStops',
      'windowsVisited',
      'uniqueWindowSignatures',
      'initialRevision',
      'finalRevision',
      'resetRevision',
      'minimumPoolCapacity',
      'maximumPoolCapacity',
      'maximumScrollX',
      'maximumScrollY',
      'finalAssignedCount',
      'resetAssignedCount',
    ] as const) {
      finitePositive(evidence[field], `${evidence.technique}.${field}`)
    }
    if (
      (evidence.finalRevision as number) <= (evidence.initialRevision as number) ||
      (evidence.resetRevision as number) <= (evidence.finalRevision as number) ||
      (evidence.minimumPoolCapacity as number) >= 1_402 ||
      (evidence.maximumPoolCapacity as number) >= 1_402
    ) {
      throw new TypeError(`${evidence.technique} did not prove recycling and reset revisions`)
    }
  }
  if (expectedTechniques.size !== 0) throw new TypeError('Icon-grid evidence omitted a technique')
}

function object(candidate: unknown, label: string): Record<string, unknown> {
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    throw new TypeError(`${label} must be an object`)
  }
  return candidate as Record<string, unknown>
}

function finitePositive(candidate: unknown, label: string): void {
  if (typeof candidate !== 'number' || !Number.isFinite(candidate) || candidate <= 0) {
    throw new TypeError(`${label} must be finite and positive`)
  }
}

function hexDigest(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && /^[0-9a-f]{64}$/u.test(candidate)
}
