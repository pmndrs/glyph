import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const executable = fileURLToPath(new URL('../node_modules/.bin/vitexec', import.meta.url))
const cwd = fileURLToPath(new URL('..', import.meta.url))

async function runProbe(path: string, humanSurface = false): Promise<void> {
  const args = humanSurface ? ['--gpu', path] : ['--gpu', '--path', '/?runner=probe', path]
  const child = spawn(executable, args, {
    cwd,
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

  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', resolve)
  })

  if (code !== 0 || output.includes('[error]')) {
    throw new Error(
      `Vitexec ${path} failed${code === 0 ? ' in the browser' : ` with status ${String(code)}`}`,
    )
  }
}

await runProbe('./vitexec/advanced-shaping-performance.probe.ts', true)
await runProbe('./vitexec/harness.probe.ts', true)
await runProbe('./vitexec/comparison-workloads.probe.ts', true)

for (const probe of [
  './vitexec/tsl-renderer.probe.ts',
  './vitexec/mtsdf-text.probe.ts',
  './vitexec/source-outline-fidelity.probe.ts',
  './vitexec/runtime-fallback.probe.ts',
  './vitexec/bitmap-text.probe.ts',
  './vitexec/core-text-frame.probe.ts',
  './vitexec/react-font-suspense.probe.ts',
  './vitexec/react-text-reconciliation.probe.ts',
  './vitexec/cjk-universality.probe.ts',
  './vitexec/worker-queue.probe.ts',
]) {
  await runProbe(probe)
}

await import('./run-mobile-probe.mts')
