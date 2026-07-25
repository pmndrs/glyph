import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

declare global {
  interface Window {
    referenceReady: Promise<void>
  }
}

const root = fileURLToPath(new URL('..', import.meta.url))
const outputDirectory = fileURLToPath(new URL('../fixtures/visual/inter-regular/', import.meta.url))
const imagePath = `${outputDirectory}/browser-html.png`
const manifestPath = `${outputDirectory}/browser-html.json`
const vite = fileURLToPath(new URL('../node_modules/.bin/vite', import.meta.url))
const server = spawn(vite, ['--host', '127.0.0.1', '--port', '5173', '--strictPort'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
})

let serverOutput = ''
const ready = new Promise<void>((resolve, reject) => {
  server.once('error', reject)
  server.once('exit', (code) => reject(new Error(`Vite exited before readiness (${String(code)})`)))
  for (const stream of [server.stdout, server.stderr]) {
    stream.on('data', (chunk: Buffer) => {
      serverOutput += chunk.toString()
      if (serverOutput.includes('Local:')) resolve()
    })
  }
})

await ready
await mkdir(outputDirectory, { recursive: true })
const browser = await chromium.launch({ headless: true })
const errors: string[] = []

try {
  const page = await browser.newPage({
    viewport: { width: 1024, height: 512 },
    deviceScaleFactor: 1,
  })
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('http://127.0.0.1:5173/reference.html', { waitUntil: 'networkidle' })
  await page.evaluate(() => window.referenceReady)
  const family = await page
    .locator('#reference')
    .evaluate((element) => getComputedStyle(element).fontFamily)
  if (!family.startsWith('"Fixture Inter"')) {
    throw new Error(`fixture font was not selected: ${family}`)
  }
  await page.locator('#reference').screenshot({ path: imagePath, animations: 'disabled' })
  if (errors.length > 0) throw new Error(`Browser reference errors: ${errors.join(' | ')}`)

  const bytes = await readFile(imagePath)
  const metadata = {
    schemaVersion: 0,
    id: 'inter-regular-browser-html-v0',
    sourceFontSha256: '40d692fce188e4471e2b3cba937be967878f631ad3ebbbdcd587687c7ebe0c82',
    image: {
      file: 'browser-html.png',
      bytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      width: 1024,
      height: 512,
      deviceScaleFactor: 1,
    },
    browser: {
      engine: 'chromium',
      version: browser.version(),
      playwright: '1.61.1',
      headless: true,
    },
    document: {
      language: 'en',
      direction: 'ltr',
      color: '#f5f5f5',
      background: '#0a0a0a',
      fontFamily: 'Fixture Inter',
      fontSize: 32,
      lineHeight: 1.3,
      constraintWidth: 720,
      text: 'office AVATAR café — ffi, kerning, marks, and wrapping.',
    },
  }
  await writeFile(manifestPath, `${JSON.stringify(metadata, undefined, 2)}\n`)
} finally {
  await browser.close()
  server.kill('SIGTERM')
}
