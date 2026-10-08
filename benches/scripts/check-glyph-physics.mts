/* @workflow {
  "name": "benchmark:physics-check",
  "summary": "Verify live glyph physics against an existing Portless HTTPS demo and capture a screenshot.",
  "requirements": "Running benchmark dev server via Portless and GPU-enabled Chromium. Pass its HTTPS URL and an optional screenshot path.",
  "writes": "Optional screenshot at the supplied path."
} */
import assert from 'node:assert/strict';
import { launchProjectChromium } from './support/project-chromium.mts';

const [base, screenshot] = process.argv.slice(2).filter((argument) => argument !== '--');
assert(base !== undefined, 'Pass the running Portless HTTPS URL');
const url = new URL('/presentation', base);
assert.equal(url.protocol, 'https:');
url.search = 'mode=benchmark&technique=slug&backend=webgpu&delivery=baked&dpr=1&font=inter&workload=glyph-physics';
const browser = await launchProjectChromium({
  headless: true,
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const viewport = document.querySelector<HTMLElement>('[data-testid="comparison-live-viewport"]');
    return Number(viewport?.dataset.physicsBodies) > 0 && Number(viewport?.dataset.physicsSteps) > 0;
  });
  const state = await page.locator('[data-testid="comparison-live-viewport"]').evaluate((element) => ({
    bodies: Number((element as HTMLElement).dataset.physicsBodies),
    steps: Number((element as HTMLElement).dataset.physicsSteps),
  }));
  await page.waitForFunction((previous) => {
    const viewport = document.querySelector<HTMLElement>('[data-testid="comparison-live-viewport"]');
    return Number(viewport?.dataset.physicsSteps) > previous + 120;
  }, state.steps);
  assert.deepEqual(errors, [], 'The live physics demo must run without browser errors');
  if (screenshot !== undefined) await page.screenshot({ path: screenshot });
  console.log('glyph-physics-ready', JSON.stringify(state));
  console.log(url.href);
} finally {
  await browser.close();
}
