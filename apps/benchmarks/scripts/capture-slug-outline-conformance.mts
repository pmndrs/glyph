import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const executable = fileURLToPath(new URL('../node_modules/.bin/vitexec', import.meta.url))
const cwd = fileURLToPath(new URL('..', import.meta.url))
const output = new URL(
  '../fixtures/results/slug-outline-conformance-chromium149.json',
  import.meta.url,
)

const child = spawn(
  executable,
  [
    '--gpu',
    '--timeout',
    '300',
    '--path',
    '/?runner=probe',
    './vitexec/slug-outline-conformance.probe.ts',
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
  throw new Error(`Slug outline conformance capture failed with status ${String(code)}`)
}
const marker = /slug-outline-conformance-ready (\{[^\n]+\})/.exec(transcript)?.[1]
if (marker === undefined) throw new Error('Slug outline conformance omitted its result marker')
const value: unknown = JSON.parse(marker)
assertObservation(value)
await writeFile(output, `${JSON.stringify(value, null, 2)}\n`)

function assertObservation(candidate: unknown): asserts candidate is Record<string, unknown> {
  const observation = object(candidate, 'Slug outline conformance')
  if (
    observation.schemaVersion !== 0 ||
    observation.kind !== 'slug-outline-conformance-observation' ||
    observation.authority !== 'independent-cpu-slug-stroke-reference' ||
    typeof observation.capturedAt !== 'string' ||
    Number.isNaN(Date.parse(observation.capturedAt)) ||
    !Array.isArray(observation.cases)
  ) {
    throw new TypeError('Slug outline conformance has an invalid envelope')
  }
  const environment = object(observation.environment, 'Slug outline environment')
  if (environment.webgpu !== true || typeof environment.browser !== 'string') {
    throw new TypeError('Slug outline conformance requires a WebGPU-capable browser identity')
  }
  const adapter = object(observation.gpuAdapter, 'Slug outline GPU adapter')
  if (typeof adapter.vendor !== 'string' || typeof adapter.architecture !== 'string') {
    throw new TypeError('Slug outline conformance requires a GPU adapter identity')
  }

  const expected = new Set(['webgpu:1', 'webgpu:2', 'webgl2:1', 'webgl2:2'])
  const observed = new Set<string>()
  for (const candidateCase of observation.cases) {
    const entry = object(candidateCase, 'Slug outline conformance case')
    const key = `${String(entry.backend)}:${String(entry.dpr)}`
    if (!expected.has(key) || observed.has(key)) {
      throw new TypeError(`Unexpected or duplicate Slug outline case: ${key}`)
    }
    observed.add(key)
    if (
      entry.physicalFontSize !== 160 ||
      entry.physicalOutlineWidth !== 8 ||
      entry.glyphCount !== 4 ||
      !hexDigest(entry.fillHash) ||
      !hexDigest(entry.outlineHash) ||
      entry.fillHash === entry.outlineHash ||
      entry.fillInkPixels !== 18_327 ||
      entry.outlineInkPixels !== 38_434 ||
      entry.severeErrorPixels !== 0
    ) {
      throw new TypeError(`Slug outline case ${key} changed its physical or pixel contract`)
    }
    const expansion = object(entry.expansion, `Slug outline ${key} expansion`)
    if (['left', 'top', 'right', 'bottom'].some((side) => expansion[side] !== 8)) {
      throw new TypeError(`Slug outline case ${key} is not centered at an 8-pixel radius`)
    }
    finiteAtMost(entry.meanAbsoluteError, 0.01, `${key}.meanAbsoluteError`)
    finiteAtMost(entry.maximumError, 20, `${key}.maximumError`)
    finiteAtMost(entry.errorPixels, 32, `${key}.errorPixels`)
    finiteAtMost(entry.renderSubmitMs, Number.POSITIVE_INFINITY, `${key}.renderSubmitMs`)
    if (typeof entry.wrongReferenceMeanError !== 'number' || entry.wrongReferenceMeanError <= 10) {
      throw new TypeError(`Slug outline case ${key} did not reject its fill-only negative control`)
    }
  }
  if (observed.size !== expected.size) {
    throw new TypeError('Slug outline conformance observation is incomplete')
  }
}

function object(candidate: unknown, label: string): Record<string, unknown> {
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    throw new TypeError(`${label} must be an object`)
  }
  return candidate as Record<string, unknown>
}

function hexDigest(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && /^[0-9a-f]{64}$/u.test(candidate)
}

function finiteAtMost(candidate: unknown, maximum: number, label: string): void {
  if (
    typeof candidate !== 'number' ||
    !Number.isFinite(candidate) ||
    candidate < 0 ||
    candidate > maximum
  ) {
    throw new TypeError(`${label} must be finite and between zero and ${String(maximum)}`)
  }
}
