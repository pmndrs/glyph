import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

interface Arguments {
  readonly targetId: string
  readonly scenarioId: string
  readonly samples: number
  readonly warmup: number
  readonly output?: string
}

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
  if (!Number.isSafeInteger(samples) || samples < 1) throw new Error('samples must be positive')
  if (!Number.isSafeInteger(warmup) || warmup < 0) throw new Error('warmup must be non-negative')
  return {
    targetId: result.target ?? 'synthetic',
    scenarioId: result.scenario ?? 'overview',
    samples,
    warmup,
    ...(result.output === undefined ? {} : { output: result.output }),
  }
}

const options = parseArguments(process.argv.slice(2))
const root = fileURLToPath(new URL('..', import.meta.url))
const vite = fileURLToPath(new URL('../node_modules/.bin/vite', import.meta.url))
const server = spawn(vite, ['--host', '127.0.0.1', '--port', '5173', '--strictPort'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
})

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

await ready
const browser = await chromium.launch({ headless: true })
const errors: string[] = []

try {
  const page = await browser.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('http://127.0.0.1:5173/', { waitUntil: 'networkidle' })
  const summary = await page.evaluate(async (request) => {
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
  }, options)
  if (errors.length > 0) throw new Error(`Headless browser errors: ${errors.join(' | ')}`)
  const serialized = `${JSON.stringify(summary, null, 2)}\n`
  if (options.output === undefined) process.stdout.write(serialized)
  else await writeFile(options.output, serialized)
} finally {
  await browser.close()
  server.kill('SIGTERM')
}
