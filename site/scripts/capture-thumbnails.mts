/* @workflow {
  "name": "site:capture-thumbnails",
  "summary": "Capture the gallery posters for the hosted examples from the built site.",
  "requirements": "A built site/dist and a GPU-enabled Chromium; pass example slugs to capture a subset.",
  "writes": "Checked-in site/examples/public/thumbnails/<slug>.webp files."
} */

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, type Page } from 'playwright';

import { EXAMPLE_SLUGS, isExampleSlug, type ExampleSlug } from '../examples/src/catalog.ts';

/**
 * Gallery posters for the hosted examples.
 *
 * Every card in the docs shows a still of its scene before the scene is asked to run, and those
 * stills are checked in. This captures them: it serves the built site, opens one example per tab
 * at the poster's own resolution, lets it reach the moment worth showing, hides the badge that
 * links back to the page, and reads the WebGPU canvas straight out as WebP.
 *
 * The scenes are animated, so a capture has to name a moment. `AT` is that choice — the point in
 * a scene's own timeline where it reads as what it is, which for a typewriter scene is far enough
 * in that there are words on screen and for a still one is as soon as it has settled. It is art
 * direction, not a timing cushion: a scene captured at a different second is a different picture,
 * not a flakier one.
 *
 *   pnpm --filter @pmndrs/glyph-site capture:thumbnails            # every example
 *   pnpm --filter @pmndrs/glyph-site capture:thumbnails orbit      # just these
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = resolve(HERE, '..');
const OUT = resolve(SITE, 'examples/public/thumbnails');

/** Posters are 1920×1080 whatever shape the card crops them to, so one capture serves every aspect. */
const POSTER = { width: 1920, height: 1080 } as const;

/** Seconds into a scene's own run to capture it. The default suits a scene that settles and holds. */
const SETTLE = 6;
const AT: Partial<Record<ExampleSlug, number>> = {
  // The typewriter scenes need a passage on screen; these are the beats where one is.
  kinetic: 14,
  orbit: 9,
  ripple: 11,
  editing: 9,
  caret: 8,
  ribbon: 8,
  'break-apart': 10,
  'split-flap': 7,
};

async function serve(): Promise<{ readonly origin: string; readonly stop: () => void }> {
  const port = 5399;
  const child = spawn('node', [resolve(HERE, 'serve-dist.mts'), String(port)], {
    cwd: SITE,
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise<void>((ok, fail) => {
    child.stdout.once('data', () => ok());
    child.once('error', fail);
    child.once('exit', (code) => fail(new Error(`server exited with ${code}; is dist/ built?`)));
  });
  return { origin: `http://127.0.0.1:${port}`, stop: () => child.kill() };
}

/** Reads the scene's canvas, wherever the explainer element put it, as a WebP data URL. */
async function readCanvas(page: Page): Promise<string> {
  return page.evaluate(() => {
    const found: HTMLCanvasElement[] = [];
    const walk = (root: ParentNode): void => {
      for (const el of root.querySelectorAll('*')) {
        if (el instanceof HTMLCanvasElement) found.push(el);
        if (el.shadowRoot) walk(el.shadowRoot);
      }
    };
    walk(document);
    const canvas = found[0];
    if (!canvas) throw new Error('no canvas on the page');
    return canvas.toDataURL('image/webp', 0.92);
  });
}

async function capture(slug: ExampleSlug, origin: string, page: Page): Promise<number> {
  await page.goto(`${origin}/examples/?example=${slug}`, { waitUntil: 'load' });
  // The badge links back to the docs page and is chrome, not scene; the poster is the scene alone.
  await page.addStyleTag({ content: '.example-source { display: none !important; }' });
  await page.waitForTimeout((AT[slug] ?? SETTLE) * 1000);
  const url = await readCanvas(page);
  const bytes = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  await writeFile(resolve(OUT, `${slug}.webp`), bytes);
  return bytes.byteLength;
}

// `pnpm scripts run <name> -- <slugs>` forwards the separator itself, so it is dropped here.
const asked = process.argv.slice(2).filter((argument) => argument !== '--');
const bad = asked.filter((slug) => !isExampleSlug(slug));
if (bad.length > 0) throw new Error(`not examples: ${bad.join(', ')}`);
const slugs: readonly ExampleSlug[] = asked.length > 0 ? (asked as ExampleSlug[]) : EXAMPLE_SLUGS;

await mkdir(OUT, { recursive: true });
const server = await serve();
const browser = await chromium.launch({
  args: ['--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'],
});
try {
  const context = await browser.newContext({ viewport: POSTER, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (error) => {
    throw error; // a scene that threw is not a poster
  });
  for (const slug of slugs) {
    const size = await capture(slug, server.origin, page);
    console.log(`${slug}.webp  ${(size / 1024).toFixed(0)}KB`);
  }
} finally {
  await browser.close();
  server.stop();
}
