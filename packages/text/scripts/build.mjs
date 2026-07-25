import { spawn } from 'node:child_process'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const executable = process.platform === 'win32' ? 'wasm-opt.CMD' : 'wasm-opt'
const wasmOpt = fileURLToPath(new URL(`../node_modules/.bin/${executable}`, import.meta.url))
const rustWasm = fileURLToPath(
  new URL(
    '../rust/bitmap-baker/target/wasm32-unknown-unknown/release/pmndrs_text_bitmap_baker.wasm',
    import.meta.url,
  ),
)
const distributedWasm = fileURLToPath(new URL('../dist/bitmap_baker.wasm', import.meta.url))

await run('cargo', [
  'build',
  '--manifest-path',
  'rust/bitmap-baker/Cargo.toml',
  '--target',
  'wasm32-unknown-unknown',
  '--release',
  '--locked',
  '--no-default-features',
])
await run('tsc', ['-p', 'tsconfig.build.json'])
await mkdir(new URL('../dist/', import.meta.url), { recursive: true })
await run(wasmOpt, [
  '--enable-bulk-memory',
  '--enable-nontrapping-float-to-int',
  '-Oz',
  rustWasm,
  '-o',
  distributedWasm,
])
await writeFile(
  new URL('../dist/bitmap-baker-abi-v0.json', import.meta.url),
  await runCapture('cargo', [
    'run',
    '--manifest-path',
    'rust/bitmap-baker/Cargo.toml',
    '--bin',
    'generate-bitmap-abi',
    '--locked',
    '--quiet',
  ]),
)
if (process.platform !== 'win32') {
  await chmod(new URL('../dist/node/cli.js', import.meta.url), 0o755)
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: packageRoot, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} exited with ${code ?? signal}`))
    })
  })
}

function runCapture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: packageRoot, stdio: ['ignore', 'pipe', 'inherit'] })
    const chunks = []
    child.stdout.on('data', (chunk) => chunks.push(chunk))
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve(Buffer.concat(chunks))
      else reject(new Error(`${command} exited with ${code ?? signal}`))
    })
  })
}
