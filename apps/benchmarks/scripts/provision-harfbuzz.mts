import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const version = '13.0.0'
const archiveSha256 = '1626ebc763d28f4bcca1531fef42e92ca995d45f8ad90ad2ae0b5d1a567fe67a'
const cacheDirectory = resolve('.cache/harfbuzz', version)
const executable = resolve(cacheDirectory, 'build/util/hb-shape')
const subsetExecutable = resolve(cacheDirectory, 'build/util/hb-subset')

if (
  (await isPinnedExecutable(executable, 'hb-shape')) &&
  (await isPinnedExecutable(subsetExecutable, 'hb-subset'))
) {
  process.stdout.write(`${executable}\n`)
  process.exit(0)
}
if (process.argv.includes('--check')) {
  throw new Error(
    `pinned HarfBuzz ${version} utilities are not provisioned under ${cacheDirectory}`,
  )
}

await mkdir(dirname(cacheDirectory), { recursive: true })
const stagingDirectory = await mkdtemp(resolve(dirname(cacheDirectory), `${version}-staging-`))
try {
  const archive = resolve(stagingDirectory, `harfbuzz-${version}.tar.xz`)
  const response = await fetch(
    `https://github.com/harfbuzz/harfbuzz/releases/download/${version}/harfbuzz-${version}.tar.xz`,
  )
  if (!response.ok) throw new Error(`HarfBuzz source request failed with HTTP ${response.status}`)
  await writeFile(archive, Buffer.from(await response.arrayBuffer()))
  const actualSha256 = createHash('sha256')
    .update(await readFile(archive))
    .digest('hex')
  if (actualSha256 !== archiveSha256) {
    throw new Error(
      `HarfBuzz source SHA-256 mismatch: expected ${archiveSha256}, received ${actualSha256}`,
    )
  }

  const sourceDirectory = resolve(stagingDirectory, 'source')
  const buildDirectory = resolve(stagingDirectory, 'build')
  await mkdir(sourceDirectory)
  await run('tar', ['-xf', archive, '-C', sourceDirectory, '--strip-components=1'])
  await run('meson', [
    'setup',
    buildDirectory,
    sourceDirectory,
    '-Dtests=disabled',
    '-Ddocs=disabled',
    '-Dutilities=enabled',
    '-Dglib=enabled',
    '-Dintrospection=disabled',
  ])
  await run('meson', ['compile', '-C', buildDirectory, 'hb-shape', 'hb-subset'])
  for (const utility of ['hb-shape', 'hb-subset'] as const) {
    if (!(await isPinnedExecutable(resolve(buildDirectory, `util/${utility}`), utility))) {
      throw new Error(`built ${utility} did not identify itself as HarfBuzz ${version}`)
    }
  }
  await rename(stagingDirectory, cacheDirectory)
} finally {
  await rm(stagingDirectory, { recursive: true, force: true })
}
process.stdout.write(`${executable}\n`)

async function isPinnedExecutable(
  path: string,
  utility: 'hb-shape' | 'hb-subset',
): Promise<boolean> {
  try {
    return (await capture(path, ['--version'])).trim() === `${utility} (HarfBuzz) ${version}`
  } catch {
    return false
  }
}

async function capture(command: string, arguments_: readonly string[]): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    const child = spawn(command, arguments_, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolveOutput(stdout)
      else reject(new Error(`${command} exited with ${String(code)}: ${stderr}`))
    })
  })
}

async function run(command: string, arguments_: readonly string[]): Promise<void> {
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn(command, arguments_, { stdio: 'inherit' })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolveRun()
      else reject(new Error(`${command} exited with ${String(code)}`))
    })
  })
}
