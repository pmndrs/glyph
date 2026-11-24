/* @workflow {
  "name": "site:verify-pages",
  "summary": "Open every docs page that embeds scenes, drive each proxy live, and report what each page fetched.",
  "requirements": "A built site/dist and a GPU-enabled Chromium; pass an output directory, then optional page paths such as text/styling.",
  "writes": "Screenshots, page-weight.json and page-weight.md under site/.cache/verify-pages or the given directory"
} */

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import { gpuCounters, instrument, launch, serve, SITE, watch } from './browser.mts';

/**
 * Every docs page that declares an explainer root, in a GPU-enabled Chromium:
 *
 * - each proxy on the page goes live when scrolled into view;
 * - the page fetched the section tables its root names and no other, and only scenes it embeds;
 * - one GPU device served the page;
 * - nothing was logged as an error and no request failed.
 *
 * It also records what each page transferred, split into the docs shell, the explainer runtime (the renderer,
 * the engine and the element), the section tables, the scenes, fonts and posters, so a section's cost is a
 * number. Sizes are response bodies as served, uncompressed.
 */
const [outArgument, ...only] = process.argv.slice(2).filter((argument) => argument !== '--');
const OUT = resolve(outArgument ?? resolve(SITE, '.cache/verify-pages'));
const DOCS = resolve(SITE, 'docs');
const PORT = 4392;
const ORIGIN = `http://127.0.0.1:${PORT}`;

interface PageReport {
  readonly page: string;
  readonly sections: readonly string[];
  readonly scenes: readonly string[];
  readonly bytes: Record<'shell' | 'runtime' | 'sections' | 'scenes' | 'fonts' | 'posters' | 'other', number>;
  readonly total: number;
  readonly failures: readonly string[];
}

async function mdxPages(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory() && entry.name !== 'components' && entry.name !== 'assets') {
      found.push(...(await mdxPages(path)));
    } else if (entry.name.endsWith('.mdx')) found.push(path);
  }
  return found.sort();
}

function classify(url: string): keyof PageReport['bytes'] {
  const path = new URL(url).pathname;
  if (/\/assets\/section-[\w-]+\.js$/.test(path)) return 'sections';
  if (/\/assets\/scene-[\w-]+\.js$/.test(path)) return 'scenes';
  if (path.endsWith('.font.glb')) return 'fonts';
  if (path.includes('/thumbnails/') || path.includes('/posters/')) return 'posters';
  if (path.startsWith('/docs/assets/')) return 'runtime';
  if (path.startsWith('/docs/')) return 'shell';
  return 'other';
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(0)}`;

await mkdir(OUT, { recursive: true });
const stop = await serve(PORT);
const browser = await launch();
const reports: PageReport[] = [];
try {
  for (const file of await mdxPages(DOCS)) {
    const source = await readFile(file, 'utf8');
    const root = /<glyph-explainer-root[^>]*data-explainer-page="([^"]+)"/.exec(source);
    if (root === null) continue;
    const route = relative(DOCS, file).replace(/\.mdx$/, '');
    if (only.length > 0 && !only.includes(route)) continue;
    const declared = root[1]!.split(/\s+/).filter(Boolean);

    // A fresh context per page: nothing is cached, so the page's transfer is what a first visit costs.
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
    await instrument(context);
    const page = await context.newPage();
    const failures = watch(page, route);
    const bytes: PageReport['bytes'] = { shell: 0, runtime: 0, sections: 0, scenes: 0, fonts: 0, posters: 0, other: 0 };
    const fetchedSections = new Set<string>();
    const fetchedScenes = new Set<string>();
    const pending: Promise<void>[] = [];
    page.on('response', (response) => {
      const url = response.url();
      const kind = classify(url);
      const section = /\/section-([\w-]+)-[\w-]{8}\.js$/.exec(url);
      if (section !== null) fetchedSections.add(section[1]!);
      const scene = /\/scene-([\w-]+)-[\w-]{8}\.js$/.exec(url);
      if (scene !== null) fetchedScenes.add(scene[1]!);
      pending.push(
        response
          .body()
          .then((body) => void (bytes[kind] += body.byteLength))
          .catch(() => undefined), // a redirect or an aborted prefetch has no body
      );
    });

    await page.goto(`${ORIGIN}/docs/${route}`, { waitUntil: 'load' });
    await page.waitForFunction(() => customElements.get('glyph-proxy') !== undefined);
    const scenes = await page
      .locator('glyph-proxy')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-scene') ?? ''));
    for (let index = 0; index < scenes.length; index += 1) {
      const proxy = page.locator('glyph-proxy').nth(index);
      await proxy.evaluate((node) => node.scrollIntoView({ block: 'center' }));
      const live = await proxy
        .evaluate(
          (node, timeout) =>
            new Promise<boolean>((done) => {
              const started = performance.now();
              const poll = () => {
                if (node.getAttribute('data-glyph-state') === 'live') done(true);
                else if (performance.now() - started > timeout) done(false);
                else requestAnimationFrame(poll);
              };
              poll();
            }),
          30_000,
        )
        .catch(() => false);
      if (!live) failures.push(`${route}: scene "${scenes[index]}" did not go live`);
      await page.screenshot({ path: resolve(OUT, `${route.replaceAll('/', '--')}--${index}-${scenes[index]}.png`) });
    }
    await Promise.all(pending);

    const counters = await gpuCounters(page);
    if (scenes.length > 0 && counters.devices !== 1) failures.push(`${route}: ${counters.devices} GPU devices`);
    const strays = [...fetchedSections].filter((section) => !declared.includes(section));
    if (strays.length > 0) failures.push(`${route}: fetched sections it does not declare: ${strays.join(', ')}`);
    const unused = declared.filter((section) => !fetchedSections.has(section));
    if (unused.length > 0) failures.push(`${route}: declares sections it never fetched: ${unused.join(', ')}`);
    const foreign = [...fetchedScenes].filter((scene) => !scenes.includes(scene));
    if (foreign.length > 0) failures.push(`${route}: fetched scenes it does not embed: ${foreign.join(', ')}`);

    const total = Object.values(bytes).reduce((sum, value) => sum + value, 0);
    reports.push({ page: route, sections: declared, scenes, bytes, total, failures: [...failures] });
    console.info(
      `${failures.length === 0 ? 'ok  ' : 'FAIL'} ${route}  [${declared.join(' ')}]  ${scenes.length} scenes  ${kb(total)} KB`,
    );
    for (const failure of failures) console.info(`       ${failure}`);
    await context.close();
  }
} finally {
  await browser.close();
  stop();
}

const table = [
  '| Page | Sections | Scenes | Shell | Runtime | Section tables | Scenes | Fonts | Posters | Total |',
  '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...reports.map(
    (report) =>
      `| \`${report.page}\` | ${report.sections.join(', ')} | ${report.scenes.length} | ${kb(report.bytes.shell)} | ${kb(report.bytes.runtime)} | ${kb(report.bytes.sections)} | ${kb(report.bytes.scenes)} | ${kb(report.bytes.fonts)} | ${kb(report.bytes.posters)} | ${kb(report.total)} |`,
  ),
].join('\n');
await writeFile(resolve(OUT, 'page-weight.json'), `${JSON.stringify(reports, null, 2)}\n`);
await writeFile(
  resolve(OUT, 'page-weight.md'),
  `Transferred on a first visit with every proxy driven live, in KB, uncompressed.\n\n${table}\n`,
);
console.info(`\n${table}\n\nWritten to ${OUT}`);
const failed = reports.filter((report) => report.failures.length > 0);
if (failed.length > 0) {
  console.error(`\n${failed.length} page(s) failed.`);
  process.exit(1);
}
