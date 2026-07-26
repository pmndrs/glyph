import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = fileURLToPath(new URL('..', import.meta.url))
const vite = fileURLToPath(new URL('../node_modules/.bin/vite', import.meta.url))
const mobilePort = 5174
const server = spawn(vite, ['--host', '127.0.0.1', '--port', String(mobilePort), '--strictPort'], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
})

let serverOutput = ''
const ready = new Promise<void>((resolve, reject) => {
  server.once('error', reject)
  server.once('exit', (code) => reject(new Error(`Vite exited before readiness (${String(code)})`)))
  for (const stream of [server.stdout, server.stderr]) {
    stream.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      serverOutput += text
      if (serverOutput.includes('Local:')) resolve()
    })
  }
})

await ready
const browser = await chromium.launch({ headless: true })
const errors: string[] = []

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))

  await page.goto(`http://127.0.0.1:${mobilePort}/`, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-testid="scene"]:visible').waitFor()
  await page.screenshot({ path: '/tmp/pmndrs-text-benchmarks-mobile-scene.png', fullPage: true })
  await page.getByRole('button', { name: 'controls', exact: true }).click()
  await page.locator('[data-testid="controls"]:visible').waitFor()
  await page.screenshot({ path: '/tmp/pmndrs-text-benchmarks-mobile-controls.png', fullPage: true })
  await page.getByRole('button', { name: 'report', exact: true }).click()
  await page.locator('[data-testid="report"]:visible').waitFor()
  await page.screenshot({ path: '/tmp/pmndrs-text-benchmarks-mobile-report.png', fullPage: true })
  await page.getByRole('button', { name: 'export', exact: true }).click()
  await page.locator('[data-testid="export-panel"]:visible').waitFor()
  await page.screenshot({ path: '/tmp/pmndrs-text-benchmarks-mobile.png', fullPage: true })

  if (errors.length > 0) throw new Error(`Mobile browser errors: ${errors.join(' | ')}`)
  console.log('mobile-ready', JSON.stringify({ width: 390, height: 844, view: 'export' }))
} finally {
  await browser.close()
  server.kill('SIGTERM')
}
