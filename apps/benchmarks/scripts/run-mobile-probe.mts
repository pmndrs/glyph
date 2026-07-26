import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { chromium, type Page } from 'playwright'

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
const browser = await chromium.launch({
  headless: false,
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'],
})
const errors: string[] = []
let step = 'launch'

try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${step}: ${message.text()}`)
  })
  page.on('pageerror', (error) => errors.push(`${step}: ${error.message}`))

  step = 'scene navigation'
  await page.goto(
    `http://127.0.0.1:${mobilePort}/?mode=benchmark&technique=bitmap&backend=webgpu&workload=benchmark-ipsum`,
    { waitUntil: 'domcontentloaded' },
  )
  await page.locator('[data-testid="scene"]:visible').waitFor()
  await assertResponsiveSurface(page, '390 px scene')
  const captureWindow = page.getByRole('button', { name: 'Capture window', exact: true })
  await captureWindow.waitFor()
  await captureWindow.click()
  await page.getByText('Captured the current rolling window', { exact: false }).waitFor()
  const liveCanvasCount = await page.locator('[data-testid="bitmap-live-viewport"] canvas').count()
  if (liveCanvasCount !== 1) {
    throw new Error(
      `Mobile live surface mounted ${String(liveCanvasCount)} canvases instead of one`,
    )
  }
  await page.screenshot({ path: '/tmp/pmndrs-text-benchmarks-mobile-scene.png' })
  step = 'controls navigation'
  await page.getByRole('button', { name: 'controls', exact: true }).click()
  await page.locator('[data-testid="controls"]:visible').waitFor()
  await assertResponsiveSurface(page, '390 px controls')
  await page.screenshot({ path: '/tmp/pmndrs-text-benchmarks-mobile-controls.png' })
  step = 'report navigation'
  await page.getByRole('button', { name: 'report', exact: true }).click()
  await page.locator('[data-testid="report"]:visible').waitFor()
  await page.getByText('Consumer cost snapshot', { exact: true }).waitFor()
  await assertResponsiveSurface(page, '390 px report')
  await page.screenshot({ path: '/tmp/pmndrs-text-benchmarks-mobile-report.png' })
  step = 'export navigation'
  await page.getByRole('button', { name: 'export', exact: true }).click()
  await page.locator('[data-testid="export-panel"]:visible').waitFor()
  await page.getByText('"kind": "live-benchmark"', { exact: false }).waitFor()
  await assertResponsiveSurface(page, '390 px export')
  await page.screenshot({ path: '/tmp/pmndrs-text-benchmarks-mobile.png' })

  step = 'tablet flow'
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.getByRole('button', { name: 'scene', exact: true }).click()
  await page.locator('[data-testid="scene"]:visible').waitFor()
  await assertResponsiveSurface(page, '1024 px scene')
  if (!(await page.getByRole('button', { name: 'controls', exact: true }).isVisible())) {
    throw new Error('1024 px flow hid the mobile navigation before the desktop layout fits')
  }

  step = 'desktop flow'
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.locator('[data-testid="scene"]:visible').waitFor()
  await assertResponsiveSurface(page, '1280 px scene')
  if (await page.getByRole('button', { name: 'controls', exact: true }).isVisible()) {
    throw new Error('1280 px flow retained mobile navigation in the desktop layout')
  }

  if (errors.length > 0) throw new Error(`Mobile browser errors: ${errors.join(' | ')}`)
  console.log('mobile-ready', JSON.stringify({ width: 390, height: 844, view: 'export' }))
} finally {
  await browser.close()
  server.kill('SIGTERM')
}

async function assertResponsiveSurface(page: Page, label: string): Promise<void> {
  const result = await page.evaluate(() => {
    const visibleButtons = [...document.querySelectorAll<HTMLButtonElement>('button')].filter(
      (button) => {
        const bounds = button.getBoundingClientRect()
        return bounds.width > 0 && bounds.height > 0
      },
    )
    return {
      viewportWidth: globalThis.innerWidth,
      contentWidth: document.documentElement.scrollWidth,
      buttons: visibleButtons.map((button) => {
        const visibleLabels = [...button.querySelectorAll<HTMLElement>('span')].filter((span) => {
          const bounds = span.getBoundingClientRect()
          return span.textContent?.trim() !== '' && bounds.width > 0 && bounds.height > 0
        })
        const labelElements = visibleLabels.length > 0 ? visibleLabels : [button]
        return {
          label: button.getAttribute('aria-label') ?? button.textContent?.trim() ?? '',
          fontSize: Math.max(
            ...labelElements.map((labelElement) =>
              Number.parseFloat(getComputedStyle(labelElement).fontSize),
            ),
          ),
          height: button.getBoundingClientRect().height,
          clipped:
            button.scrollWidth > button.clientWidth + 1 ||
            button.scrollHeight > button.clientHeight + 1,
        }
      }),
    }
  })
  if (result.contentWidth > result.viewportWidth) {
    throw new Error(
      `${label} overflows horizontally: ${String(result.contentWidth)} > ${String(result.viewportWidth)}`,
    )
  }
  const oversized = result.buttons.filter((button) => button.fontSize > 13)
  if (oversized.length > 0) {
    throw new Error(
      `${label} has oversized control labels: ${oversized.map((button) => button.label).join(', ')}`,
    )
  }
  const clipped = result.buttons.filter((button) => button.clipped)
  if (clipped.length > 0) {
    throw new Error(
      `${label} clips control labels: ${clipped.map((button) => button.label).join(', ')}`,
    )
  }
  const undersized = result.buttons.filter((button) => button.height < 28)
  if (undersized.length > 0) {
    throw new Error(
      `${label} has crowded controls below 28 px: ${undersized.map((button) => button.label).join(', ')}`,
    )
  }
}
