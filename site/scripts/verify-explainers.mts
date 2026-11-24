/* @workflow {
  "name": "site:verify-browser",
  "summary": "Check the built site in Chromium: one GPU device per page, poster, live and held frames, pool limit and input targeting.",
  "requirements": "A built site/dist and a GPU-enabled Chromium; pass an output directory for the screenshots.",
  "writes": "Screenshots under site/.cache/verify-explainers or the given directory"
} */

import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { BrowserContext, Page } from 'playwright';

import {
  gpuCounters as gpu,
  instrument,
  launch,
  serve,
  SITE,
  waitForProxyState as waitForState,
  watch,
} from './browser.mts';

/**
 * Drives the built site in a GPU-enabled Chromium. The landing page at `/` must draw and stay silent in the
 * console. On the docs and the examples it checks what the explainer element promises:
 * one renderer and one device per page however many proxies it has, a poster until a scene's first
 * frame, frames streamed while a proxy holds a lease, the last frame held when it does not, scenes
 * resumed rather than remounted when a proxy returns, and input delivered to the proxy it was made on.
 *
 *   pnpm --filter @pmndrs/glyph-site verify:browser [output-directory]
 *
 * Every wait is on a page condition. Screenshots are evidence for a reader, not the assertion.
 */
const OUT = resolve(process.argv[2] ?? resolve(SITE, '.cache/verify-explainers'));
const PORT = 4391;
const ORIGIN = `http://127.0.0.1:${PORT}`;

const failures: string[] = [];
function check(condition: boolean, claim: string): void {
  console.info(`${condition ? 'ok  ' : 'FAIL'} ${claim}`);
  if (!condition) failures.push(claim);
}

const stateOf = (page: Page, selector: string) =>
  page.evaluate((query) => document.querySelector(query)?.getAttribute('data-glyph-state') ?? 'missing', selector);

const rootAttribute = (page: Page, name: string) =>
  page.evaluate((attribute) => document.querySelector('glyph-explainer-root')?.getAttribute(attribute) ?? '', name);

/** A digest of the pixels a proxy is showing, read from the canvas in its shadow tree. */
async function frameDigest(page: Page, selector: string): Promise<number> {
  return page.evaluate(async (query) => {
    const canvas = document.querySelector(query)?.shadowRoot?.querySelector('canvas');
    if (!canvas) return -1;
    const bitmap = await createImageBitmap(canvas, { resizeWidth: 64, resizeHeight: 36 });
    const scratch = new OffscreenCanvas(64, 36).getContext('2d')!;
    scratch.drawImage(bitmap, 0, 0);
    let digest = 0;
    for (const value of scratch.getImageData(0, 0, 64, 36).data) digest = (Math.imul(digest, 31) + value) | 0;
    return digest;
  }, selector);
}

/** Resolves once the proxy has shown a frame that differs from `from`: proof that frames are streamed into it. */
async function framesAdvance(page: Page, selector: string): Promise<boolean> {
  const from = await frameDigest(page, selector);
  for (let frame = 0; frame < 240; frame += 1) {
    await page.evaluate(() => new Promise((next) => requestAnimationFrame(next)));
    if ((await frameDigest(page, selector)) !== from) return true;
  }
  return false;
}

/** True when the proxy shows the same pixels across sixty animation frames. */
async function frameHolds(page: Page, selector: string): Promise<boolean> {
  const from = await frameDigest(page, selector);
  for (let frame = 0; frame < 60; frame += 1) {
    await page.evaluate(() => new Promise((next) => requestAnimationFrame(next)));
    if ((await frameDigest(page, selector)) !== from) return false;
  }
  return true;
}

const scrollTo = (page: Page, selector: string) =>
  page.evaluate((query) => document.querySelector(query)?.scrollIntoView({ block: 'center' }), selector);

const lastInput = (page: Page, needle: string) =>
  page.waitForFunction(
    (wanted) =>
      (document.querySelector('glyph-explainer-root')?.getAttribute('data-glyph-last-input') ?? '').includes(wanted),
    needle,
  );

async function verifyDocsPage(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  const problems = watch(page, 'docs');
  // Six proxies on a root limited to two logical roots.
  await page.goto(`${ORIGIN}/docs/guides/scene/custom-materials`, { waitUntil: 'load' });
  await page.waitForFunction(() => customElements.get('glyph-proxy') !== undefined);

  const proxy = (scene: string) => `glyph-proxy[data-scene="${scene}"]`;
  const scenes = await page
    .locator('glyph-proxy')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-scene') ?? ''));
  const first = proxy('ripple');
  check((await page.locator('glyph-explainer-root').count()) === 1, 'docs: the page has one explainer root');
  check(scenes.length === 6, `docs: six proxies are bound to it (${scenes.length})`);

  await scrollTo(page, first);
  await page.waitForFunction((query) => {
    const poster = document.querySelector(query)?.shadowRoot?.querySelector('img');
    return poster !== null && poster !== undefined && poster.complete && poster.naturalWidth > 0;
  }, first);
  check(true, 'docs: a proxy shows the poster its root names');
  await waitForState(page, first, 'live');
  check(await framesAdvance(page, first), 'docs: frames are streamed into a live proxy');
  await page.screenshot({ path: resolve(OUT, 'docs-1-live.png') });

  // Leaving the viewport ends the lease: the proxy holds its last frame and stops updating.
  const mountsBefore = Number(await rootAttribute(page, 'data-glyph-mounts'));
  await scrollTo(page, proxy(scenes[0]!));
  await waitForState(page, first, 'held');
  check(await frameHolds(page, first), 'docs: a proxy without a lease keeps its last frame and stops updating');
  await page.screenshot({ path: resolve(OUT, 'docs-2-scrolled-held.png') });

  await scrollTo(page, first);
  await waitForState(page, first, 'live');
  check(await framesAdvance(page, first), 'docs: a returning proxy streams again');
  await page.screenshot({ path: resolve(OUT, 'docs-3-returned-live.png') });

  // Walk the whole page: every scene goes live, and the pool never exceeds its limit.
  const limit = Number(await rootAttribute(page, 'data-glyph-pool-limit'));
  let peak = 0;
  for (const scene of scenes) {
    await scrollTo(page, proxy(scene));
    await waitForState(page, proxy(scene), 'live');
    peak = Math.max(peak, Number(await rootAttribute(page, 'data-glyph-slot-count')));
  }
  check(peak <= limit, `docs: the pool peaked at ${peak} logical roots, within its limit of ${limit}`);
  check(Number(await rootAttribute(page, 'data-glyph-mounts')) > mountsBefore, 'docs: later scenes were mounted');

  const counters = await gpu(page);
  const rendering = counters.contexts.filter((type) => type === 'webgpu' || type.startsWith('webgl'));
  check(counters.devices === 1, `docs: one GPU device served six proxies (${counters.devices})`);
  check(rendering.length === 1, `docs: one rendering context exists (${rendering.join(', ')})`);
  check(
    counters.contexts.filter((type) => type === 'bitmaprenderer').length > 0,
    'docs: proxies present transferred bitmaps, not their own renderers',
  );
  console.info(
    `     backend ${await rootAttribute(page, 'data-glyph-backend')}, frame ${await rootAttribute(page, 'data-glyph-frame')}`,
  );

  // Input goes to the proxy it was made on, and to the scene that proxy shows.
  await page.goto(`${ORIGIN}/docs/guides/editing/keyboard-movement`, { waitUntil: 'load' });
  await page.waitForFunction(() => customElements.get('glyph-proxy') !== undefined);
  await scrollTo(page, proxy('editing-boundary'));
  await waitForState(page, proxy('editing-boundary'), 'live');
  await page.locator(proxy('editing-boundary')).hover({ position: { x: 200, y: 120 } });
  await lastInput(page, ':editing-boundary:pointermove');
  check(true, 'docs: pointer motion over one proxy is delivered to its scene');
  await page.screenshot({ path: resolve(OUT, 'docs-4-boundary-hover.png') });

  // Keys reach the focused proxy's scene.
  await page.goto(`${ORIGIN}/docs/tutorials/editable-text-field`, { waitUntil: 'load' });
  await page.waitForFunction(() => customElements.get('glyph-proxy') !== undefined);
  const field = proxy('editing-field');
  await scrollTo(page, field);
  await waitForState(page, field, 'live');
  const before = await frameDigest(page, field);
  await page.locator(field).click({ position: { x: 240, y: 150 } });
  await lastInput(page, ':editing-field:pointer');
  await page.keyboard.type('glyph');
  await lastInput(page, ':editing-field:keydown');
  await page.waitForFunction(
    () => new Promise((next) => requestAnimationFrame(() => requestAnimationFrame(() => next(true)))),
  );
  check((await frameDigest(page, field)) !== before, 'docs: typing in the focused field changes what it draws');
  await page.screenshot({ path: resolve(OUT, 'docs-5-field-typed.png') });

  // A scene control sends its action through the same ordered stream.
  await page.goto(`${ORIGIN}/docs/getting-started/introduction`, { waitUntil: 'load' });
  await page.waitForFunction(() => customElements.get('glyph-proxy') !== undefined);
  await scrollTo(page, '#introduction-physics-proxy');
  await waitForState(page, '#introduction-physics-proxy', 'live');
  await page.locator('glyph-scene-control').click();
  await lastInput(page, ':introduction-physics-proxy:physics:control');
  check(true, 'docs: a scene control reaches the proxy it names');

  check(
    problems.length === 0,
    `docs: no console errors or failed requests${problems.map((p) => `\n       ${p}`).join('')}`,
  );
  await page.close();
}

async function verifyGallery(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  const problems = watch(page, 'gallery');
  await page.goto(`${ORIGIN}/examples/`, { waitUntil: 'load' });
  await page.waitForFunction(() => customElements.get('glyph-proxy') !== undefined);

  const card = (slug: string) => `glyph-proxy[data-scene="${slug}"]`;
  const cards = await page.locator('glyph-proxy').count();
  await page.waitForFunction((query) => {
    const poster = document.querySelector(query)?.shadowRoot?.querySelector('img');
    return poster !== null && poster !== undefined && poster.complete && poster.naturalWidth > 0;
  }, card('first-text'));
  check(
    await page.evaluate(() =>
      [...document.querySelectorAll('glyph-proxy')].every(
        (proxy) => proxy.getAttribute('data-glyph-state') === 'poster',
      ),
    ),
    `gallery: all ${cards} cards show a poster before anything is engaged`,
  );
  check((await gpu(page)).devices === 0, 'gallery: no GPU device exists until a card is engaged');
  await page.screenshot({ path: resolve(OUT, 'gallery-1-posters.png') });

  await page.locator(card('first-text')).hover();
  await waitForState(page, card('first-text'), 'live');
  await page.screenshot({ path: resolve(OUT, 'gallery-2-first-card-live.png') });

  await page.locator(card('ripple')).hover();
  await waitForState(page, card('ripple'), 'live');
  check(await framesAdvance(page, card('ripple')), 'gallery: an engaged card streams frames');
  await page.locator(card('shaping')).hover();
  await waitForState(page, card('shaping'), 'live');
  await waitForState(page, card('first-text'), 'held');
  check(await frameHolds(page, card('first-text')), 'gallery: the card that lost its lease holds its last frame');
  await page.screenshot({ path: resolve(OUT, 'gallery-3-third-card-live-first-held.png') });

  const counters = await gpu(page);
  check(counters.devices === 1, `gallery: one GPU device served every engaged card (${counters.devices})`);
  check(Number(await rootAttribute(page, 'data-glyph-slot-count')) <= 2, 'gallery: at most two logical roots exist');
  check(
    problems.length === 0,
    `gallery: no console errors or failed requests${problems.map((p) => `\n       ${p}`).join('')}`,
  );
  await page.close();
}

async function verifyPreview(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  const problems = watch(page, 'preview');
  await page.goto(`${ORIGIN}/examples/?example=caret`, { waitUntil: 'commit' });
  // The poster is what the reader sees while the scene, its fonts and the engine load.
  await page.waitForFunction(() => {
    const poster = document.querySelector('glyph-proxy')?.shadowRoot?.querySelector('img');
    return poster !== null && poster !== undefined && poster.complete && poster.naturalWidth > 0;
  });
  const before = await stateOf(page, 'glyph-proxy');
  await page.screenshot({ path: resolve(OUT, 'preview-1-poster.png') });
  await waitForState(page, 'glyph-proxy', 'live');
  await page.screenshot({ path: resolve(OUT, 'preview-2-live.png') });
  check(before === 'poster' || before === 'entering' || before === 'live', `preview: poster shown first (${before})`);
  await page.mouse.click(400, 300);
  await page.waitForFunction(() =>
    (document.querySelector('glyph-explainer-root')?.getAttribute('data-glyph-last-input') ?? '').includes(':caret:'),
  );
  await page.screenshot({ path: resolve(OUT, 'preview-3-caret-placed.png') });
  check(true, 'preview: a click reaches the caret scene');
  check(
    problems.length === 0,
    `preview: no console errors or failed requests${problems.map((p) => `\n       ${p}`).join('')}`,
  );
  await page.close();
}

/** The landing page is its own app at `/`: it must draw the mark, and log neither an error nor a warning. */
async function verifyLanding(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  const problems = watch(page, 'landing', { warnings: true });
  await page.goto(`${ORIGIN}/`, { waitUntil: 'load' });
  // The mark and the chorus are lit type on a near-black ground, so a drawn frame has bright pixels.
  const drawn = await page
    .waitForFunction(
      async () => {
        const canvas = document.querySelector('canvas');
        if (canvas === null || canvas.width < 2) return false;
        const bitmap = await createImageBitmap(canvas, { resizeWidth: 64, resizeHeight: 40 });
        const scratch = new OffscreenCanvas(64, 40).getContext('2d')!;
        scratch.drawImage(bitmap, 0, 0);
        const pixels = scratch.getImageData(0, 0, 64, 40).data;
        let bright = 0;
        for (let index = 0; index < pixels.length; index += 4)
          if (pixels[index]! + pixels[index + 1]! + pixels[index + 2]! > 360) bright += 1;
        return bright > 40;
      },
      undefined,
      { timeout: 30_000 },
    )
    .then(
      () => true,
      () => false,
    );
  check(drawn, 'landing: the wordmark and the chorus are drawn');
  await page.screenshot({ path: resolve(OUT, 'landing-1-drawn.png') });
  check((await page.locator('a', { hasText: /get started/i }).count()) > 0, 'landing: the page links to the docs');
  const favicon = await page.request.get(`${ORIGIN}/favicon.ico`);
  check(favicon.ok(), 'landing: the favicon is served');
  check(
    problems.length === 0,
    `landing: no console errors, warnings or failed requests${problems.map((p) => `\n       ${p}`).join('')}`,
  );
  await page.close();
}

await mkdir(OUT, { recursive: true });
const stop = await serve(PORT);
const browser = await launch();
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  await instrument(context);
  await verifyLanding(context);
  await verifyDocsPage(context);
  await verifyGallery(context);
  await verifyPreview(context);
} finally {
  await browser.close();
  stop();
}
console.info(`\nScreenshots: ${OUT}`);
if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
