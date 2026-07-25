import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

interface ProcessResult {
  code: number | null
  output: string
}

interface LifecycleResult {
  schemaVersion: number
  executions: number
  uniqueCompletions: number
  environment: {
    browser: string
    hardwareConcurrency: number
    webgpu: boolean
    crossOriginIsolated: boolean
  }
}

const root = fileURLToPath(new URL('..', import.meta.url))
const executable = fileURLToPath(new URL('../node_modules/.bin/vitexec', import.meta.url))
const admissionProbe = './vitexec/admission.probe.ts'
const outputIndex = process.argv.indexOf('--output')
const outputPath = resolve(
  root,
  outputIndex === -1
    ? './fixtures/admission/harness-v0.json'
    : (process.argv[outputIndex + 1] ?? ''),
)

async function runProbe(path: string, timeout: number): Promise<ProcessResult> {
  const child = spawn(executable, ['--gpu', '--timeout', String(timeout), path], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      output += text
      process.stdout.write(text)
    })
  }
  const code = await new Promise<number | null>((resolveCode, reject) => {
    child.once('error', reject)
    child.once('exit', resolveCode)
  })
  return { code, output }
}

const wrong = await runProbe('./vitexec/negative-wrong.probe.ts', 15)
if (
  !wrong.output.includes('[error]') ||
  !wrong.output.includes('negative-control expected hash mismatch')
) {
  throw new Error('wrong-expectation negative control did not fail for the expected reason')
}
const withheld = await runProbe('./vitexec/negative-withheld.probe.ts', 2)
if (!withheld.output.includes('[error]') || !withheld.output.toLowerCase().includes('timeout')) {
  throw new Error('withheld-completion negative control did not reach the watchdog')
}

const lifecycles: LifecycleResult[] = []
for (let lifecycle = 0; lifecycle < 10; lifecycle += 1) {
  const result = await runProbe(admissionProbe, 30)
  if (result.code !== 0 || result.output.includes('[error]')) {
    throw new Error(`admission lifecycle ${lifecycle} failed`)
  }
  const line = result.output.split('\n').find((value) => value.includes('admission-lifecycle '))
  const marker = line?.indexOf('admission-lifecycle ')
  if (line === undefined || marker === undefined || marker < 0) {
    throw new Error(`admission lifecycle ${lifecycle} emitted no structured result`)
  }
  lifecycles.push(JSON.parse(line.slice(marker + 'admission-lifecycle '.length)))
}

const executions = lifecycles.reduce((total, lifecycle) => total + lifecycle.executions, 0)
if (executions !== 100 || lifecycles.some((lifecycle) => lifecycle.uniqueCompletions !== 10)) {
  throw new Error('admission did not produce 100 unique causal completions')
}
const probeBytes = await readFile(resolve(root, admissionProbe))
const record = {
  schemaVersion: 0,
  id: 'harness-v0',
  appCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  probe: {
    file: admissionProbe,
    sha256: createHash('sha256').update(probeBytes).digest('hex'),
  },
  policy: {
    retries: 0,
    executions,
    freshBrowserServerLifecycles: lifecycles.length,
    executionsPerLifecycle: 10,
  },
  negativeControls: {
    wrongExpectation: 'failed-as-required',
    withheldCompletion: 'watchdog-failed-as-required',
  },
  capabilityClaim: {
    workload: 'deterministic-browser-runner',
    gpuWorkload: false,
    note: 'GPU-friendly Chromium launch records WebGPU availability but does not claim a GPU rendering pass.',
  },
  lifecycles: lifecycles.map((result, index) => ({ index, ...result })),
}
await mkdir(dirname(outputPath), { recursive: true })
await writeFile(outputPath, `${JSON.stringify(record, undefined, 2)}\n`)
