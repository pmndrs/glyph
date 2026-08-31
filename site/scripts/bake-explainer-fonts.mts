import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

import { bitmapBaker } from '@pmndrs/glyph/bakers/bitmap';
import { msdfBaker } from '@pmndrs/glyph/bakers/msdf';
import { slugBaker } from '@pmndrs/glyph/bakers/slug';
import { bakeFont, inspectFont } from '@pmndrs/glyph/bake';

import iconManifest from '../docs/assets/fonts/font-awesome-icons.json' with { type: 'json' };

const site = resolve(dirname(new URL(import.meta.url).pathname), '..');
const fonts = resolve(site, 'docs/assets/fonts');
const benchmarkFonts = resolve(site, '../apps/benchmarks/fixtures/fonts');

await mkdir(fonts, { recursive: true });

const fontAwesomeSource = resolve(benchmarkFonts, 'font-awesome-free-6.7.2');
const fontAwesomeInput = resolve(fonts, 'font-awesome-solid-900.ttf');
await copyFile(resolve(fontAwesomeSource, 'fa-solid-900.ttf'), fontAwesomeInput);
await copyFile(resolve(fontAwesomeSource, 'LICENSE.txt'), resolve(fonts, 'font-awesome-LICENSE.txt'));

const glyphs = (values: readonly number[]) => values.map((point) => ({ start: point, end: point }));
const latin = [
  { start: 0x20, end: 0x7e },
  { start: 0xa0, end: 0xff },
];
const alphaNumericAscii = [
  { start: 0x20, end: 0x20 },
  { start: 0x30, end: 0x39 },
  { start: 0x41, end: 0x5a },
  { start: 0x61, end: 0x7a },
];
const iconInspection = await inspectFont({ input: fontAwesomeInput, fontFaceIndex: 0 });
const iconCodePoints = Object.fromEntries(
  iconManifest.names.map((name) => {
    const matches = iconInspection.glyphs.filter(
      (glyph) => glyph.name === name && glyph.codePoint >= 0xe000 && glyph.codePoint <= 0xf8ff,
    );
    if (matches.length !== 1) {
      throw new Error(`Expected one private-use Font Awesome glyph named ${name}, found ${matches.length}`);
    }
    return [name, matches[0]!.codePoint];
  }),
);
const iconPoints = glyphs(Object.values(iconCodePoints));

await writeFile(
  resolve(fonts, 'font-awesome-icons.json'),
  `${JSON.stringify({ schemaVersion: 0, names: iconManifest.names, icons: iconCodePoints }, null, 2)}\n`,
);

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
    id: 'geist-slug-alphanumeric',
    input: resolve(fonts, 'geist-regular.ttf'),
    rasters: [{ baker: slugBaker, packaging: { artifact: 'embedded', pages: 'embedded' }, options: undefined }],
    unicodeRanges: alphaNumericAscii,
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
    input: fontAwesomeInput,
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
  "writes": "site/docs/assets/fonts/*.font.glb, font-awesome-icons.json, and explainer-fonts.json; copies Font Awesome and M PLUS sources with licenses."
}
*/
