/* @workflow { "name": "glyph:mtsdf-quality:inspect", "summary": "Compare production MTSDF reconstruction with native correction and coloring variants; emit measurements and a visual report. Options: --font <fixture path> --chars <text>.", "requirements": "Stable Rust, authenticated font fixtures, CMake, a C++ compiler, tar, and network access for the pinned msdfgen oracle.", "writes": "Ignored packages/glyph/.cache/mtsdf-quality-inspect reports and pinned-tool cache.", "args": [] } */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const packageDirectory = fileURLToPath(new URL('..', import.meta.url));
const workspaceDirectory = resolve(packageDirectory, '../..');
const { values } = parseArgs({ options: { font: { type: 'string' }, chars: { type: 'string' } } });
const baseline = JSON.parse(
  await readFile(resolve(packageDirectory, 'rust/mtsdf-admission/evidence/reconstruction-quality-v0.json'), 'utf8'),
);
const corpus = values.font
  ? [{ font: values.font, characters: values.chars ?? 'IHnoMA48&' }]
  : [
      { font: 'inter-v4.1/Inter-Regular.ttf', characters: values.chars ?? 'IHnoMA48&' },
      { font: 'dancing-script-3.000/DancingScript-Regular.otf', characters: values.chars ?? 'wg' },
    ];
const outputDirectory = resolve(packageDirectory, '.cache/mtsdf-quality-inspect');
await mkdir(outputDirectory, { recursive: true });
// The provisioner prints the executable after any first-build CMake output.
const executable = capture(process.execPath, [resolve(packageDirectory, 'scripts/provision-msdfgen-oracle.mjs')])
  .trim()
  .split('\n')
  .at(-1);
const variants = [
  { id: 'native-default', flags: [] },
  { id: 'native-mixed', flags: ['-noscanline', '-errorcorrection', 'auto-mixed'] },
  { id: 'native-fast', flags: ['-noscanline', '-errorcorrection', 'auto-fast'] },
  { id: 'native-distance', flags: ['-coloringstrategy', 'distance'] },
  { id: 'native-inktrap', flags: ['-coloringstrategy', 'inktrap'] },
];
const { emSize, pixelRange, zoom } = baseline.framing;
const report = {
  revision: capture('git', ['rev-parse', 'HEAD']).trim(),
  framing: baseline.framing,
  oracle: capture(executable, ['-version']).trim(),
  variants,
  cases: [],
};
const sections = [];

for (const { font, characters } of corpus) {
  const fontPath = resolve(workspaceDirectory, 'benches/fixtures/fonts', font);
  const fontSha256 = createHash('sha256')
    .update(await readFile(fontPath))
    .digest('hex');
  const fontDirectory = resolve(outputDirectory, fontSha256);
  const measureArguments = [
    fontPath,
    '--em-size',
    String(emSize),
    '--pixel-range',
    String(pixelRange),
    '--zoom',
    String(zoom),
    '--chars',
    characters,
  ];
  const ours = measure([...measureArguments, '--dump', resolve(fontDirectory, 'glyph')]);
  const shapes = runMeasure([...measureArguments, '--emit-shape'])
    .trim()
    .split('\n');
  const measurements = new Map([['glyph', ours]]);
  for (const { id, flags } of variants) {
    const directory = resolve(fontDirectory, id);
    await mkdir(directory, { recursive: true });
    for (const row of shapes) {
      const [codePoint, width, height, scale, translateX, translateY, range, shape] = row.split('\t');
      capture(executable, [
        'mtsdf',
        '-defineshape',
        shape,
        '-dimensions',
        width,
        height,
        '-scale',
        scale,
        '-translate',
        translateX,
        translateY,
        '-range',
        range,
        '-format',
        'bin',
        '-yflip',
        '-o',
        resolve(directory, `${glyphName(Number(codePoint))}.rgba`),
        ...flags,
      ]);
    }
    measurements.set(id, measure([...measureArguments, '--external-field', directory, '--dump', directory]));
  }
  for (let index = 0; index < ours.length; index += 1) {
    const character = ours[index].character;
    const results = Object.fromEntries([...measurements].map(([id, rows]) => [id, rows[index]]));
    report.cases.push({ font, fontSha256, character, results });
    process.stdout.write(
      `${font} ${character}: ${Object.entries(results)
        .map(([id, row]) => `${id}=${row.samplesOverQuarter}`)
        .join(', ')}\n`,
    );
    const figures = [];
    for (const id of ['glyph', 'native-default', 'native-mixed', 'native-fast']) {
      const ppm = await readFile(resolve(fontDirectory, id, `${glyphName(character.codePointAt(0))}.ppm`));
      figures.push(`<figure><figcaption>${id}: ${results[id].samplesOverQuarter} samples with error &gt; 0.25</figcaption>
        <canvas data-ppm="${gzipSync(ppm).toString('base64')}"></canvas></figure>`);
    }
    sections.push(`<details ${character === '8' && font.startsWith('inter-') ? 'open' : ''}>
      <summary>${escapeHtml(font)} · ${escapeHtml(character)}</summary>
      <p>Each row: independent outline reference · reconstructed coverage · absolute error (bright = larger).</p>
      ${figures.join('\n')}</details>`);
  }
}
await writeFile(resolve(outputDirectory, 'measurements.json'), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(
  resolve(outputDirectory, 'index.html'),
  `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>MTSDF reconstruction inspection</title>
<style>
body{background:#17191d;color:#eee;font:16px system-ui;margin:32px;max-width:1400px}
h1{font-size:28px}p{color:#bbc1cb}details{border-top:1px solid #444;padding:16px 0}
summary{cursor:pointer;font-weight:600}figure{margin:24px 0}figcaption{margin-bottom:8px}
canvas{display:block;max-width:100%;height:auto;image-rendering:pixelated}
</style>
<h1>MTSDF reconstruction inspection</h1>
<p>Revision ${report.revision.slice(0, 12)} · ${emSize} px/em · range ${pixelRange} · ${zoom}× reconstruction</p>
<p>Production Rust kernel and pinned msdfgen 1.13 receive identical outlines and framing.
Native mixed and fast disable scanline sign correction to isolate geometric distance checks: mixed enables them,
fast disables them. The core-only CLI default uses scanline sign correction and disables distance checks.
Images use CPU bilinear reconstruction,
not a GPU screenshot. This report displays that reconstruction in Chrome.</p>
${sections.join('\n')}
<script type="module">
await Promise.all([...document.querySelectorAll('canvas')].map(async canvas => {
  const compressed = Uint8Array.from(atob(canvas.dataset.ppm), character => character.charCodeAt(0));
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'));
  const ppm = new Uint8Array(await new Response(stream).arrayBuffer());
  let end = 0;
  for (let lines = 0; lines < 3; end += 1) if (ppm[end] === 10) lines += 1;
  const [, dimensions] = new TextDecoder().decode(ppm.subarray(0, end)).split('\\n');
  const [width, height] = dimensions.split(' ').map(Number);
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  const image = context.createImageData(width, height);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    image.data.set(ppm.subarray(end + pixel * 3, end + pixel * 3 + 3), pixel * 4);
    image.data[pixel * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  delete canvas.dataset.ppm;
}));
document.body.dataset.ready = 'true';
</script></html>\n`,
);
process.stdout.write(`Report: ${resolve(outputDirectory, 'index.html')}\n`);

function capture(command, args) {
  return execFileSync(command, args, { cwd: workspaceDirectory, encoding: 'utf8', maxBuffer: 8_000_000 });
}

function runMeasure(args) {
  return capture('cargo', [
    'run',
    '--release',
    '--manifest-path',
    resolve(packageDirectory, 'rust/mtsdf-admission/Cargo.toml'),
    '--bin',
    'measure-mtsdf-quality',
    '--features',
    'full-font-evidence',
    '--locked',
    '--quiet',
    '--',
    ...args,
  ]);
}

function measure(args) {
  const [, ...rows] = runMeasure(args).trim().split('\n');
  return rows.map((row) => {
    const [character, glyph, width, height, mean, maximum, worstX, worstY, overQuarter, overHalf] = row.split('\t');
    return {
      character,
      glyph: Number(glyph),
      width: Number(width),
      height: Number(height),
      meanAbsoluteError: Number(mean),
      maximumAbsoluteError: Number(maximum),
      worstX: Number(worstX),
      worstY: Number(worstY),
      samplesOverQuarter: Number(overQuarter),
      samplesOverHalf: Number(overHalf),
    };
  });
}

function glyphName(codePoint) {
  return `u${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
}

function escapeHtml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
