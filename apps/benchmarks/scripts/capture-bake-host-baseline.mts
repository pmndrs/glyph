import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Browser } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'

import { createFontBaker } from '@pmndrs/text-font-baker'
import { median } from '../src/benchmark/statistics.ts'
import { launchProjectChromium } from './support/project-chromium.mts'

interface PhaseSample {
  readonly coldMs: number
  readonly warmMs: number
}

const sampleCount = 3
const appDirectory = fileURLToPath(new URL('..', import.meta.url))
const sourceUrl = new URL('../fixtures/fonts/inter-v4.1/Inter-Regular.ttf', import.meta.url)
const wasmUrl = new URL('../../../packages/font-baker/dist/font_baker.wasm', import.meta.url)
const outputUrl = new URL('../fixtures/results/bake-host-baseline-v0.json', import.meta.url)
const [source, wasm] = await Promise.all([readFile(sourceUrl), readFile(wasmUrl)])
const offlineSamples: PhaseSample[] = []
let artifactBytes = 0
let artifactSha256 = ''

for (let sample = 0; sample < sampleCount; sample += 1) {
  const started = performance.now()
  const baker = await createFontBaker(wasm)
  const coldResult = baker.bake({
    source,
    descriptor: { formatVersion: 0, fontFaceIndex: 0 },
  })
  const coldFinished = performance.now()
  const warmResult = baker.bake({
    source,
    descriptor: { formatVersion: 0, fontFaceIndex: 0 },
  })
  const warmFinished = performance.now()
  const coldArtifact = coldResult.artifacts[0]
  const warmArtifact = warmResult.artifacts[0]
  if (coldArtifact === undefined || warmArtifact === undefined) {
    throw new Error('offline baker returned no artifact')
  }
  if (!coldArtifact.bytes.every((byte, index) => warmArtifact.bytes[index] === byte)) {
    throw new Error('offline cold and warm artifacts differ')
  }
  artifactBytes = coldArtifact.bytes.byteLength
  artifactSha256 = createHash('sha256').update(coldArtifact.bytes).digest('hex')
  offlineSamples.push({
    coldMs: coldFinished - started,
    warmMs: warmFinished - coldFinished,
  })
}

let server: ViteDevServer | undefined
let browser: Browser | undefined
try {
  server = await createServer({
    root: appDirectory,
    logLevel: 'silent',
    server: { host: '127.0.0.1', port: 5184, strictPort: true },
  })
  await server.listen()
  browser = await launchProjectChromium({ headless: true })
  const workerSamples: PhaseSample[] = []
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const context = await browser.newContext()
    const page = await context.newPage()
    const errors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('http://127.0.0.1:5184/', { waitUntil: 'domcontentloaded' })
    const result = await page.evaluate(async () => {
      const modulePath = '/src/benchmark/bake-host-baseline.ts'
      const { measureWorkerBakeHost } = await import(/* @vite-ignore */ modulePath)
      return measureWorkerBakeHost()
    })
    await context.close()
    if (errors.length > 0) throw new Error(`Worker baseline browser errors: ${errors.join(' | ')}`)
    if (result.artifactBytes !== artifactBytes || result.artifactSha256 !== artifactSha256) {
      throw new Error('offline and Worker bake artifacts differ')
    }
    workerSamples.push({ coldMs: result.coldMs, warmMs: result.warmMs })
  }

  const report = {
    schemaVersion: 0,
    capturedAt: new Date().toISOString(),
    environment: {
      platform: process.platform,
      architecture: process.arch,
      browser: browser.version(),
    },
    artifact: { bytes: artifactBytes, sha256: artifactSha256 },
    offline: summarize(offlineSamples),
    worker: summarize(workerSamples),
  }
  const serialized = `${JSON.stringify(report, null, 2)}\n`
  await writeFile(outputUrl, serialized)
  process.stdout.write(serialized)
} finally {
  if (browser !== undefined) await browser.close()
  if (server !== undefined) await server.close()
}

function summarize(samples: readonly PhaseSample[]) {
  return {
    coldMedianMs: median(samples.map(({ coldMs }) => coldMs)),
    warmMedianMs: median(samples.map(({ warmMs }) => warmMs)),
    samples,
  }
}
