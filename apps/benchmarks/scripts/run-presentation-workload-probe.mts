import { mkdir } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, Page } from 'playwright';
import { createServer } from 'vite';

import { launchProjectChromium } from './support/project-chromium.mts';

const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root);
const technique = presentationTechnique(process.env.PRESENTATION_TECHNIQUE);
const backend = presentationBackend(process.env.PRESENTATION_BACKEND);
const screenshotDirectory = process.env.PRESENTATION_SCREENSHOT_DIR;
if (screenshotDirectory !== undefined) await mkdir(screenshotDirectory, { recursive: true });
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
  {
    id: 'rich-text',
    label: 'Rich text spans',
    fontSize: 26,
    layoutWidthRatio: 0.82,
    amount: 50,
    camera: 'orthographic',
  },
] as const;

const consoleProblems: string[] = [];
const presentationIntervalMs = 7_000;
const presentationSamplePeriodMs = 300;
let browser: Browser | undefined;
try {
  browser = await launchProjectChromium({
    headless: true,
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
    `http://127.0.0.1:${String(address.port)}/presentation?mode=benchmark&technique=${technique}&backend=${backend}&delivery=baked&dpr=2&font=inter&workload=text-ladder`,
    { waitUntil: 'domcontentloaded' },
  );
  const workloadControl = page.getByLabel('Live workload', { exact: true });
  await workloadControl.waitFor();
  await page.waitForFunction(() => document.querySelector('canvas[data-configured-renderer-active="true"]') !== null);
  await page.waitForFunction((expectedBackend) => {
    const viewport = document.querySelector<HTMLElement>(
      '[data-testid="comparison-live-viewport"][data-workload="text-ladder"]',
    );
    return (
      viewport?.dataset.presentationPending === 'false' &&
      viewport.dataset.backend === expectedBackend &&
      Number(viewport.dataset.glyphCount) > 0 &&
      Number(viewport.dataset.drawCount) > 0 &&
      Number(viewport.dataset.framesPerSecond) > 0
    );
  }, backend);
  await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-configured-renderer-active="true"]');
    const scope = globalThis as typeof globalThis & {
      presentationProbeCanvas: HTMLCanvasElement | undefined;
      presentationProbeCanvasEvidence: CanvasEvidence | undefined;
      presentationProbeCanvasEvents: string[];
      presentationProbeInputEvents: string[];
    };
    scope.presentationProbeCanvas = canvas ?? undefined;
    if (canvas === null) {
      scope.presentationProbeCanvasEvidence = undefined;
    } else {
      const bounds = canvas.getBoundingClientRect();
      scope.presentationProbeCanvasEvidence = {
        backingHeight: canvas.height,
        backingWidth: canvas.width,
        connected: canvas.isConnected,
        cssHeight: bounds.height,
        cssWidth: bounds.width,
      };
    }
    scope.presentationProbeCanvasEvents = [];
    scope.presentationProbeInputEvents = [];
    document.addEventListener(
      'click',
      (event) => {
        const target = event.target instanceof Element ? event.target : undefined;
        scope.presentationProbeInputEvents.push(
          `${performance.now().toFixed(1)}ms click ${target?.getAttribute('aria-label') ?? target?.textContent?.trim().slice(0, 80) ?? 'unknown'}`,
        );
      },
      { capture: true },
    );
    if (canvas !== null) {
      new MutationObserver((records) => {
        for (const record of records) {
          scope.presentationProbeCanvasEvents.push(
            `${performance.now().toFixed(1)}ms attribute ${record.attributeName ?? 'unknown'} ${record.oldValue ?? 'null'} -> ${canvas.getAttribute(record.attributeName ?? '') ?? 'null'}`,
          );
        }
      }).observe(canvas, { attributeFilter: ['height', 'width'], attributeOldValue: true, attributes: true });
      new ResizeObserver(() => {
        const bounds = canvas.getBoundingClientRect();
        scope.presentationProbeCanvasEvents.push(
          `${performance.now().toFixed(1)}ms css ${String(bounds.width)}x${String(bounds.height)}`,
        );
      }).observe(canvas);
      new MutationObserver(() => {
        if (!canvas.isConnected) {
          scope.presentationProbeCanvasEvents.push(`${performance.now().toFixed(1)}ms disconnected`);
        }
      }).observe(document.documentElement, { childList: true, subtree: true });
    }
  });

  for (const workload of workloads) {
    await workloadControl.click();
    await page.getByRole('option', { name: workload.label, exact: true }).click();
    // Sample the batch topology at the settled mount, before the presentation timeline advances. Paragraph stress
    // animates its own size and measure, so a sample taken later in the soak would report a different scene.
    await waitForSettledWorkload(page, workload, backend, false);
    const settled = await readBatching(page);
    console.log(
      'presentation-workload-settled',
      workload.id,
      `draws=${String(settled.drawCount)}`,
      `glyphs=${String(settled.glyphCount)}`,
    );
    await assertPresentationRemainsVisible(page, workload.id, backend);
    await waitForSettledWorkload(page, workload, backend, true);
    const retainedCanvas = await page.evaluate(() => {
      const scope = globalThis as typeof globalThis & { presentationProbeCanvas: Element | undefined };
      return scope.presentationProbeCanvas === document.querySelector('canvas[data-configured-renderer-active="true"]');
    });
    if (!retainedCanvas) throw new Error(`${workload.id} replaced the persistent renderer canvas`);
    if (Number(await page.locator('html').getAttribute('data-active-configured-renderers')) !== 1) {
      throw new Error(`${workload.id} did not retain exactly one configured renderer`);
    }
    if (screenshotDirectory !== undefined) {
      await page.screenshot({
        path: resolvePath(screenshotDirectory, `${backend}-${technique}-${workload.id}.png`),
      });
    }
  }
  if (technique === 'bitmap') {
    const dprMenu = page.getByRole('button', { name: 'Device pixel ratio: 2×', exact: true });
    await dprMenu.click();
    await page
      .getByRole('button', { name: '1×', exact: true })
      .evaluate((element) => (element as HTMLButtonElement).click());
    await page.waitForFunction(() => new URLSearchParams(location.search).get('dpr') === '1');
    await assertCanvasHandoff(page, 'DPR 2→1', backend);
    await page.getByRole('button', { name: 'Device pixel ratio: 1×', exact: true }).click();
    await page
      .getByRole('button', { name: '2×', exact: true })
      .evaluate((element) => (element as HTMLButtonElement).click());
    await page.waitForFunction(() => new URLSearchParams(location.search).get('dpr') === '2');
    await assertCanvasHandoff(page, 'DPR 1→2', backend);

    const mtsdfControl = page.getByRole('button', { name: 'MSDF', exact: true });
    await mtsdfControl.evaluate((element) => (element as HTMLButtonElement).click());
    await page.waitForFunction(() => {
      const viewport = document.querySelector<HTMLElement>('[data-testid="comparison-live-viewport"]');
      return viewport?.dataset.technique === 'mtsdf' && viewport.dataset.presentationPending === 'false';
    });
    await assertCanvasHandoff(page, 'Bitmap→MTSDF', backend);
    await page
      .getByRole('button', { name: 'Bitmap', exact: true })
      .evaluate((element) => (element as HTMLButtonElement).click());
    await page.waitForFunction(() => {
      const viewport = document.querySelector<HTMLElement>('[data-testid="comparison-live-viewport"]');
      return viewport?.dataset.technique === 'bitmap' && viewport.dataset.presentationPending === 'false';
    });
    await assertCanvasHandoff(page, 'MTSDF→Bitmap', backend);
  }
  if (consoleProblems.length > 0) {
    throw new Error(`Presentation emitted browser warnings or errors: ${consoleProblems.join(' | ')}`);
  }
  console.log(
    'presentation-workloads-ready',
    JSON.stringify({ backend, workloads: workloads.length, rendererCount: 1, technique }),
  );
} finally {
  await browser?.close();
  await server.close();
}

/**
 * Waits until the named workload owns the viewport at its authored configuration and is publishing frames.
 *
 * `requireZoomBuildUp` is the one condition that is not a mount invariant: Zoom text only reaches its reported scale
 * part-way through its own cycle, so the settled-mount sample must not wait for it.
 */
async function waitForSettledWorkload(
  page: Page,
  workload: (typeof workloads)[number],
  expectedBackend: PresentationBackend,
  requireZoomBuildUp: boolean,
): Promise<void> {
  await page.waitForFunction(
    ({ expected, requireZoom }) => {
      const viewport = document.querySelector<HTMLElement>('[data-testid="comparison-live-viewport"]');
      if (viewport === null) return false;
      const close = (attribute: string, value: number): boolean =>
        Math.abs(Number(viewport.getAttribute(attribute)) - value) < 0.000_001;
      const zoomReady = !requireZoom || expected.id !== 'zoom-text' || Number(viewport.dataset.zoomScale) >= 3;
      const animatedParagraph = expected.id === 'paragraph-stress';
      return (
        viewport.dataset.workload === expected.id &&
        viewport.dataset.presentationPending === 'false' &&
        viewport.dataset.backend === expected.backend &&
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
    { expected: { ...workload, backend: expectedBackend }, requireZoom: requireZoomBuildUp },
  );
}

/**
 * Draw and glyph counts are the batching evidence for one cell: the renderer issues one draw per packed glyph run, so
 * a change in batch topology shows up here and nowhere else in the probe output.
 */
async function readBatching(page: Page): Promise<{ readonly drawCount: number; readonly glyphCount: number }> {
  return page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('[data-testid="comparison-live-viewport"]');
    return { drawCount: Number(viewport?.dataset.drawCount), glyphCount: Number(viewport?.dataset.glyphCount) };
  });
}

async function assertCanvasHandoff(page: Page, label: string, expectedBackend: PresentationBackend): Promise<void> {
  const evidence = await page.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      presentationProbeCanvas: HTMLCanvasElement | undefined;
      presentationProbeCanvasEvents: string[];
    };
    const current = document.querySelector('canvas[data-configured-renderer-active="true"]');
    const viewport = document.querySelector<HTMLElement>('[data-testid="comparison-live-viewport"]');
    return {
      backend: viewport?.dataset.backend,
      disconnected: scope.presentationProbeCanvasEvents.some((event) => event.endsWith('disconnected')),
      rendererCount: Number(document.documentElement.dataset.activeConfiguredRenderers),
      retained: current !== null && current === scope.presentationProbeCanvas && current.isConnected,
    };
  });
  if (
    !evidence.retained ||
    evidence.disconnected ||
    evidence.rendererCount !== 1 ||
    evidence.backend !== expectedBackend
  ) {
    throw new Error(`${label} did not retain one continuously attached renderer canvas: ${JSON.stringify(evidence)}`);
  }
}

function presentationTechnique(value: string | undefined): 'bitmap' | 'mtsdf' | 'slug' {
  if (value === undefined || value === 'mtsdf') return 'mtsdf';
  if (value === 'bitmap' || value === 'slug') return value;
  throw new RangeError(`PRESENTATION_TECHNIQUE must be bitmap, mtsdf, or slug; received ${value}`);
}

function presentationBackend(value: string | undefined): PresentationBackend {
  if (value === undefined || value === 'webgpu') return 'webgpu';
  if (value === 'webgl2') return value;
  throw new RangeError(`PRESENTATION_BACKEND must be webgpu or webgl2; received ${value}`);
}

async function assertPresentationRemainsVisible(
  page: Page,
  workload: string,
  expectedBackend: PresentationBackend,
): Promise<void> {
  const minimumRequiredInkPixels = workload === 'zoom-text' ? 32 : 300;
  const startedAt = await page.evaluate(() => performance.now());
  while (true) {
    const canvasFailure = await page.evaluate((reportedBackend) => {
      const scope = globalThis as typeof globalThis & {
        presentationProbeCanvas: HTMLCanvasElement | undefined;
        presentationProbeCanvasEvidence: CanvasEvidence | undefined;
        presentationProbeCanvasEvents: string[];
        presentationProbeInputEvents: string[];
      };
      const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-configured-renderer-active="true"]');
      const expected = scope.presentationProbeCanvasEvidence;
      if (canvas === null || expected === undefined) return 'the configured renderer canvas is missing';
      if (canvas !== scope.presentationProbeCanvas) return 'the configured renderer canvas identity changed';
      const bounds = canvas.getBoundingClientRect();
      const actual: CanvasEvidence = {
        backingHeight: canvas.height,
        backingWidth: canvas.width,
        connected: canvas.isConnected,
        cssHeight: bounds.height,
        cssWidth: bounds.width,
      };
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        const navigationStatus =
          document.querySelector<HTMLElement>('[data-testid="canvas-navigation-status"]')?.textContent ?? 'missing';
        return `the canvas dimensions changed from ${JSON.stringify(expected)} to ${JSON.stringify(actual)}; browser DPR ${String(devicePixelRatio)}; URL ${location.search}; status ${navigationStatus.trim()}; canvas events ${scope.presentationProbeCanvasEvents.slice(-12).join(' | ')}; input events ${scope.presentationProbeInputEvents.slice(-12).join(' | ')}`;
      }
      const rendererCount = Number(document.documentElement.dataset.activeConfiguredRenderers);
      if (rendererCount !== 1) return `the active renderer count changed to ${String(rendererCount)}`;
      const viewport = document.querySelector<HTMLElement>('[data-testid="comparison-live-viewport"]');
      if (viewport?.dataset.backend !== reportedBackend) {
        return `the active backend changed to ${viewport?.dataset.backend ?? 'missing'}`;
      }
      if (Number(viewport?.dataset.glyphCount) <= 0 || Number(viewport?.dataset.drawCount) <= 0) {
        return 'the active workload stopped publishing glyphs or draw calls';
      }
      return undefined;
    }, expectedBackend);
    if (canvasFailure !== undefined) throw new Error(`${workload}: ${canvasFailure}`);
    const elapsedMs = await page.evaluate((start) => performance.now() - start, startedAt);
    if (elapsedMs >= presentationIntervalMs) break;
    const nextSampleAt = startedAt + Math.min(presentationIntervalMs, elapsedMs + presentationSamplePeriodMs);
    await page.evaluate(
      (targetTimestamp) =>
        new Promise<void>((resolve) => {
          const advance = (timestamp: number): void => {
            if (timestamp >= targetTimestamp) resolve();
            else requestAnimationFrame(advance);
          };
          requestAnimationFrame(advance);
        }),
      nextSampleAt,
    );
  }

  // Full-page capture can perturb a hardware-composited canvas on some Chromium/macOS combinations. Keep cadence
  // monitoring capture-free, then take one bounded headless proof after the workload has survived the interval.
  const screenshot = await page.screenshot();
  const visibleInkPixels = await visiblePresentationInkPixels(page, screenshot.toString('base64'));
  if (visibleInkPixels < minimumRequiredInkPixels) {
    throw new Error(`${workload} rendered only ${String(visibleInkPixels)} visible foreground pixels`);
  }
  const batching = await readBatching(page);
  console.log(
    'presentation-workload-visible',
    workload,
    visibleInkPixels,
    `draws=${String(batching.drawCount)}`,
    `glyphs=${String(batching.glyphCount)}`,
  );
}

interface CanvasEvidence {
  readonly backingHeight: number;
  readonly backingWidth: number;
  readonly connected: boolean;
  readonly cssHeight: number;
  readonly cssWidth: number;
}

type PresentationBackend = 'webgpu' | 'webgl2';

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
