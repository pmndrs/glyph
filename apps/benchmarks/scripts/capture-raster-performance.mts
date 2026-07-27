import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const executable = fileURLToPath(new URL('../node_modules/.bin/vitexec', import.meta.url))
const cwd = fileURLToPath(new URL('..', import.meta.url))
const output = new URL('../fixtures/results/raster-performance-chromium149.json', import.meta.url)
const child = spawn(
  executable,
  [
    '--gpu',
    '--path',
    '/?mode=benchmark&technique=bitmap&backend=webgpu&workload=paint-effects&dpr=1',
    './vitexec/raster-performance.probe.ts',
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
  throw new Error(`Raster performance capture failed with status ${String(code)}`)
}
const marker = /raster-performance-ready (\{[^\n]+\})/.exec(transcript)?.[1]
if (marker === undefined) throw new Error('Raster performance capture omitted its result marker')
const value: unknown = JSON.parse(marker)
assertObservation(value)
await writeFile(output, `${JSON.stringify(value, null, 2)}\n`)

function assertObservation(candidate: unknown): asserts candidate is Record<string, unknown> {
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    throw new TypeError('Raster performance observation must be an object')
  }
  const record = candidate as Record<string, unknown>
  if (
    record.schemaVersion !== 0 ||
    record.kind !== 'raster-performance-observation' ||
    record.backend !== 'webgpu' ||
    record.dpr !== 1 ||
    record.workload !== 'paint-effects' ||
    record.steadyStateReportCount !== 12 ||
    !Array.isArray(record.observations) ||
    record.observations.length !== 2 ||
    !Array.isArray(record.bundleIsolation) ||
    record.bundleIsolation.length !== 6
  ) {
    throw new TypeError('Raster performance observation has an invalid envelope')
  }
  for (const observation of record.observations) {
    if (typeof observation !== 'object' || observation === null || Array.isArray(observation)) {
      throw new TypeError('Raster performance entry must be an object')
    }
    for (const [name, metric] of Object.entries(observation)) {
      if (name === 'technique') continue
      if (typeof metric !== 'number' || !Number.isFinite(metric) || metric < 0) {
        throw new TypeError(`${name} must be a finite non-negative number`)
      }
    }
  }
}
