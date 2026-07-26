import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

interface Arguments {
  readonly cases: readonly BenchmarkCase[]
  readonly samples: number
  readonly warmup: number
  readonly port: number
  readonly output?: string
}

interface BenchmarkCase {
  readonly targetId: string
  readonly scenarioId: string
}

const conformanceCases: readonly BenchmarkCase[] = [
  { targetId: 'synthetic', scenarioId: 'overview' },
  { targetId: 'font-baker', scenarioId: 'cold-load-payload' },
  { targetId: 'font-loader-worker', scenarioId: 'worker-fallback' },
  { targetId: 'harfrust-shaper', scenarioId: 'shaping-conformance' },
  { targetId: 'paragraph-engine', scenarioId: 'paragraph-measurement' },
  { targetId: 'paragraph-layout-engine', scenarioId: 'paragraph-layout' },
  { targetId: 'paragraph-bidi-policy', scenarioId: 'paragraph-bidi-policy' },
  { targetId: 'cjk-universality', scenarioId: 'cjk-universality' },
]

const readinessTimeoutMs = 30_000
const browserLaunchTimeoutMs = 60_000
const navigationTimeoutMs = 30_000
const benchmarkTimeoutMs = 180_000

function parseArguments(values: readonly string[]): Arguments {
  const result: Record<string, string> = {}
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index]
    const value = values[index + 1]
    if (name === undefined || !name.startsWith('--') || value === undefined) {
      throw new Error('Arguments must be supplied as --name value pairs')
    }
    result[name.slice(2)] = value
  }
  const samples = Number(result.samples ?? 32)
  const warmup = Number(result.warmup ?? 4)
  const port = Number(result.port ?? 5173)
  if (!Number.isSafeInteger(samples) || samples < 1) throw new Error('samples must be positive')
  if (!Number.isSafeInteger(warmup) || warmup < 0) throw new Error('warmup must be non-negative')
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535)
    throw new Error('port must be a valid TCP port')
  const suite = result.suite
  if (suite !== undefined && suite !== 'conformance') {
    throw new Error(`Unknown headless suite: ${suite}`)
  }
  return {
    cases:
      suite === 'conformance'
        ? conformanceCases
        : [
            {
              targetId: result.target ?? 'synthetic',
              scenarioId: result.scenario ?? 'overview',
            },
          ],
    samples,
    warmup,
    port,
    ...(result.output === undefined ? {} : { output: result.output }),
  }
}

const options = parseArguments(process.argv.slice(2))
const root = fileURLToPath(new URL('..', import.meta.url))
const vite = fileURLToPath(new URL('../node_modules/.bin/vite', import.meta.url))
const server = spawn(
  vite,
  ['--host', '127.0.0.1', '--port', String(options.port), '--strictPort'],
  {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  },
)

let output = ''
const ready = new Promise<void>((resolve, reject) => {
  server.once('error', reject)
  server.once('exit', (code) =>
    reject(
      new Error(
        `Vite exited before readiness (${String(code)})${output.length === 0 ? '' : `\n${output}`}`,
      ),
    ),
  )
  for (const stream of [server.stdout, server.stderr]) {
    stream.on('data', (chunk: Buffer) => {
      output += chunk.toString()
      if (output.includes('Local:')) resolve()
    })
  }
})

function reportStage(message: string): void {
  process.stderr.write(`[headless] ${message}\n`)
}

async function withinDeadline<T>(label: string, timeoutMs: number, task: Promise<T>): Promise<T> {
  let timeout: NodeJS.Timeout | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs} ms`)), timeoutMs)
  })
  try {
    return await Promise.race([task, deadline])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
  }
}

let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined

try {
  reportStage('waiting for Vite')
  await withinDeadline('Vite readiness', readinessTimeoutMs, ready)
  reportStage('launching Chromium')
  browser = await withinDeadline(
    'Chromium launch',
    browserLaunchTimeoutMs,
    chromium.launch({ headless: true }),
  )

  const summaries = []
  for (const benchmarkCase of options.cases) {
    const caseLabel = `${benchmarkCase.targetId}/${benchmarkCase.scenarioId}`
    reportStage(`${caseLabel}: opening isolated page`)
    const page = await browser.newPage()
    const errors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text())
    })
    page.on('pageerror', (error) => errors.push(error.message))
    try {
      await withinDeadline(
        `${caseLabel} navigation`,
        navigationTimeoutMs,
        page.goto(`http://127.0.0.1:${options.port}/`, { waitUntil: 'domcontentloaded' }),
      )
      reportStage(`${caseLabel}: running benchmark`)
      const summary = await withinDeadline(
        `${caseLabel} benchmark`,
        benchmarkTimeoutMs,
        page.evaluate(
          async (request) => {
            const executionPath = '/src/benchmark/execution.ts'
            const environmentPath = '/src/benchmark/environment.ts'
            const [{ runRegisteredBenchmark }, { environmentResource }] = await Promise.all([
              import(/* @vite-ignore */ executionPath),
              import(/* @vite-ignore */ environmentPath),
            ])
            return runRegisteredBenchmark({
              targetId: request.targetId,
              scenarioId: request.scenarioId,
              input: {},
              controls: { samples: request.samples, warmup: request.warmup },
              environment: await environmentResource(),
            })
          },
          { ...benchmarkCase, samples: options.samples, warmup: options.warmup },
        ),
      )
      if (errors.length > 0) throw new Error(`Headless browser errors: ${errors.join(' | ')}`)
      summaries.push(summary)
      reportStage(`${caseLabel}: passed`)
    } finally {
      await page.close()
    }
  }

  const result = options.cases.length === 1 ? summaries[0] : summaries
  const serialized = `${JSON.stringify(result, null, 2)}\n`
  if (options.output === undefined) process.stdout.write(serialized)
  else await writeFile(options.output, serialized)
} finally {
  if (browser !== undefined) await browser.close()
  server.kill('SIGTERM')
}
