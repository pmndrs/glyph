import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const version = '1.13.0'
const tag = '1.13'
const archiveSha256 = '93cd1ad8918c1a78c5c96e82d4f4c77f0eb86c2e7e8579a0967e54196c4b7167'
const packageDirectory = fileURLToPath(new URL('..', import.meta.url))
const cacheDirectory = resolve(packageDirectory, '.cache/msdfgen', version)
const executable = resolve(cacheDirectory, 'build/msdfgen')
const expectedVersionPrefix = `MSDFgen v${version} - core only\n`

if (await isPinnedExecutable(executable)) {
  process.stdout.write(`${executable}\n`)
  process.exit(0)
}
if (process.argv.includes('--check')) {
  throw new Error(`pinned msdfgen ${version} oracle is not provisioned at ${executable}`)
}

await mkdir(dirname(cacheDirectory), { recursive: true })
const stagingDirectory = await mkdtemp(resolve(dirname(cacheDirectory), `${version}-staging-`))
try {
  const archive = resolve(stagingDirectory, `msdfgen-${version}.tar.gz`)
  const response = await fetch(
    `https://github.com/Chlumsky/msdfgen/archive/refs/tags/v${tag}.tar.gz`,
  )
  if (!response.ok) throw new Error(`msdfgen source request failed with HTTP ${response.status}`)
  await writeFile(archive, Buffer.from(await response.arrayBuffer()))
  const actualSha256 = createHash('sha256')
    .update(await readFile(archive))
    .digest('hex')
  if (actualSha256 !== archiveSha256) {
    throw new Error(
      `msdfgen source SHA-256 mismatch: expected ${archiveSha256}, received ${actualSha256}`,
    )
  }

  const sourceDirectory = resolve(stagingDirectory, 'source')
  const buildDirectory = resolve(stagingDirectory, 'build')
  await mkdir(sourceDirectory)
  await run('tar', ['-xzf', archive, '-C', sourceDirectory, '--strip-components=1'])
  await run('cmake', [
    '-S',
    sourceDirectory,
    '-B',
    buildDirectory,
    '-DCMAKE_BUILD_TYPE=Release',
    '-DMSDFGEN_CORE_ONLY=ON',
    '-DMSDFGEN_BUILD_STANDALONE=ON',
    '-DMSDFGEN_USE_VCPKG=OFF',
    '-DMSDFGEN_USE_OPENMP=OFF',
    '-DMSDFGEN_USE_SKIA=OFF',
    '-DMSDFGEN_INSTALL=OFF',
  ])
  await run('cmake', ['--build', buildDirectory, '--config', 'Release', '--target', 'msdfgen'])
  if (!(await isPinnedExecutable(resolve(buildDirectory, 'msdfgen')))) {
    throw new Error(`built msdfgen oracle did not identify itself as version ${version}`)
  }
  await rename(stagingDirectory, cacheDirectory)
} finally {
  await rm(stagingDirectory, { recursive: true, force: true })
}
process.stdout.write(`${executable}\n`)

async function isPinnedExecutable(path) {
  try {
    return (await capture(path, ['-version'])).startsWith(expectedVersionPrefix)
  } catch {
    return false
  }
}

async function capture(command, arguments_) {
  return new Promise((resolveOutput, reject) => {
    const child = spawn(command, arguments_, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk) => (stderr += chunk.toString()))
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolveOutput(stdout)
      else reject(new Error(`${command} exited with ${String(code)}: ${stderr}`))
    })
  })
}

async function run(command, arguments_) {
  await new Promise((resolveRun, reject) => {
    const child = spawn(command, arguments_, { stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolveRun()
      else reject(new Error(`${command} exited with ${String(code)}`))
    })
  })
}
