import { fileURLToPath } from 'node:url';
import type { Browser, Page } from 'playwright';
import { createServer } from 'vite';

import { launchProjectChromium } from './support/project-chromium.mts';

const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root);
const server = await createServer({
  root,
  server: {
    host: '127.0.0.1',
    port: 0,
  },
});
await server.listen();
const address = server.httpServer?.address();
if (address === null || address === undefined || typeof address === 'string') {
  await server.close();
  throw new Error('Vite did not publish a local TCP address');
}
const mobilePort = address.port;
const errors: string[] = [];
let step = 'launch';
let browser: Browser | undefined;

try {
  browser = await launchProjectChromium({
    headless: false,
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'],
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${step}: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`${step}: ${error.message}`));

  step = 'scene navigation';
  await page.goto(
    `http://127.0.0.1:${mobilePort}/?mode=benchmark&technique=bitmap&backend=webgpu&workload=benchmark-ipsum`,
    { waitUntil: 'domcontentloaded' },
  );
  await page.locator('[data-testid="scene"]:visible').waitFor();
  await assertResponsiveSurface(page, '390 px scene');
  const captureWindow = page.getByRole('button', { name: 'Capture report', exact: true });
  await captureWindow.waitFor();
  await captureWindow.click();
  await page.waitForURL((url) => url.searchParams.get('view') === 'report');
  await page.getByRole('button', { name: 'Return to live benchmark', exact: true }).click();
  await page.waitForURL((url) => url.searchParams.has('view') === false);
  const liveCanvasCount = await page.locator('canvas[aria-label^="Live bitmap benchmark"]:visible').count();
  if (liveCanvasCount !== 1) {
    throw new Error(`Mobile live surface mounted ${String(liveCanvasCount)} canvases instead of one`);
  }
  await page.screenshot({ path: '/tmp/pmndrs-text-benchmarks-mobile-scene.png' });
  step = 'phone technique switcher';
  const phoneTechniqueSwitcher = page.locator('[data-testid="technique-switcher"]:visible');
  await phoneTechniqueSwitcher.waitFor();
  await phoneTechniqueSwitcher.getByRole('button', { name: 'MSDF', exact: true }).click();
  await page.locator('[data-testid="mtsdf-live-viewport"]:visible').waitFor();
  await assertResponsiveSurface(page, '390 px MSDF scene');
  step = 'phone workload menu';
  await page.getByRole('button', { name: 'Open workload menu', exact: true }).click();
  await page.locator('button:visible').filter({ hasText: 'Advanced shaping' }).first().waitFor();
  await assertResponsiveSurface(page, '390 px workload menu');
  await page.getByRole('button', { name: 'Close workload menu', exact: true }).first().click();
  step = 'controls navigation';
  await page.getByRole('button', { name: /^controls$/i }).click();
  await page.locator('[data-testid="controls"]:visible').waitFor();
  await page.locator('[data-testid="scene"]:visible').waitFor();
  const controlsHeight = await page
    .locator('[data-testid="controls"]:visible')
    .evaluate((controls) => controls.parentElement?.getBoundingClientRect().height);
  if (controlsHeight === undefined || controlsHeight > 844 - 126 + 1) {
    throw new Error(`Phone controls panel exceeds its navigation-safe viewport: ${String(controlsHeight)}`);
  }
  await assertResponsiveSurface(page, '390 px controls');
  await page.screenshot({ path: '/tmp/pmndrs-text-benchmarks-mobile-controls.png' });
  await page.getByRole('button', { name: 'Close controls', exact: true }).last().click();
  await page.screenshot({ path: '/tmp/pmndrs-text-benchmarks-mobile.png' });

  step = 'tablet flow';
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.locator('[data-testid="scene"]:visible').waitFor();
  await assertResponsiveSurface(page, '1024 px scene');
  await page.getByRole('button', { name: 'Open render controls', exact: true }).click();
  await page.locator('[data-testid="controls"]:visible').waitFor();
  await page.locator('[data-testid="scene"]:visible').waitFor();
  const tabletControlsHeight = await page
    .locator('[data-testid="controls"]:visible')
    .evaluate((controls) => controls.parentElement?.getBoundingClientRect().height);
  if (tabletControlsHeight === undefined || tabletControlsHeight > 768 * 0.62) {
    throw new Error(`Tablet controls panel is not capped near 60vh: ${String(tabletControlsHeight)}`);
  }
  await page.getByRole('button', { name: 'Close controls', exact: true }).last().click();

  step = 'desktop flow';
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator('[data-testid="scene"]:visible').waitFor();
  await assertResponsiveSurface(page, '1280 px scene');
  if (await page.getByRole('button', { name: 'Open render controls', exact: true }).isVisible()) {
    throw new Error('1280 px flow retained compact controls in the desktop layout');
  }
  await page.getByRole('button', { name: 'Open workload menu', exact: true }).click();
  await page.getByRole('button', { name: /^Benchmark ipsum/ }).waitFor();
  await page.getByRole('button', { name: 'Close workload menu', exact: true }).click();

  if (errors.length > 0) throw new Error(`Mobile browser errors: ${errors.join(' | ')}`);
  console.log('mobile-ready', JSON.stringify({ width: 390, height: 844, view: 'scene' }));
} finally {
  await browser?.close();
  await server.close();
}

async function assertResponsiveSurface(page: Page, label: string): Promise<void> {
  const result = await page.evaluate(() => {
    const visibleButtons = [...document.querySelectorAll<HTMLButtonElement>('button')].filter((button) => {
      const bounds = button.getBoundingClientRect();
      return bounds.width > 0 && bounds.height > 0;
    });
    return {
      viewportWidth: globalThis.innerWidth,
      contentWidth: document.documentElement.scrollWidth,
      buttons: visibleButtons.map((button) => {
        const visibleLabels = [...button.querySelectorAll<HTMLElement>('span')].filter((span) => {
          const bounds = span.getBoundingClientRect();
          return span.textContent?.trim() !== '' && bounds.width > 0 && bounds.height > 0;
        });
        const labelElements = visibleLabels.length > 0 ? visibleLabels : [button];
        return {
          label: button.getAttribute('aria-label') ?? button.textContent?.trim() ?? '',
          iconOnly: (button.textContent?.trim().length ?? 0) <= 1,
          fontSize: Math.max(
            ...labelElements.map((labelElement) => Number.parseFloat(getComputedStyle(labelElement).fontSize)),
          ),
          height: button.getBoundingClientRect().height,
          clientSize: [button.clientWidth, button.clientHeight],
          scrollSize: [button.scrollWidth, button.scrollHeight],
          clipped: button.scrollWidth > button.clientWidth + 1 || button.scrollHeight > button.clientHeight + 1,
        };
      }),
    };
  });
  if (result.contentWidth > result.viewportWidth) {
    throw new Error(
      `${label} overflows horizontally: ${String(result.contentWidth)} > ${String(result.viewportWidth)}`,
    );
  }
  const oversized = result.buttons.filter((button) => !button.iconOnly && button.fontSize > 13);
  if (oversized.length > 0) {
    throw new Error(`${label} has oversized control labels: ${oversized.map((button) => button.label).join(', ')}`);
  }
  const clipped = result.buttons.filter((button) => button.clipped);
  if (clipped.length > 0) {
    throw new Error(`${label} clips control labels: ${JSON.stringify(clipped)}`);
  }
  const undersized = result.buttons.filter((button) => button.height < 28);
  if (undersized.length > 0) {
    throw new Error(
      `${label} has crowded controls below 28 px: ${undersized.map((button) => button.label).join(', ')}`,
    );
  }
}
