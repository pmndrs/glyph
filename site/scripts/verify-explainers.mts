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
 * Drives the built site in a GPU-enabled Chromium and checks what the explainer element promises:
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

async function verifyDocsPage(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  const problems = watch(page, 'docs');
  await page.goto(`${ORIGIN}/docs/getting-started/introduction`, { waitUntil: 'load' });
  await page.waitForFunction(() => customElements.get('glyph-proxy') !== undefined);

  const first = '#introduction-glyph-proxy';
  const second = '#introduction-canvas-proxy';
  const last = '#introduction-physics-proxy';
  check((await page.locator('glyph-explainer-root').count()) === 1, 'docs: the page has one explainer root');
  check((await page.locator('glyph-proxy').count()) === 11, 'docs: eleven proxies are bound to it');
  check((await gpu(page)).devices === 0, 'docs: no GPU device exists while every proxy is below the fold');

  await scrollTo(page, first);
  await waitForState(page, first, 'live');
  await page.evaluate((query) => document.querySelector(query)?.scrollIntoView({ block: 'end' }), second);
  await waitForState(page, second, 'live');
  check((await stateOf(page, first)) === 'live', 'docs: two proxies in view are live together');
  await page.screenshot({ path: resolve(OUT, 'docs-1-two-proxies-live.png') });
  check(await framesAdvance(page, first), 'docs: frames are streamed into a live proxy');

  // Input goes to the proxy it was made on, and to the scene that proxy shows.
  await page.locator(second).click({ position: { x: 40, y: 40 } });
  await page.waitForFunction(() =>
    (document.querySelector('glyph-explainer-root')?.getAttribute('data-glyph-last-input') ?? '').includes(
      ':introduction-canvas-proxy:shaping:',
    ),
  );
  check(true, 'docs: a click on the second proxy is delivered to its scene, not the first');
  await page.locator(first).click({ position: { x: 40, y: 40 } });
  await page.waitForFunction(() =>
    (document.querySelector('glyph-explainer-root')?.getAttribute('data-glyph-last-input') ?? '').includes(
      ':introduction-glyph-proxy:glyph:',
    ),
  );
  check(true, 'docs: a click on the first proxy is delivered to its scene');

  // A scene control changes one proxy's scene through the same ordered stream.
  await page.locator('glyph-scene-control', { hasText: 'Shaping' }).first().click();
  await page.waitForFunction(() =>
    (document.querySelector('glyph-explainer-root')?.getAttribute('data-glyph-scene') ?? '')
      .split(',')
      .every((scene) => scene === 'shaping'),
  );
  check(true, 'docs: a scene control switches the scene of the proxy it names');
  await page.locator('glyph-scene-control', { hasText: 'Glyph' }).first().click();

  // Leaving the viewport ends the lease: the proxy holds its last frame and stops updating.
  const mountsBefore = Number(await rootAttribute(page, 'data-glyph-mounts'));
  await scrollTo(page, '#introduction-styling-proxy');
  await waitForState(page, first, 'held');
  check(await frameHolds(page, first), 'docs: a proxy without a lease keeps its last frame and stops updating');
  await page.screenshot({ path: resolve(OUT, 'docs-2-scrolled-first-held.png') });

  await scrollTo(page, first);
  await waitForState(page, first, 'live');
  check(await framesAdvance(page, first), 'docs: a returning proxy streams again');
  await page.screenshot({ path: resolve(OUT, 'docs-3-returned-live.png') });

  // Walk the whole page: every scene goes live, and the pool never exceeds its limit.
  const limit = Number(await rootAttribute(page, 'data-glyph-pool-limit'));
  let peak = 0;
  for (const id of await page.locator('glyph-proxy').evaluateAll((nodes) => nodes.map((node) => node.id))) {
    await scrollTo(page, `#${id}`);
    await waitForState(page, `#${id}`, 'live');
    peak = Math.max(peak, Number(await rootAttribute(page, 'data-glyph-slot-count')));
    await page.screenshot({ path: resolve(OUT, `docs-scene-${id.replace(/^introduction-|-proxy$/g, '')}.png`) });
  }
  check(peak <= limit, `docs: the pool peaked at ${peak} logical roots, within its limit of ${limit}`);
  check(Number(await rootAttribute(page, 'data-glyph-mounts')) > mountsBefore, 'docs: later scenes were mounted');

  // Keys reach the focused proxy's scene.
  const editing = '#introduction-editing-proxy';
  await scrollTo(page, editing);
  await waitForState(page, editing, 'live');
  await page.locator(editing).click({ position: { x: 60, y: 60 } });
  await page.keyboard.type('!');
  await page.waitForFunction(() =>
    (document.querySelector('glyph-explainer-root')?.getAttribute('data-glyph-last-input') ?? '').endsWith(
      ':introduction-editing-proxy:editing:keydown',
    ),
  );
  check(true, 'docs: a key typed in the focused editing proxy is delivered to the editing scene');
  await page.screenshot({ path: resolve(OUT, 'docs-4-editing-typed.png') });

  await scrollTo(page, last);
  await waitForState(page, last, 'live');
  const counters = await gpu(page);
  const rendering = counters.contexts.filter((type) => type === 'webgpu' || type.startsWith('webgl'));
  check(counters.devices === 1, `docs: one GPU device served eleven proxies (${counters.devices})`);
  check(rendering.length === 1, `docs: one rendering context exists (${rendering.join(', ')})`);
  check(
    counters.contexts.filter((type) => type === 'bitmaprenderer').length > 0,
    'docs: proxies present transferred bitmaps, not their own renderers',
  );
  console.info(
    `     backend ${await rootAttribute(page, 'data-glyph-backend')}, frame ${await rootAttribute(page, 'data-glyph-frame')}`,
  );
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

await mkdir(OUT, { recursive: true });
const stop = await serve(PORT);
const browser = await launch();
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  await instrument(context);
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
