import { spawnSync } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Runs the pinned `@pmndrs/docs` generator with one correction applied to it.
 *
 * As published, 4.1.2 hands every page's compiled body to its client components (the navigation, the search and a
 * context), so each page's HTML and its prefetch payload contain every other page. At 96 pages that is 9 MB of HTML
 * per page. The components read titles, URLs and tables of contents only, so the layout is edited to keep the bodies
 * on the server. The edit is exact-match on the pinned version and fails loudly if the source no longer matches;
 * remove it when the generator stops serializing bodies.
 *
 *   node scripts/docs-generator.mts build docs dist/docs --format website …
 */
const VERSION = '4.1.2';
const site = resolve(fileURLToPath(new URL('..', import.meta.url)));
const cache = join(site, '.npx-cache');
const env = { ...process.env, npm_config_cache: cache };

const ANCHOR = '  const { docs, doc } = await getData(...slug)\n';
const REPLACEMENT = `  const { docs: compiledDocs, doc: compiledDoc } = await getData(...slug)
  // glyph-site: client components are serialized with their props; keep compiled page bodies on the server.
  const docs = compiledDocs.map((entry) => ({ ...entry, content: null }))
  const doc = { ...compiledDoc, content: null }
`;

function npx(args: readonly string[]): number {
  return spawnSync('npx', ['-y', `@pmndrs/docs@${VERSION}`, ...args], { cwd: site, env, stdio: 'inherit' }).status ?? 1;
}

async function installedLayouts(): Promise<string[]> {
  const roots = await readdir(join(cache, '_npx'), { withFileTypes: true }).catch(() => []);
  const found: string[] = [];
  for (const root of roots) {
    if (!root.isDirectory()) continue;
    const layout = join(cache, '_npx', root.name, 'node_modules/@pmndrs/docs/src/app/[...slug]/layout.tsx');
    const manifest = join(cache, '_npx', root.name, 'node_modules/@pmndrs/docs/package.json');
    const version = await readFile(manifest, 'utf8').then(
      (text) => (JSON.parse(text) as { version: string }).version,
      () => undefined,
    );
    if (version === VERSION) found.push(layout);
  }
  return found;
}

// Installing is a side effect of running; `--version` installs without building anything.
if ((await installedLayouts()).length === 0 && npx(['--version']) !== 0) process.exit(1);
const layouts = await installedLayouts();
if (layouts.length === 0) throw new Error(`@pmndrs/docs@${VERSION} was not installed under ${cache}`);
for (const layout of layouts) {
  const source = await readFile(layout, 'utf8');
  if (source.includes(REPLACEMENT)) continue;
  if (!source.includes(ANCHOR)) {
    throw new Error(`${layout} no longer matches @pmndrs/docs@${VERSION}; review scripts/docs-generator.mts`);
  }
  await writeFile(layout, source.replace(ANCHOR, REPLACEMENT));
}

process.exit(npx(process.argv.slice(2)));
