import { execFile as execFileCallback } from 'node:child_process'
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { chromium } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'

interface PackedResult {
  readonly hash?: string
  readonly bytes?: number
  readonly error?: string
}

const execFile = promisify(execFileCallback)
const appDirectory = fileURLToPath(new URL('..', import.meta.url))
const workspaceDirectory = fileURLToPath(new URL('../../..', import.meta.url))
const cacheDirectory = join(appDirectory, '.cache')
await mkdir(cacheDirectory, { recursive: true })
const consumerDirectory = await mkdtemp(join(cacheDirectory, 'packed-consumer-'))
const archiveDirectory = join(consumerDirectory, 'archives')
const modulesDirectory = join(consumerDirectory, 'node_modules', '@pmndrs')
await Promise.all([
  mkdir(archiveDirectory, { recursive: true }),
  mkdir(modulesDirectory, { recursive: true }),
])

let server: ViteDevServer | undefined
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
try {
  await Promise.all([
    packAndExtract('packages/font-baker', 'pmndrs-text-font-baker-0.0.0.tgz', 'text-font-baker'),
    packAndExtract('packages/text', 'pmndrs-text-0.0.0.tgz', 'text'),
    copyFile(
      join(appDirectory, 'fixtures/fonts/inter-v4.1/Inter-Regular.ttf'),
      join(consumerDirectory, 'Inter-Regular.ttf'),
    ),
  ])
  await Promise.all([
    writeFile(
      join(consumerDirectory, 'index.html'),
      '<!doctype html><script type="module" src="/entry.js"></script>\n',
    ),
    writeFile(
      join(consumerDirectory, 'entry.js'),
      `import { bakeFontInWorker } from '@pmndrs/text/runtime-bake'
try {
  const source = new Uint8Array(await (await fetch('/Inter-Regular.ttf')).arrayBuffer())
  const artifact = await bakeFontInWorker({ source })
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', artifact))]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
  await globalThis.__reportPackedResult({ hash, bytes: artifact.byteLength })
} catch (error) {
  await globalThis.__reportPackedResult({ error: error instanceof Error ? error.stack : String(error) })
}
`,
    ),
  ])

  server = await createServer({
    root: consumerDirectory,
    logLevel: 'silent',
    optimizeDeps: { exclude: ['@pmndrs/text', '@pmndrs/text-font-baker'] },
    server: { host: '127.0.0.1', port: 5183, strictPort: true },
  })
  await server.listen()
  const address = server.httpServer?.address()
  if (address === null || address === undefined || typeof address === 'string') {
    throw new Error('packed-consumer Vite server did not expose a TCP port')
  }

  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const completion = Promise.withResolvers<PackedResult>()
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.exposeFunction('__reportPackedResult', (value: PackedResult) => {
    completion.resolve(value)
  })
  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'domcontentloaded' })
  const result = await completion.promise
  if (result.error !== undefined) throw new Error(result.error)
  if (errors.length > 0) throw new Error(`packed consumer browser errors: ${errors.join(' | ')}`)

  const manifest = JSON.parse(
    await readFile(join(appDirectory, 'fixtures/fonts/inter-v4.1/manifest.json'), 'utf8'),
  )
  const expectedHash = manifest.bake.expectedCore.artifactSha256
  const expectedBytes = manifest.bake.expectedCore.artifactBytes
  if (result.hash !== expectedHash || result.bytes !== expectedBytes) {
    throw new Error(
      `packed module Worker returned ${result.hash}/${result.bytes}; expected ${expectedHash}/${expectedBytes}`,
    )
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
} finally {
  if (browser !== undefined) await browser.close()
  if (server !== undefined) await server.close()
  await rm(consumerDirectory, { recursive: true, force: true })
}

async function packAndExtract(packagePath: string, archiveName: string, installedName: string) {
  const packageDirectory = join(workspaceDirectory, packagePath)
  await execFile('pnpm', ['pack', '--pack-destination', archiveDirectory], {
    cwd: packageDirectory,
    env: { ...process.env, CI: 'true' },
  })
  const installedDirectory = join(modulesDirectory, installedName)
  await mkdir(installedDirectory, { recursive: true })
  await execFile(
    'tar',
    ['-xzf', join(archiveDirectory, archiveName), '--strip-components=1', '-C', installedDirectory],
    { cwd: consumerDirectory },
  )
}
