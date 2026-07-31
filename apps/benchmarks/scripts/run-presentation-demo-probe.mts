import { fileURLToPath } from 'node:url';
import type { Browser } from 'playwright';
import { createServer } from 'vite';

import { launchProjectChromium } from './support/project-chromium.mts';

const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root);
const server = await createServer({ root, server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const address = server.httpServer?.address();
if (address === null || address === undefined || typeof address === 'string') {
  await server.close();
  throw new Error('Vite did not publish a local TCP address');
}

const consoleProblems: string[] = [];
let browser: Browser | undefined;
try {
  browser = await launchProjectChromium({
    headless: false,
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'],
  });
  const page = await browser.newPage({ viewport: { width: 1_280, height: 720 } });
  page.on('console', async (message) => {
    if (message.type() === 'warning' || message.type() === 'error') {
      const context = await page
        .evaluate(() => ({
          elapsedMs: Math.round(performance.now()),
          workload: new URLSearchParams(location.search).get('workload'),
        }))
        .catch(() => ({ elapsedMs: -1, workload: 'unavailable' }));
      consoleProblems.push(
        `${message.type()}: ${message.text()} [workload=${String(context.workload)} elapsed=${String(context.elapsedMs)}ms]`,
      );
    }
  });
  page.on('pageerror', (error) => consoleProblems.push(`pageerror: ${error.message}`));
  await page.goto(
    `http://127.0.0.1:${String(address.port)}/presentation?mode=benchmark&technique=mtsdf&backend=webgpu&delivery=baked&dpr=1&font=inter&workload=off-axis-3d`,
    { waitUntil: 'domcontentloaded' },
  );

  const initialViewport = page.locator(
    '[data-testid="comparison-live-viewport"][data-workload="off-axis-3d"][data-presentation-pending="false"]',
  );
  await initialViewport.waitFor();
  await page.waitForFunction(() => document.querySelector('canvas[data-configured-renderer-active="true"]') !== null);
  await page.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      presentationDemoCanvas: Element | null;
      presentationDemoErrors: string[];
    };
    scope.presentationDemoCanvas = document.querySelector('canvas[data-configured-renderer-active="true"]');
    scope.presentationDemoErrors = [];
    const collectErrors = (): void => {
      for (const element of document.querySelectorAll<HTMLElement>('[data-testid$="-live-error"]')) {
        const message = element.textContent?.trim();
        if (message !== undefined && message !== '' && !scope.presentationDemoErrors.includes(message)) {
          scope.presentationDemoErrors.push(message);
        }
      }
    };
    new MutationObserver(collectErrors).observe(document.body, { childList: true, subtree: true });
  });

  const animationTrigger = page.getByRole('button', { name: 'Animation: ON' });
  await animationTrigger.click();
  const animationSwitch = page.getByRole('switch', { name: 'Animate' });
  await animationSwitch.focus();
  if (!(await animationSwitch.isChecked())) throw new Error('Off-axis animation did not start enabled');
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelector('[data-presentation-playing="true"]') !== null);
  if (!(await animationSwitch.isChecked()))
    throw new Error('Presentation Space shortcut toggled the focused Animate control');

  await page.waitForFunction(() => {
    const viewport = document.querySelector<HTMLElement>(
      '[data-testid="comparison-live-viewport"][data-workload="icon-grid"]',
    );
    if (viewport?.dataset.presentationPending !== 'false') return false;
    const close = (attribute: string, value: number): boolean =>
      Math.abs(Number(viewport.getAttribute(attribute)) - value) < 0.000_001;
    return (
      viewport.dataset.cameraKind === 'orthographic' &&
      viewport.dataset.canvasGrid === 'true' &&
      viewport.dataset.animationEnabled === 'true' &&
      close('data-applied-font-size', 64) &&
      close('data-layout-width-ratio', 0.82) &&
      close('data-applied-workload-amount', 50) &&
      close('data-animation-speed', 50) &&
      Number(viewport.dataset.glyphCount) > 0 &&
      Number(viewport.dataset.drawCount) > 0 &&
      Number(viewport.dataset.framesPerSecond) > 0
    );
  });

  const retainedCanvas = await page.evaluate(() => {
    const scope = globalThis as typeof globalThis & { presentationDemoCanvas: Element | null };
    return scope.presentationDemoCanvas === document.querySelector('canvas[data-configured-renderer-active="true"]');
  });
  if (!retainedCanvas) throw new Error('Timed demo replaced the persistent renderer canvas');
  if (Number(await page.locator('html').getAttribute('data-active-configured-renderers')) !== 1) {
    throw new Error('Timed demo did not retain exactly one configured renderer');
  }
  await page.waitForFunction(() => {
    const viewport = document.querySelector<HTMLElement>(
      '[data-testid="comparison-live-viewport"][data-workload="icon-grid"]',
    );
    return Number(viewport?.dataset.framesPerSecond) >= 55;
  });
  const iconGridFps = Number(
    await page
      .locator('[data-testid="comparison-live-viewport"][data-workload="icon-grid"]')
      .getAttribute('data-frames-per-second'),
  );

  const observedWorkloads = ['off-axis-3d', 'icon-grid'];
  const waitForWorkload = async (workload: string): Promise<void> => {
    await page.waitForFunction(
      (expected) => new URLSearchParams(location.search).get('workload') === expected,
      workload,
    );
    observedWorkloads.push(workload);
  };
  await waitForWorkload('paint-effects');
  await waitForWorkload('advanced-shaping');
  for (const caseId of ['cjk-line-breaks', 'mixed-bidi', 'arabic-joining', 'indic-reordering', 'latin-features']) {
    await page.waitForFunction(
      (expected) =>
        document.querySelector('[data-testid="benchmark-surface"]')?.getAttribute('data-advanced-case') === expected,
      caseId,
    );
  }
  await waitForWorkload('zoom-text');
  await page.waitForFunction(() => {
    const viewport = document.querySelector<HTMLElement>(
      '[data-testid="comparison-live-viewport"][data-workload="zoom-text"]',
    );
    return (
      Number(viewport?.dataset.zoomPhraseRevision) >= 2 &&
      Number(viewport?.dataset.glyphCount) > 0 &&
      Number(viewport?.dataset.drawCount) > 0
    );
  });
  await waitForWorkload('text-ladder');
  await waitForWorkload('icon-grid');
  await page.waitForFunction(() => {
    const viewport = document.querySelector<HTMLElement>(
      '[data-testid="comparison-live-viewport"][data-workload="icon-grid"]',
    );
    const scrollX = Number(viewport?.dataset.iconScrollX);
    const maximumScrollX = Number(viewport?.dataset.iconMaximumScrollX);
    return maximumScrollX > 0 && scrollX / maximumScrollX > 0.5;
  });
  const alternateScrollX = Number(
    await page
      .locator('[data-testid="comparison-live-viewport"][data-workload="icon-grid"]')
      .getAttribute('data-icon-scroll-x'),
  );
  await page.waitForFunction((previousScrollX) => {
    const viewport = document.querySelector<HTMLElement>(
      '[data-testid="comparison-live-viewport"][data-workload="icon-grid"]',
    );
    return Number(viewport?.dataset.iconScrollX) < previousScrollX - 5;
  }, alternateScrollX);
  await waitForWorkload('dynamic-layout');
  await waitForWorkload('paragraph-stress');
  await waitForWorkload('off-axis-3d');
  await page.waitForFunction(() => document.querySelector('[data-presentation-playing="false"]') !== null);

  const finalCanvasRetained = await page.evaluate(() => {
    const scope = globalThis as typeof globalThis & { presentationDemoCanvas: Element | null };
    return scope.presentationDemoCanvas === document.querySelector('canvas[data-configured-renderer-active="true"]');
  });
  if (!finalCanvasRetained) throw new Error('Timed demo replaced the persistent renderer canvas before its outro');
  if (new URLSearchParams(new URL(page.url()).search).get('workload') !== 'off-axis-3d') {
    throw new Error('Timed demo did not finish on Off-axis / 3D');
  }

  const workloadControl = page.getByLabel('Live workload', { exact: true });
  await workloadControl.focus();
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelector('[data-presentation-playing="true"]') !== null);
  await page.keyboard.press('Space');
  await page.waitForFunction(() => document.querySelector('[data-presentation-playing="false"]') !== null);
  if ((await workloadControl.getAttribute('aria-expanded')) === 'true') {
    throw new Error('Presentation Space shortcut opened the focused workload control');
  }
  const renderedErrors = await page.evaluate(() => {
    const scope = globalThis as typeof globalThis & { presentationDemoErrors?: string[] };
    return scope.presentationDemoErrors ?? [];
  });
  if (renderedErrors.length > 0) {
    throw new Error(`Presentation demo rendered workload errors: ${renderedErrors.join(' | ')}`);
  }
  if (consoleProblems.length > 0) {
    throw new Error(`Presentation demo emitted browser warnings or errors: ${consoleProblems.join(' | ')}`);
  }
  console.log(
    'presentation-demo-ready',
    JSON.stringify({
      focusedControlCaptured: true,
      iconGridDefaults: true,
      iconGridFps,
      observedWorkloads,
      rendererCount: 1,
      returnedToOffAxis: true,
      secondIconRun: 'alternate-reverse',
    }),
  );
} finally {
  await browser?.close();
  await server.close();
}
