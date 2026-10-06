#!/usr/bin/env node
// CPU outline decode: #235's shipped outlineAt() path against this design's triplet decoder plus GPU point-layout
// emitter, over every glyph of one font (default Inter).
//
// Usage: node spikes/outline-stream/cpu-bench.mjs [--font <path>] [--reps <n>]
//
// #235:   the font baked with `glyph bake --outlines` by the repo CLI; per glyph, the dist text shaper's
//         glyphOutline export over the baked outline view, then the dist readGlyphOutline() reader. Also the public
//         outlineAt() over a text that shapes every mapped code point.
// New:    the encoder's triplet planes (composites expanded) decoded by cpu/ (Wasm, scalar), then emit_points (the
//         i16 GPU point layout) for the whole font; and, for an outlineAt-shaped comparison, emit_outline plus the
//         same dist reader per glyph.
// Prints a table and JSON; writes out/cpu/cpu-bench.json. Node 22, no dependencies.
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const here = import.meta.dirname;
const root = resolve(here, '../..');
const out = join(here, 'out', 'cpu');
const dist = join(root, 'packages/glyph/dist');
const argv = process.argv.slice(2);
const option = (name, fallback) => {
  const index = argv.indexOf(name);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : fallback;
};
const fontPath = resolve(root, option('--font', 'benches/fixtures/fonts/inter-v4.1/Inter-Regular.ttf'));
const reps = Number(option('--reps', '15'));
const name = basename(fontPath, extname(fontPath)).toLowerCase();

function fail(message) {
  console.error(`cpu-bench: ${message}`);
  process.exit(1);
}
function run(command, args, cwd = root) {
  console.error(`$ ${[command, ...args].map((a) => relative(root, a) || a).join(' ')}`);
  execFileSync(command, args, { cwd, stdio: ['ignore', 'ignore', 'inherit'] });
}
function isLfsPointer(path) {
  const fd = openSync(path, 'r');
  try {
    const head = Buffer.alloc(64);
    return head
      .subarray(0, readSync(fd, head, 0, 64, 0))
      .toString('latin1')
      .startsWith('version https://git-lfs');
  } finally {
    closeSync(fd);
  }
}

if (!existsSync(fontPath)) fail(`${relative(root, fontPath)} does not exist`);
if (isLfsPointer(fontPath)) fail(`${relative(root, fontPath)} is a Git LFS pointer; run \`git lfs pull\` first`);
if (!existsSync(join(dist, 'node/cli.js'))) fail('packages/glyph/dist is missing; build the package first');
mkdirSync(out, { recursive: true });

// ---------------------------------------------------------------- build and bake
run('cargo', ['+1.97.1', 'build', '--release', '--quiet'], join(here, 'encoder'));
run('cargo', ['+1.97.1', 'build', '--release', '--quiet', '--target', 'wasm32-unknown-unknown'], join(here, 'cpu'));
const prefix = join(out, name);
run(join(here, 'encoder/target/release/encoder'), [fontPath, prefix, '--triplet']);
const baked = join(out, `${name}-outlines.font.glb`);
run(process.execPath, [
  join(dist, 'node/cli.js'),
  'bake',
  '--input',
  fontPath,
  '--output',
  baked,
  '--outlines',
  '--bitmap',
  '16',
  '--force',
  '--yes',
]);

const spike = JSON.parse(readFileSync(`${prefix}.spike.json`, 'utf8'));
const tmeta = JSON.parse(readFileSync(`${prefix}.triplet.json`, 'utf8'));
const tbin = new Uint8Array(readFileSync(`${prefix}.triplet.bin`));
const upm = spike.unitsPerEm;
const G = tmeta.glyphs;
const C = tmeta.contours;
const P = tmeta.points;

// ---------------------------------------------------------------- timing
function median(fn) {
  fn();
  fn();
  const samples = [];
  for (let i = 0; i < reps; i++) {
    const start = process.hrtime.bigint();
    fn();
    samples.push(Number(process.hrtime.bigint() - start) / 1e6);
  }
  samples.sort((a, b) => a - b);
  return samples[samples.length >> 1];
}
const rows = [];
const row = (path, label, glyphs, ms) =>
  rows.push({ path, label, glyphs, msPerFont: ms, usPerGlyph: (ms * 1000) / glyphs });

// ---------------------------------------------------------------- new path: cpu/ Wasm
const cpu = new WebAssembly.Instance(
  new WebAssembly.Module(readFileSync(join(here, 'cpu/target/wasm32-unknown-unknown/release/outline_stream_cpu.wasm'))),
  {},
).exports;
let top = cpu.memory.buffer.byteLength;
const alloc = (bytes) => {
  const at = (top + 15) & ~15;
  top = at + bytes;
  const grow = top - cpu.memory.buffer.byteLength;
  if (grow > 0) cpu.memory.grow(Math.ceil(grow / 65536));
  return at;
};
const tbase = alloc(tbin.length);
new Uint8Array(cpu.memory.buffer, tbase, tbin.length).set(tbin);
const plane = (key) => tbase + tmeta.planes[key].offset;
const gp = alloc(4 * G);
const gc = alloc(4 * G);
const cs = alloc(2 * C);
const X = alloc(2 * P);
const Y = alloc(2 * P);
const T = alloc(P);
const glyphBase = alloc(4 * (G + 1));
const words = alloc(4 * (P + 2 * C));
const outline = alloc(64 + 4 * C + 8 * (3 * P + 4 * C));
const decode = () =>
  cpu.decode_triplet(plane('hdr'), G, plane('cn'), plane('flags'), plane('data'), gp, gc, cs, X, Y, T);
const layout = () => cpu.emit_points(X, Y, T, gc, cs, G, glyphBase, words);

// Correctness: decoded points against the encoder's checksums, emitted layout against the encoder's pointsI16.
const checks = {};
{
  if (decode() !== P) fail('decode_triplet point count mismatch');
  const x = new Int16Array(cpu.memory.buffer, X, P);
  const y = new Int16Array(cpu.memory.buffer, Y, P);
  const t = new Uint8Array(cpu.memory.buffer, T, P);
  let sx = 0;
  let sy = 0;
  let on = 0;
  for (let i = 0; i < P; i++) {
    sx += x[i];
    sy += y[i];
    on += t[i] === 0 ? 1 : 0;
  }
  checks.decodeChecksum = sx === tmeta.sumX && sy === tmeta.sumY && on === tmeta.onCurve;
  const n = layout();
  const spikeBin = readFileSync(`${prefix}.spike.bin`);
  const section = spike.sections.pointsI16;
  const expected = new Uint8Array(spikeBin.buffer, spikeBin.byteOffset + section.offset, 4 * n);
  const actual = new Uint8Array(cpu.memory.buffer, words, 4 * n);
  checks.layoutWords = n === spike.stats.points && Buffer.compare(Buffer.from(expected), Buffer.from(actual)) === 0;
  const records = new DataView(spikeBin.buffer, spikeBin.byteOffset + spike.sections.glyphs.offset, 32 * G);
  const bases = new Uint32Array(cpu.memory.buffer, glyphBase, G + 1);
  let basesMatch = true;
  for (let g = 0; g < G; g++) if (records.getUint32(32 * g + 4, true) !== bases[g]) basesMatch = false;
  checks.glyphBase = basesMatch;
  if (!checks.decodeChecksum || !checks.layoutWords || !checks.glyphBase)
    fail(`new path disagrees with the encoder: ${JSON.stringify(checks)}`);
}
const glyphPoints = new Uint32Array(cpu.memory.buffer, gp, G).slice();
const glyphContours = new Uint32Array(cpu.memory.buffer, gc, G).slice();
const pointStart = new Uint32Array(G + 1);
const contourStart = new Uint32Array(G + 1);
for (let g = 0; g < G; g++) {
  pointStart[g + 1] = pointStart[g] + glyphPoints[g];
  contourStart[g + 1] = contourStart[g] + glyphContours[g];
}

row('new', 'triplet decode, whole font', G, median(decode));
row('new', 'point-layout emit, whole font', G, median(layout));
row(
  'new',
  'decode + point layout (GPU-ready)',
  G,
  median(() => (decode(), layout())),
);

const { readGlyphOutline } = await import(pathToFileURL(join(dist, 'glyph-outline.js')).href);
const pen = { x: 0, y: 0, fontSize: 16 };
const emitOutline = (g) =>
  cpu.emit_outline(
    X + 2 * pointStart[g],
    Y + 2 * pointStart[g],
    T + pointStart[g],
    cs + 2 * contourStart[g],
    glyphContours[g],
    outline,
  );
row(
  'new',
  'outlineAt-equivalent: emit_outline + readGlyphOutline',
  G,
  median(() => {
    for (let g = 0; g < G; g++) {
      if (glyphContours[g] === 0) continue;
      readGlyphOutline(new Uint8Array(cpu.memory.buffer, outline, emitOutline(g)), upm, pen);
    }
  }),
);

// ---------------------------------------------------------------- #235: dist shaper over the baked outline view
const { readRuntimeFontArtifact } = await import(pathToFileURL(join(dist, 'internal/font-artifact-reader.js')).href);
const artifact = readRuntimeFontArtifact(new Uint8Array(readFileSync(baked)));
if (artifact.glyphOutlines === undefined) fail('the --outlines bake has no outline view');
const shaper = new WebAssembly.Instance(new WebAssembly.Module(readFileSync(join(dist, 'text-shaper.wasm'))), {})
  .exports;
const sfntLength = artifact.glyphOutlines.length;
const sfnt = shaper.pmndrs_glyph_shaper_alloc(sfntLength);
new Uint8Array(shaper.memory.buffer, sfnt, sfntLength).set(artifact.glyphOutlines);
const glyphIds = tmeta.glyphIds;
const shipped = (g) => shaper.pmndrs_glyph_shaper_glyph_outline(sfnt, sfntLength, glyphIds[g]);
const shippedBytes = () =>
  new Uint8Array(
    shaper.memory.buffer,
    shaper.pmndrs_glyph_shaper_glyph_outline_ptr(),
    shaper.pmndrs_glyph_shaper_glyph_outline_len(),
  );
let failed = 0;
for (let g = 0; g < G; g++) if (shipped(g) !== 0) failed++;
row(
  '#235',
  `shaper glyphOutline (Wasm decode only${failed ? `, ${failed} failed` : ''})`,
  G,
  median(() => {
    for (let g = 0; g < G; g++) shipped(g);
  }),
);
row(
  '#235',
  'shaper glyphOutline + readGlyphOutline',
  G,
  median(() => {
    for (let g = 0; g < G; g++) if (shipped(g) === 0) readGlyphOutline(shippedBytes(), upm, pen);
  }),
);

// Same curves? The new emitter's 2n+1 output against the shipped one, byte for byte.
let identical = 0;
let outlined = 0;
for (let g = 0; g < G; g++) {
  if (glyphContours[g] === 0) continue;
  outlined++;
  const mine = new Uint8Array(cpu.memory.buffer, outline, emitOutline(g));
  if (shipped(g) === 0 && Buffer.compare(Buffer.from(mine), Buffer.from(shippedBytes())) === 0) identical++;
}
checks.outlineBytesIdenticalToShipped = `${identical}/${outlined}`;

// ---------------------------------------------------------------- #235: public outlineAt()
try {
  const { bitmap, glyph } = await import(pathToFileURL(join(dist, 'index.js')).href);
  const { ThreeConfig } = await import(pathToFileURL(join(dist, 'three.js')).href);
  const { loadFont } = await import(pathToFileURL(join(dist, 'loader.js')).href);
  await glyph.init();
  const handle = glyph.handle('outline-stream:cpu-bench', ThreeConfig);
  const font = await loadFont({ baked: { bytes: readFileSync(baked), ownership: 'copy' } }, bitmap({ strikes: [16] }));
  const text = spike.codepoints
    .filter((cp) => cp > 0x20 && !(cp >= 0x7f && cp < 0xa0))
    .map((cp) => String.fromCodePoint(cp))
    .join('');
  const shaped = handle.createText({ font, text });
  const count = shaped.withGlyphs((glyphs) => glyphs.glyphCount);
  const ms = median(() =>
    shaped.withGlyphs((glyphs) => {
      for (let i = 0; i < glyphs.glyphCount; i++) glyphs.outlineAt(i);
    }),
  );
  row('#235', 'public outlineAt() over every mapped code point', count, ms);
  shaped.dispose();
  font.dispose();
  handle.dispose();
} catch (error) {
  console.error(`cpu-bench: public outlineAt() row skipped: ${error.message}`);
}

// ---------------------------------------------------------------- report
const result = {
  font: spike.font,
  outlineFormat: spike.outlineFormat,
  glyphs: G,
  points: P,
  contours: C,
  layoutPoints: spike.stats.points,
  tripletBytes: tbin.length,
  bakedOutlineViewBytes: sfntLength,
  reps,
  node: process.version,
  checks,
  rows,
};
const fmt = (v, digits) => v.toFixed(digits).padStart(10);
console.log(`\n${spike.font}: ${G} glyphs, ${P} points, median of ${reps} runs`);
console.log(
  `${'path'.padEnd(6)}${'measure'.padEnd(56)}${'glyphs'.padStart(7)}${'ms/font'.padStart(10)}${'us/glyph'.padStart(10)}`,
);
for (const r of rows)
  console.log(
    `${r.path.padEnd(6)}${r.label.padEnd(56)}${String(r.glyphs).padStart(7)}${fmt(r.msPerFont, 3)}${fmt(r.usPerGlyph, 3)}`,
  );
console.log(`checks: ${JSON.stringify(checks)}\n`);
writeFileSync(join(out, 'cpu-bench.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result));
