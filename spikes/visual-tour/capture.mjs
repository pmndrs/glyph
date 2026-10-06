#!/usr/bin/env node
// Deterministic Presentation capture for the visual tour.
//
// It drives the same page as `benchmark:presentation-screenshots` (benches/scripts/run-presentation-workload-probe.mts):
// the worktree's own Vite server, the `/presentation?mode=benchmark&…&delivery=baked&dpr=2&font=inter` route, and the
// same "Live workload" picker and workload table. It renders nothing itself. What it adds is a page clock: the stock
// probe screenshots animated workloads at whatever moment the soak ends, so two runs of one build differ by whole
// frames. Here `performance.now()` and every requestAnimationFrame timestamp come from a clock the driver sets, so each
// workload is captured at fixed scene times after its mount, and two builds see the same sequence of timestamps.
//
// Run from a worktree's benches/ directory (tour.mjs does this):
//   node capture.mjs --out <dir> --backend webgpu|webgl2 --technique bitmap|mtsdf|slug
//                    [--workloads a,b] [--times 0,2500] [--dpr 2] [--software] [--headed]
// Writes <out>/<backend>-<technique>-<workload>-t<ms>.png and <out>/manifest.json; exits 0 when the browser session
// ran, recording per-scene failures in the manifest, and 1 when the page itself never became ready.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const WORKLOADS = [
  ['editorial', 'Editorial'],
  ['text-ladder', 'Text ladder'],
  ['zoom-text', 'Zoom text'],
  ['icon-grid', 'Icon grid'],
  ['billboard-labels', 'Billboard labels'],
  ['off-axis-3d', 'Off-axis / 3D'],
  ['dynamic-layout', 'Dynamic layout'],
  ['paragraph-stress', 'Paragraph stress'],
  ['paint-effects', 'Paint & effects'],
  ['rich-text', 'Rich text spans'],
];

export const SOFTWARE_FLAGS = [
  '--enable-features=Vulkan',
  '--use-vulkan=swiftshader',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
];
const GPU_FLAGS = ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'];

/**
 * Launches the browser for a capture. An explicit `PMNDRS_GLYPH_CHROMIUM_EXECUTABLE_PATH` wins. Otherwise a GPU
 * capture uses the locally installed Google Chrome (Playwright's `chrome` channel), which runs on the machine's real
 * GPU. Playwright's own Chromium is the fallback, and also the default for `--software` runs.
 */
async function launchBrowser(chromium, { headed, software }) {
  const args = [...GPU_FLAGS, ...(software ? SOFTWARE_FLAGS : [])];
  const headless = !headed;
  const executablePath = process.env.PMNDRS_GLYPH_CHROMIUM_EXECUTABLE_PATH || undefined;
  if (executablePath !== undefined) {
    const browser = await chromium.launch({ headless, executablePath, args });
    browser.tourSource = `${browser.version()} via ${executablePath}`;
    return browser;
  }
  const attempts = software ? ['managed', 'chrome'] : ['chrome', 'managed'];
  const failures = [];
  for (const attempt of attempts) {
    try {
      const browser =
        attempt === 'chrome'
          ? await chromium.launch({ headless, channel: 'chrome', args })
          : await chromium.launch({ headless, args });
      browser.tourSource = `${browser.version()} via ${attempt === 'chrome' ? 'installed Google Chrome' : 'Playwright-managed Chromium'}`;
      return browser;
    } catch (error) {
      failures.push(`${attempt}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
    }
  }
  throw new Error(
    [
      'no browser could be launched for the capture.',
      ...failures,
      'Fix one of these:',
      '  install Google Chrome (used automatically), or',
      '  pass --chromium "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", or',
      '  run `pnpm --filter @pmndrs/glyph-benchmarks exec playwright install chromium` once.',
    ].join('\n'),
  );
}
/** The clock starts here when the driver takes it over, so both builds see identical absolute timestamps. */
const FROZEN_EPOCH_MS = 10_000_000;

// Installed before any page script. Real time runs until `__tour.freeze()`; afterwards time moves only by `setTime`.
// Animation frames keep flowing (every real frame runs the queued callbacks), so rendering and readiness proceed.
function installTourClock() {
  const realNow = performance.now.bind(performance);
  const realRaf = window.requestAnimationFrame.bind(window);
  let frozen = false;
  let frozenAt = 0;
  let queue = new Map();
  let nextId = 1;
  let frames = 0;
  performance.now = () => (frozen ? frozenAt : realNow());
  window.requestAnimationFrame = (callback) => {
    const id = nextId++;
    queue.set(id, callback);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    queue.delete(id);
  };
  const pump = (realTimestamp) => {
    const timestamp = frozen ? frozenAt : realTimestamp;
    const batch = queue;
    queue = new Map();
    frames += 1;
    for (const callback of batch.values()) {
      try {
        callback(timestamp);
      } catch (error) {
        queueMicrotask(() => {
          throw error;
        });
      }
    }
    realRaf(pump);
  };
  realRaf(pump);
  Object.defineProperty(window, '__tour', {
    value: {
      freeze(at) {
        frozen = true;
        frozenAt = at;
      },
      setTime(at) {
        frozenAt = at;
      },
      get now() {
        return frozenAt;
      },
      get frames() {
        return frames;
      },
    },
  });
}

function option(argv, name, fallback) {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : argv[index + 1];
}

async function main(argv) {
  const out = resolve(option(argv, 'out', '.cache/visual-tour'));
  const backend = option(argv, 'backend', 'webgpu');
  const technique = option(argv, 'technique', 'mtsdf');
  const selected = option(argv, 'workloads', '');
  const times = option(argv, 'times', '0,2500')
    .split(',')
    .map(Number)
    .sort((a, b) => a - b);
  const dpr = Number(option(argv, 'dpr', '2'));
  const software = argv.includes('--software');
  const headed = argv.includes('--headed');
  if (!['webgpu', 'webgl2'].includes(backend)) throw new RangeError(`--backend must be webgpu or webgl2: ${backend}`);
  if (!['bitmap', 'mtsdf', 'slug'].includes(technique)) {
    throw new RangeError(`--technique must be bitmap, mtsdf or slug: ${technique}`);
  }
  if (times.some((time) => !Number.isFinite(time) || time < 0)) throw new RangeError('--times must be ms >= 0');
  const workloads = selected === '' ? WORKLOADS : WORKLOADS.filter(([id]) => selected.split(',').includes(id));
  if (workloads.length === 0) throw new RangeError(`--workloads matched nothing: ${selected}`);

  const benches = process.cwd();
  const modules = join(benches, 'node_modules');
  if (!existsSync(join(modules, 'vite')) || !existsSync(join(modules, 'playwright'))) {
    throw new Error(`${benches} has no installed vite/playwright; run pnpm install in the worktree`);
  }
  const { createServer } = await import(pathToFileURL(join(modules, 'vite/dist/node/index.js')).href);
  const { chromium } = await import(pathToFileURL(join(modules, 'playwright/index.mjs')).href);
  await mkdir(out, { recursive: true });

  const manifest = {
    benches,
    backend,
    technique,
    times,
    dpr,
    software,
    browser: undefined,
    startedAt: new Date().toISOString(),
    scenes: [],
    pageErrors: [],
    error: undefined,
  };
  const server = await createServer({ root: benches, logLevel: 'warn', server: { host: '127.0.0.1', port: 0 } });
  await server.listen();
  const address = server.httpServer?.address();
  let browser;
  try {
    if (address === null || typeof address !== 'object') throw new Error('Vite did not publish a TCP address');
    browser = await launchBrowser(chromium, { headed, software });
    manifest.browser = browser.tourSource;
    const page = await browser.newPage({ viewport: { width: 1_280, height: 720 }, deviceScaleFactor: dpr });
    page.on('pageerror', (error) => manifest.pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') manifest.pageErrors.push(`console: ${message.text()}`);
    });
    await page.addInitScript(installTourClock);
    const initial = workloads[0][0] === 'text-ladder' ? 'editorial' : 'text-ladder';
    await page.goto(
      `http://127.0.0.1:${address.port}/presentation?mode=benchmark&technique=${technique}&backend=${backend}&delivery=baked&dpr=2&font=inter&workload=${initial}`,
      { waitUntil: 'domcontentloaded' },
    );
    const picker = page.getByLabel('Live workload', { exact: true });
    await picker.waitFor({ timeout: 120_000 });
    await waitForSettled(page, initial, backend, 180_000);
    manifest.adapter = await page.evaluate(
      () => document.querySelector('canvas[data-configured-renderer-active="true"]')?.dataset ?? null,
    );
    await page.evaluate((at) => window.__tour.freeze(at), FROZEN_EPOCH_MS);

    let broken;
    for (const [id, label] of workloads) {
      const started = Date.now();
      if (broken !== undefined) {
        for (const time of times) manifest.scenes.push({ workload: id, label, time, error: broken });
        continue;
      }
      try {
        const epoch = await page.evaluate(() => window.__tour.now);
        await picker.click();
        await page.getByRole('option', { name: label, exact: true }).click();
        await waitForSettled(page, id, backend, 120_000);
        for (const time of times) {
          await page.evaluate((at) => window.__tour.setTime(at), epoch + time);
          await settleFrames(page, id, backend);
          const file = `${backend}-${technique}-${id}-t${time}.png`;
          const counts = await shoot(page, join(out, file));
          manifest.scenes.push({ workload: id, label, time, file, ...counts, ms: Date.now() - started });
          console.log(`captured ${file} glyphs=${counts.glyphCount} draws=${counts.drawCount}`);
        }
      } catch (error) {
        const pageError = manifest.pageErrors[0]?.split('\n')[0];
        const message = [error instanceof Error ? error.message.split('\n')[0] : String(error), pageError]
          .filter(Boolean)
          .join(' — page error: ');
        for (const time of times) manifest.scenes.push({ workload: id, label, time, error: message });
        console.error(`failed ${backend}/${technique}/${id}: ${message}`);
        // A page that threw stays broken; skip the remaining workloads instead of timing out on each.
        if (pageError !== undefined) broken = `skipped after a page error: ${pageError}`;
      }
    }
  } catch (error) {
    manifest.error = error instanceof Error ? error.message.split('\n')[0] : String(error);
    console.error(`capture session failed: ${manifest.error}`);
  } finally {
    await browser?.close().catch(() => {});
    await server.close();
    manifest.finishedAt = new Date().toISOString();
    // Keep earlier scenes of other workloads, so a partial re-capture only replaces what it captured.
    const previous = await readFile(join(out, 'manifest.json'), 'utf8').then(JSON.parse, () => undefined);
    const captured = new Set(workloads.map(([id]) => id));
    const kept = (previous?.scenes ?? []).filter((scene) => !captured.has(scene.workload));
    manifest.scenes = [...kept, ...manifest.scenes];
    await writeFile(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  }
  return manifest.error === undefined ? 0 : 1;
}

async function waitForSettled(page, workload, backend, timeout) {
  await page.waitForFunction(
    ({ workload, backend }) => {
      const viewport = document.querySelector('[data-testid="comparison-live-viewport"]');
      return (
        viewport !== null &&
        viewport.dataset.workload === workload &&
        viewport.dataset.backend === backend &&
        viewport.dataset.presentationPending === 'false' &&
        Number(viewport.dataset.glyphCount) > 0 &&
        Number(viewport.dataset.drawCount) > 0 &&
        document.querySelector('canvas[data-configured-renderer-active="true"]') !== null
      );
    },
    { workload, backend },
    { timeout, polling: 50 },
  );
}

/** Lets the frame at the current scene time render, any layout it triggers publish, and the result present. */
async function settleFrames(page, workload, backend) {
  const waitFrames = async (count) => {
    const goal = await page.evaluate((count) => window.__tour.frames + count, count);
    await page.waitForFunction((goal) => window.__tour.frames >= goal, goal, { polling: 16, timeout: 60_000 });
  };
  await waitFrames(4);
  await waitForSettled(page, workload, backend, 60_000);
  await waitFrames(3);
}

/** Hides every DOM overlay (controls, telemetry), screenshots only the renderer canvas, then restores the page. */
async function shoot(page, path) {
  const handle = await page.evaluateHandle(() => {
    const style = document.createElement('style');
    style.textContent =
      'body * { visibility: hidden !important; } canvas[data-configured-renderer-active="true"] { visibility: visible !important; }';
    document.head.append(style);
    return style;
  });
  try {
    const canvas = page.locator('canvas[data-configured-renderer-active="true"]');
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    await canvas.screenshot({ path, animations: 'allow', caret: 'initial' });
    return await page.evaluate(() => {
      const viewport = document.querySelector('[data-testid="comparison-live-viewport"]');
      return { glyphCount: Number(viewport?.dataset.glyphCount), drawCount: Number(viewport?.dataset.drawCount) };
    });
  } finally {
    await handle.evaluate((style) => style.remove());
    await handle.dispose();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await main(process.argv.slice(2));
}
