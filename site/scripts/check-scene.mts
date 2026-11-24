/* @workflow {
  "name": "site:check-scene",
  "summary": "Open example scenes on a running examples dev server, wait for each to go live, and report console errors.",
  "requirements": "pnpm --filter @pmndrs/glyph-site dev:examples running (ORIGIN, default http://127.0.0.1:5173) and a GPU-enabled Chromium; pass an output directory, then scene slugs.",
  "writes": "One screenshot per scene in the output directory"
} */

import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import { launch, SITE, watch } from './browser.mts';

/**
 * The quick loop while writing a scene: no build, one page per slug on the dev server.
 *
 *   node scripts/check-scene.mts <output-directory> <slug> [<slug>…]
 *
 * SECONDS (default 2) is how far into the scene the screenshot is taken, for scenes that animate in.
 */
const [outArgument, ...slugs] = process.argv.slice(2).filter((argument) => argument !== '--');
if (outArgument === undefined || slugs.length === 0) {
  throw new Error('usage: check-scene.mts <output-directory> <slug> [<slug>…]');
}
const OUT = resolve(SITE, outArgument);
const ORIGIN = process.env['ORIGIN'] ?? 'http://127.0.0.1:5173';
const settle = Number(process.env['SECONDS_IN'] ?? 2) * 1000;

await mkdir(OUT, { recursive: true });
const browser = await launch();
let failed = 0;
try {
  for (const slug of slugs) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const problems = watch(page, slug);
    await page.goto(`${ORIGIN}/examples/?example=${slug}`, { waitUntil: 'load' });
    const live = await page
      .waitForFunction(
        () => document.querySelector('glyph-proxy')?.getAttribute('data-glyph-state') === 'live',
        undefined,
        {
          timeout: 30_000,
        },
      )
      .then(
        () => true,
        () => false,
      );
    if (!live) problems.push(`${slug}: did not go live within 30 s (is the slug in the catalog?)`);
    // A named moment in the scene's own timeline, as in capture-thumbnails: art direction, not a retry.
    await page.waitForTimeout(settle);
    await page.addStyleTag({ content: '.example-source { display: none !important; }' });
    await page.screenshot({ path: resolve(OUT, `${slug}.png`) });
    console.info(`${problems.length === 0 ? 'ok  ' : 'FAIL'} ${slug}  ${resolve(OUT, `${slug}.png`)}`);
    for (const problem of problems) console.info(`       ${problem}`);
    if (problems.length > 0) failed += 1;
    await context.close();
  }
} finally {
  await browser.close();
}
if (failed > 0) process.exit(1);
