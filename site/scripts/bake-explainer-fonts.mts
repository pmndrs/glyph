import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

import { bitmapBaker } from '@pmndrs/glyph/bakers/bitmap';
import { msdfBaker } from '@pmndrs/glyph/bakers/msdf';
import { slugBaker } from '@pmndrs/glyph/bakers/slug';
import { bakeFont } from '@pmndrs/glyph/bake';

const site = resolve(dirname(new URL(import.meta.url).pathname), '..');
const fonts = resolve(site, 'docs/assets/fonts');
const benchmarkFonts = resolve(site, '../apps/benchmarks/fixtures/fonts');

await mkdir(fonts, { recursive: true });

const fontAwesomeSource = resolve(benchmarkFonts, 'font-awesome-free-6.7.2');
await copyFile(resolve(fontAwesomeSource, 'fa-solid-900.ttf'), resolve(fonts, 'font-awesome-solid-900.ttf'));
await copyFile(resolve(fontAwesomeSource, 'LICENSE.txt'), resolve(fonts, 'font-awesome-LICENSE.txt'));

const glyphs = (values: readonly number[]) => values.map((point) => ({ start: point, end: point }));
const latin = [
  { start: 0x20, end: 0x7e },
  { start: 0xa0, end: 0xff },
];
const iconPoints = glyphs([0xf011, 0xf044, 0xf135, 0xf1fc, 0xf53f, 0xf0e7]);

const jobs = [
  {
    id: 'lovers-quarrel-slug',
    input: resolve(fonts, 'lovers-quarrel-regular.ttf'),
    rasters: [{ baker: slugBaker, packaging: { artifact: 'embedded', pages: 'embedded' }, options: undefined }],
    unicodeRanges: latin,
  },
  {
    id: 'geist-msdf',
    input: resolve(fonts, 'geist-regular.ttf'),
    rasters: [
      {
        baker: msdfBaker,
        packaging: { artifact: 'embedded', pages: 'embedded' },
        options: { emSize: 32, pixelRange: 6 },
      },
    ],
    unicodeRanges: latin,
  },
  {
    id: 'vt323-bitmap',
    input: resolve(fonts, 'vt323-regular.ttf'),
    rasters: [
      {
        baker: bitmapBaker,
        packaging: { artifact: 'embedded', pages: 'embedded' },
        options: { strikes: [16, 24, 32] },
      },
    ],
    unicodeRanges: latin,
  },
  {
    id: 'font-awesome-icons-msdf',
    input: resolve(fonts, 'font-awesome-solid-900.ttf'),
    rasters: [
      {
        baker: msdfBaker,
        packaging: { artifact: 'embedded', pages: 'embedded' },
        options: { emSize: 32, pixelRange: 6 },
      },
    ],
    unicodeRanges: iconPoints,
  },
] as const;

const generated: Array<{
  id: string;
  source: string;
  license: string;
  output: string;
}> = [];

for (const job of jobs) {
  const output = resolve(fonts, `${job.id}.font.glb`);
  await bakeFont({
    input: job.input,
    output,
    font: { fontFaceIndex: 0 },
    unicodeRanges: job.unicodeRanges,
    rasters: job.rasters,
  });
  generated.push({
    id: job.id,
    source: relative(fonts, job.input),
    license: licenseFor(job.input),
    output: relative(fonts, output),
  });
  console.log(`${job.id} -> ${relative(site, output)}`);
}

const cjkOutput = resolve(fonts, 'mplus1p-japanese.font.glb');
await copyFile(resolve(site, 'landing/assets/chorus-japanese.font.glb'), cjkOutput);
generated.push({
  id: 'mplus1p-japanese',
  source: 'mplus1p-regular.ttf',
  license: 'mplus1p-OFL.txt',
  output: relative(fonts, cjkOutput),
});

await writeFile(
  resolve(fonts, 'explainer-fonts.json'),
  `${JSON.stringify(
    {
      schemaVersion: 0,
      note: 'Generated fonts retain their source font and license beside the baked artifact.',
      fonts: generated,
    },
    null,
    2,
  )}\n`,
);

function licenseFor(input: string) {
  const name = input.split('/').at(-1) ?? '';
  if (name === 'font-awesome-solid-900.ttf') return 'font-awesome-LICENSE.txt';
  if (name === 'lovers-quarrel-regular.ttf') return 'lovers-quarrel-OFL.txt';
  if (name === 'geist-regular.ttf') return 'geist-OFL.txt';
  return 'vt323-OFL.txt';
}

/* @workflow
{
  "name": "site:bake-explainer-fonts",
  "summary": "Bake the getting-started explainer fonts and keep every source license beside its artifact.",
  "requirements": "A built @pmndrs/glyph and the checked-in source fonts under site/docs/assets/fonts.",
  "writes": "site/docs/assets/fonts/*.font.glb and explainer-fonts.json; copies Font Awesome and M PLUS sources with licenses."
}
*/
