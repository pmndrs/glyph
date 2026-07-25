import { cp, mkdir, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))

await run('cargo', [
  'build',
  '--manifest-path',
  'rust/Cargo.toml',
  '--target',
  'wasm32-unknown-unknown',
  '--release',
  '--locked',
  '--no-default-features',
])
await run('tsc', ['-p', 'tsconfig.build.json'])
await mkdir(new URL('../dist/', import.meta.url), { recursive: true })
await cp(
  new URL('../rust/target/wasm32-unknown-unknown/release/pmndrs_text_font_baker.wasm', import.meta.url),
  new URL('../dist/font_baker.wasm', import.meta.url),
)
await writeFile(
  new URL('../dist/font-baker-abi-v0.json', import.meta.url),
  await runCapture('cargo', [
    'run',
    '--manifest-path',
    'rust/Cargo.toml',
    '--bin',
    'generate-abi',
    '--locked',
    '--quiet',
  ]),
)

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
