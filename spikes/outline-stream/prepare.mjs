#!/usr/bin/env node
// Builds the outline stream spike assets into spikes/outline-stream/out/.
//
// Usage: node spikes/outline-stream/prepare.mjs [--no-main] [font ...]
//
// For each font (default: the Inter, Source Serif 4 and Dancing Script fixtures):
//   1. the spike encoder (variants A and B) writes out/<name>.spike.{bin,json} for the full glyph set and
//      out/<name>-latin.spike.{bin,json} for U+0020-007E,U+00A0-00FF;
//   2. today's CLI bakes the optional "main" variant, out/<name>.glb plus out/<name>.slug.glb;
// then out/index.json lists every asset. Node 22, no dependencies.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, readSync, closeSync, writeFileSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';

const here = import.meta.dirname;
const root = resolve(here, '../..');
const out = join(here, 'out');
const encoderDir = join(here, 'encoder');
const encoder = join(encoderDir, 'target/release/encoder');
const cli = join(root, 'packages/glyph/dist/node/cli.js');
const LATIN = 'U+0020-007E,U+00A0-00FF';
const DEFAULT_FONTS = [
  'benches/fixtures/fonts/inter-v4.1/Inter-Regular.ttf',
  'benches/fixtures/fonts/source-serif-4.005/SourceSerif4-Regular.ttf',
  'benches/fixtures/fonts/dancing-script-3.000/DancingScript-Regular.otf',
];

const args = process.argv.slice(2);
const withMain = !args.includes('--no-main');
const fonts = args.filter((arg) => !arg.startsWith('--'));
const sources = (fonts.length > 0 ? fonts : DEFAULT_FONTS).map((font) => resolve(root, font));

function fail(message) {
  console.error(`prepare: ${message}`);
  process.exit(1);
}

function isLfsPointer(path) {
  const fd = openSync(path, 'r');
  try {
    const head = Buffer.alloc(64);
    const read = readSync(fd, head, 0, head.length, 0);
    return head.subarray(0, read).toString('latin1').startsWith('version https://git-lfs');
  } finally {
    closeSync(fd);
  }
}

function run(command, commandArgs, options = {}) {
  console.log(`$ ${[command, ...commandArgs].map((a) => relative(root, a) || a).join(' ')}`);
  execFileSync(command, commandArgs, { stdio: 'inherit', ...options });
}

for (const source of sources) {
  if (!existsSync(source)) fail(`${relative(root, source)} does not exist`);
  if (isLfsPointer(source)) fail(`${relative(root, source)} is a Git LFS pointer; run \`git lfs pull\` first`);
}
if (withMain && !existsSync(cli)) {
  fail('packages/glyph/dist is missing; build the package first (`mise exec -- pnpm build`), or pass --no-main');
}

run('cargo', ['+1.97.1', 'build', '--release', '--quiet'], { cwd: encoderDir });
mkdirSync(out, { recursive: true });

const assets = [];
for (const source of sources) {
  const name = basename(source, extname(source)).toLowerCase();
  const entry = { name, source: relative(root, source), variants: {} };
  for (const [key, prefix, extra] of [
    ['full', name, ['--triplet']],
    ['latin', `${name}-latin`, ['--unicodes', LATIN]],
  ]) {
    run(encoder, [source, join(out, prefix), ...extra]);
    const meta = JSON.parse(readFileSync(join(out, `${prefix}.spike.json`), 'utf8'));
    entry.outlineFormat = meta.outlineFormat;
    entry.unitsPerEm = meta.unitsPerEm;
    entry.variants[key] = {
      json: `${prefix}.spike.json`,
      bin: `${prefix}.spike.bin`,
      glyphCount: meta.glyphCount,
      curves: meta.stats.curves,
      verify: meta.verify.ok,
    };
  }
  if (withMain) {
    run(process.execPath, [
      cli,
      'bake',
      '--input',
      source,
      '--output',
      join(out, `${name}.glb`),
      '--slug',
      '--split',
      '--force',
      '--yes',
    ]);
    if (!existsSync(join(out, `${name}.slug.glb`))) fail(`the CLI did not write out/${name}.slug.glb`);
    entry.main = { core: `${name}.glb`, slug: `${name}.slug.glb` };
  }
  assets.push(entry);
}

writeFileSync(
  join(out, 'index.json'),
  `${JSON.stringify({ format: 'outline-stream-spike-v0', fonts: assets }, null, 2)}\n`,
);
console.log(`wrote ${relative(root, join(out, 'index.json'))} (${assets.length} fonts)`);
