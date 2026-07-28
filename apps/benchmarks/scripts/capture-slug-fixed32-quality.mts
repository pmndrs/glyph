import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const executable = fileURLToPath(new URL('../node_modules/.bin/vitexec', import.meta.url))
const cwd = fileURLToPath(new URL('..', import.meta.url))
const output = new URL(
  '../fixtures/autoresearch/slug-fixed32-bands-001/quality-chromium149.json',
  import.meta.url,
)
const child = spawn(
  executable,
  ['--gpu', '--path', '/?runner=probe', './vitexec/slug-fixed32-quality.probe.ts'],
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
  throw new Error(`fixed-32 quality capture failed with status ${String(code)}`)
}
const marker = /slug-fixed32-quality-ready (\{[^\n]+\})/.exec(transcript)?.[1]
if (marker === undefined) throw new Error('fixed-32 quality capture omitted its result marker')
const value: unknown = JSON.parse(marker)
assertObservation(value)
await writeFile(output, `${JSON.stringify(value, null, 2)}\n`)

function assertObservation(candidate: unknown): asserts candidate is Record<string, unknown> {
  const observation = objectRecord(candidate, 'fixed-32 quality observation')
  if (
    observation.schemaVersion !== 0 ||
    observation.kind !== 'slug-fixed32-quality-observation' ||
    observation.experimentId !== 'slug-fixed32-bands-001' ||
    typeof observation.baseCommit !== 'string' ||
    !/^[0-9a-f]{40}$/.test(observation.baseCommit) ||
    typeof observation.capturedAt !== 'string' ||
    Number.isNaN(Date.parse(observation.capturedAt)) ||
    !Array.isArray(observation.observations) ||
    observation.observations.length !== 28
  ) {
    throw new TypeError('fixed-32 quality observation has an invalid envelope')
  }
  const identities = new Set<string>()
  for (const candidateEntry of observation.observations) {
    const entry = objectRecord(candidateEntry, 'fixed-32 quality entry')
    const identity = `${String(entry.backend)}-${String(entry.dpr)}-${String(entry.fontFixture)}`
    if (
      identities.has(identity) ||
      (entry.backend !== 'webgpu' && entry.backend !== 'webgl2') ||
      (entry.dpr !== 1 && entry.dpr !== 2) ||
      typeof entry.fontFixture !== 'string' ||
      entry.exactBaselinePixels !== true ||
      typeof entry.hash !== 'string' ||
      !/^[0-9a-f]{64}$/.test(entry.hash)
    ) {
      throw new TypeError(`invalid or duplicate fixed-32 quality entry ${identity}`)
    }
    identities.add(identity)
    for (const metricName of [
      'glyphCount',
      'evaluatedCurves',
      'meanAbsoluteError',
      'maximumError',
      'errorPixels',
      'severeErrorPixels',
    ]) {
      const metricValue = entry[metricName]
      if (typeof metricValue !== 'number' || !Number.isFinite(metricValue) || metricValue < 0) {
        throw new TypeError(`${identity}.${metricName} must be finite and non-negative`)
      }
    }
  }
}

function objectRecord(input: unknown, label: string): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError(`${label} must be an object`)
  }
  return input as Record<string, unknown>
}
