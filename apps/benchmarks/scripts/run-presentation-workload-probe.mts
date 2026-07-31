import { fileURLToPath } from 'node:url';
import type { Browser, Page } from 'playwright';
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

const workloads = [
  { id: 'text-ladder', label: 'Text ladder', fontSize: 24, layoutWidthRatio: 0.82, amount: 50, camera: 'orthographic' },
  {
    id: 'zoom-text',
    label: 'Zoom text',
    fontSize: 8 * (96 / 72),
    layoutWidthRatio: 0.82,
    amount: 50,
    camera: 'orthographic',
  },
  { id: 'icon-grid', label: 'Icon grid', fontSize: 64, layoutWidthRatio: 0.82, amount: 50, camera: 'orthographic' },
  {
    id: 'off-axis-3d',
    label: 'Off-axis / 3D',
    fontSize: 96,
    layoutWidthRatio: 1.2,
    amount: 100,
    camera: 'perspective',
  },
  {
    id: 'dynamic-layout',
    label: 'Dynamic layout',
    fontSize: 32,
    layoutWidthRatio: 0.82,
    amount: 50,
    camera: 'orthographic',
  },
  {
    id: 'paragraph-stress',
    label: 'Paragraph stress',
    fontSize: 24,
    layoutWidthRatio: 0.82,
    amount: 100,
    camera: 'orthographic',
  },
  {
    id: 'paint-effects',
    label: 'Paint & effects',
    fontSize: 52,
    layoutWidthRatio: 0.82,
    amount: 50,
    camera: 'orthographic',
  },
] as const;

const consoleProblems: string[] = [];
let browser: Browser | undefined;
try {
  browser = await launchProjectChromium({
    headless: false,
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'],
  });
  const page = await browser.newPage({ viewport: { width: 1_280, height: 720 } });
  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') {
      consoleProblems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => consoleProblems.push(`pageerror: ${error.message}`));
  await page.goto(
    `http://127.0.0.1:${String(address.port)}/presentation?mode=benchmark&technique=mtsdf&backend=webgpu&delivery=baked&dpr=1&font=inter&workload=text-ladder`,
    { waitUntil: 'domcontentloaded' },
  );
  const workloadControl = page.getByLabel('Live workload', { exact: true });
  await workloadControl.waitFor();
  await page.waitForFunction(() => document.querySelector('canvas[data-configured-renderer-active="true"]') !== null);
  await page.evaluate(() => {
    const scope = globalThis as typeof globalThis & { presentationProbeCanvas: Element | undefined };
    scope.presentationProbeCanvas =
      document.querySelector('canvas[data-configured-renderer-active="true"]') ?? undefined;
  });

  for (const workload of workloads) {
    await workloadControl.click();
    await page.getByRole('option', { name: workload.label, exact: true }).click();
    await page.waitForFunction(
      ({ expected }) => {
        const viewport = document.querySelector<HTMLElement>('[data-testid="comparison-live-viewport"]');
        if (viewport === null) return false;
        const close = (attribute: string, value: number): boolean =>
          Math.abs(Number(viewport.getAttribute(attribute)) - value) < 0.000_001;
        const zoomReady = expected.id !== 'zoom-text' || Number(viewport.dataset.zoomScale) >= 3;
        const animatedParagraph = expected.id === 'paragraph-stress';
        return (
          viewport.dataset.workload === expected.id &&
          viewport.dataset.presentationPending === 'false' &&
          viewport.dataset.cameraKind === expected.camera &&
          viewport.dataset.canvasGrid === 'true' &&
          viewport.dataset.animationEnabled === 'true' &&
          close('data-animation-speed', 50) &&
          (animatedParagraph || close('data-applied-font-size', expected.fontSize)) &&
          (animatedParagraph || close('data-layout-width-ratio', expected.layoutWidthRatio)) &&
          close('data-applied-workload-amount', expected.amount) &&
          Number(viewport.dataset.glyphCount) > 0 &&
          Number(viewport.dataset.drawCount) > 0 &&
          Number(viewport.dataset.framesPerSecond) > 0 &&
          zoomReady
        );
      },
      { expected: workload },
    );
    const retainedCanvas = await page.evaluate(() => {
      const scope = globalThis as typeof globalThis & { presentationProbeCanvas: Element | undefined };
      return scope.presentationProbeCanvas === document.querySelector('canvas[data-configured-renderer-active="true"]');
    });
    if (!retainedCanvas) throw new Error(`${workload.id} replaced the persistent renderer canvas`);
    const screenshot = await page.screenshot();
    const visibleInkPixels = await visiblePresentationInkPixels(page, screenshot.toString('base64'));
    if (visibleInkPixels < 300) {
      await page.screenshot({ path: `/tmp/pmndrs-text-presentation-${workload.id}-blank.png` });
      throw new Error(`${workload.id} rendered only ${String(visibleInkPixels)} visible foreground pixels`);
    }
    if (Number(await page.locator('html').getAttribute('data-active-configured-renderers')) !== 1) {
      throw new Error(`${workload.id} did not retain exactly one configured renderer`);
    }
    console.log('presentation-workload-visible', workload.id, visibleInkPixels);
  }
  if (consoleProblems.length > 0) {
    throw new Error(`Presentation emitted browser warnings or errors: ${consoleProblems.join(' | ')}`);
  }
  console.log('presentation-workloads-ready', JSON.stringify({ workloads: workloads.length, rendererCount: 1 }));
} finally {
  await browser?.close();
  await server.close();
}

async function visiblePresentationInkPixels(page: Page, screenshotBase64: string): Promise<number> {
  return page.evaluate(async (encoded) => {
    const image = new Image();
    image.src = `data:image/png;base64,${encoded}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('Presentation screenshot did not expose a 2D pixel context');
    context.drawImage(image, 0, 0);
    const crop = context.getImageData(112, 88, 680, 540).data;
    let visibleInkPixels = 0;
    for (let offset = 0; offset < crop.length; offset += 4) {
      if (Math.max(crop[offset] ?? 0, crop[offset + 1] ?? 0, crop[offset + 2] ?? 0) >= 110) {
        visibleInkPixels += 1;
      }
    }
    return visibleInkPixels;
  }, screenshotBase64);
}
