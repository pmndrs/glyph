/* @workflow {
  "name": "probe:live-update-latency",
  "summary": "Measures input-to-visible-frame latency and glyph-transition behaviour for live text, font-size, and layout-width changes per technique.",
  "requirements": "Playwright Chromium with WebGPU. Set PROBE_BACKEND=webgl2 to measure the fallback backend.",
  "writes": "stdout only"
} */
import { fileURLToPath } from 'node:url';
import type { Browser, Page } from 'playwright';
import { createServer } from 'vite';

import { launchProjectChromium } from './support/project-chromium.mts';

/**
 * Answers one question per technique and per kind of change: after the surface receives an input, how many rendered
 * frames pass before the canvas shows the result, and how many distinct frames does the presentation pass through?
 *
 * The signal is the presented canvas rather than harness telemetry. Live stats publish on a 250 ms report interval,
 * which would swamp the latency being measured, and instrumenting the update path would measure the instrumentation.
 * Sampling the canvas once per animation frame measures what a viewer sees. Every run also samples an idle window, so
 * a distinct-frame count can never be read as motion when it is really sampling noise.
 */

const root = fileURLToPath(new URL('..', import.meta.url));
process.chdir(root);

const techniques = ['bitmap', 'mtsdf', 'slug'] as const;
type Technique = (typeof techniques)[number];

interface Scenario {
  readonly change: 'text' | 'font-size' | 'layout-width';
  readonly workload: 'advanced-shaping' | 'benchmark-ipsum';
  readonly control: RegExp;
  /** Absolute control values to apply in turn, or `undefined` to step the control's current value by one. */
  readonly values: readonly string[] | undefined;
}

const scenarios: readonly Scenario[] = [
  { change: 'text', workload: 'advanced-shaping', control: /^Timeline · /, values: undefined },
  { change: 'font-size', workload: 'benchmark-ipsum', control: /^Rendered size · /, values: ['26', '18', '30', '20'] },
  {
    change: 'layout-width',
    workload: 'benchmark-ipsum',
    control: /^Layout width · /,
    values: ['64', '92', '70', '88'],
  },
];

interface FrameObservation {
  /** Frames sampled before the canvas first differed; `0` means nothing changed inside the window. */
  readonly framesToChange: number;
  readonly latencyMs: number;
  /** Distinct canvas states observed inside the window. `1` is a snap; more than one is presented motion. */
  readonly distinctFrames: number;
  readonly sampledFrames: number;
}

interface ScenarioResult extends Scenario {
  readonly technique: Technique;
  readonly observations: readonly FrameObservation[];
  readonly idle: FrameObservation;
  readonly framesPerSecond: number;
  readonly transitioned: string | undefined;
  readonly matchedGlyphs: string | undefined;
  readonly targetGlyphs: string | undefined;
}

const backend = process.env.PROBE_BACKEND === 'webgl2' ? 'webgl2' : 'webgpu';
const observationWindowMs = 500;
const stepCount = 4;

const server = await createServer({ root, server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const address = server.httpServer?.address();
if (address === null || address === undefined || typeof address === 'string') {
  await server.close();
  throw new Error('Vite did not publish a local TCP address');
}
const port = String(address.port);

const results: ScenarioResult[] = [];
let browser: Browser | undefined;
try {
  browser = await launchProjectChromium({
    headless: true,
    args: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'],
  });
  for (const technique of techniques) {
    for (const scenario of scenarios) {
      const page = await browser.newPage({ viewport: { width: 1_280, height: 720 } });
      try {
        await openWorkload(page, technique, scenario.workload);
        results.push(await runScenario(page, technique, scenario));
      } finally {
        await page.close();
      }
    }
  }
} finally {
  await browser?.close();
  await server.close();
}

report(results);

async function openWorkload(page: Page, technique: Technique, workload: Scenario['workload']): Promise<void> {
  const url =
    `http://127.0.0.1:${port}/?mode=benchmark&technique=${technique}` +
    `&backend=${backend}&delivery=baked&dpr=1&font=inter&workload=${workload}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('canvas[data-configured-renderer-active="true"]') !== null, {
    timeout: 180_000,
  });
  await page.waitForFunction(
    (testId) => {
      const viewport = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
      return viewport !== null && Number(viewport.dataset.glyphCount) > 0;
    },
    `${technique}-live-viewport`,
    { timeout: 180_000 },
  );
  if (workload === 'advanced-shaping') {
    // Mixed-direction is the case where a source-text change reorders the visual run, and the showcase timeline
    // auto-plays: a self-advancing paragraph would credit its own reveal to the probe's input.
    await page.click('[data-custom-select="Case"]');
    await page.getByRole('option', { name: 'Mixed-direction paragraph' }).click();
    await page.getByRole('button', { name: 'Pause' }).click();
    const timeline = page.getByLabel(/^Timeline · /);
    const tickCount = Number(await timeline.getAttribute('max'));
    await setRangeValue(timeline, String(Math.round(tickCount / 2)));
  }
  await page.evaluate(installCanvasProbe);
  await page.waitForTimeout(600);
}

async function runScenario(page: Page, technique: Technique, scenario: Scenario): Promise<ScenarioResult> {
  await page.getByLabel(scenario.control).waitFor({ timeout: 30_000 });
  const idle = await page.evaluate((windowMs) => window.liveUpdateCanvasProbe.observe(windowMs), observationWindowMs);
  const observations: FrameObservation[] = [];
  for (let step = 0; step < stepCount; step += 1) {
    const value = scenario.values?.[step % scenario.values.length];
    observations.push(
      await page
        .getByLabel(scenario.control)
        .evaluate(
          (element, request) =>
            window.liveUpdateCanvasProbe.observe(request.windowMs, element as HTMLInputElement, request.value),
          { windowMs: observationWindowMs, value },
        ),
    );
    await page.waitForTimeout(400);
  }
  const evidence = await page.evaluate((testId) => {
    const viewport = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
    return {
      framesPerSecond: Number(viewport?.dataset.framesPerSecond ?? Number.NaN),
      transitioned: viewport?.dataset.presentationTransitioned,
      matchedGlyphs: viewport?.dataset.presentationMatchedGlyphs,
      targetGlyphs: viewport?.dataset.presentationTargetGlyphs,
    };
  }, `${technique}-live-viewport`);
  return { ...scenario, technique, observations, idle, ...evidence };
}

async function setRangeValue(control: ReturnType<Page['getByLabel']>, value: string): Promise<void> {
  await control.evaluate((element, next) => {
    const input = element as HTMLInputElement;
    // React tracks the last value it wrote, so the native setter is what makes a synthetic input event land.
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, value);
}

/**
 * Installs the per-frame canvas sampler as a page global so both the idle baseline and the input measurement run the
 * identical code path, with the input applied inside the same task that requests the first sampled frame.
 */
function installCanvasProbe(): void {
  window.liveUpdateCanvasProbe = {
    observe(windowMs: number, input?: HTMLInputElement, value?: string) {
      const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-configured-renderer-active="true"]');
      if (canvas === null) throw new Error('the probe canvas is missing');
      const width = 320;
      const height = 180;
      const scratch = document.createElement('canvas');
      scratch.width = width;
      scratch.height = height;
      const context = scratch.getContext('2d', { willReadFrequently: true });
      if (context === null) throw new Error('the probe scratch context is unavailable');
      const sample = (): Uint8ClampedArray => {
        context.clearRect(0, 0, width, height);
        context.drawImage(canvas, 0, 0, width, height);
        return context.getImageData(0, 0, width, height).data;
      };
      const differs = (left: Uint8ClampedArray, right: Uint8ClampedArray): boolean => {
        let changed = 0;
        for (let index = 0; index < left.length; index += 4) {
          const delta =
            Math.abs(left[index]! - right[index]!) +
            Math.abs(left[index + 1]! - right[index + 1]!) +
            Math.abs(left[index + 2]! - right[index + 2]!);
          if (delta > 12) changed += 1;
          if (changed > 3) return true;
        }
        return false;
      };
      return new Promise<{
        framesToChange: number;
        latencyMs: number;
        distinctFrames: number;
        sampledFrames: number;
      }>((resolve) => {
        let previous = sample();
        const startedAt = performance.now();
        let sampledFrames = 0;
        let framesToChange = 0;
        let latencyMs = Number.NaN;
        let distinctFrames = 0;
        const step = (): void => {
          sampledFrames += 1;
          const current = sample();
          if (differs(previous, current)) {
            distinctFrames += 1;
            previous = current;
            if (framesToChange === 0) {
              framesToChange = sampledFrames;
              latencyMs = performance.now() - startedAt;
            }
          }
          if (performance.now() - startedAt >= windowMs) {
            resolve({ framesToChange, latencyMs, distinctFrames, sampledFrames });
            return;
          }
          requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
        if (input !== undefined) {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
          setter?.call(input, value ?? String(Number(input.value) + 1));
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
      });
    },
  };
}

function report(all: readonly ScenarioResult[]): void {
  process.stdout.write(`backend=${backend} window=${String(observationWindowMs)}ms steps=${String(stepCount)}\n`);
  process.stdout.write(
    'technique change       frames-to-visible  latency-ms        distinct-frames  idle-distinct  fps    transitioned  matched/target\n',
  );
  for (const result of all) {
    const frames = result.observations.map((observation) => observation.framesToChange);
    const latencies = result.observations.map((observation) => observation.latencyMs);
    const distinct = result.observations.map((observation) => observation.distinctFrames);
    process.stdout.write(
      `${result.technique.padEnd(10)}${result.change.padEnd(14)}` +
        `${`${String(median(frames))} med / ${String(Math.max(...frames))} max`.padEnd(19)}` +
        `${`${median(latencies).toFixed(1)} / ${Math.max(...latencies).toFixed(1)}`.padEnd(18)}` +
        `${`${String(median(distinct))} med / ${String(Math.max(...distinct))} max`.padEnd(17)}` +
        `${String(result.idle.distinctFrames).padEnd(15)}` +
        `${result.framesPerSecond.toFixed(1).padEnd(7)}` +
        `${(result.transitioned ?? 'n/a').padEnd(14)}` +
        `${result.matchedGlyphs ?? 'n/a'}/${result.targetGlyphs ?? 'n/a'}\n`,
    );
  }
}

function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

declare global {
  interface Window {
    liveUpdateCanvasProbe: {
      observe(
        windowMs: number,
        input?: HTMLInputElement,
        value?: string,
      ): Promise<{
        framesToChange: number;
        latencyMs: number;
        distinctFrames: number;
        sampledFrames: number;
      }>;
    };
  }
}
