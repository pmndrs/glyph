/* @workflow {
  "name": "site:bake-editing-fonts",
  "summary": "Bake the Latin and Arabic subset of Amiri that the bidirectional caret example draws.",
  "requirements": "A built @pmndrs/glyph and the Amiri source under benches/fixtures/fonts.",
  "writes": "site/docs/assets/fonts/editing/amiri-bidi.font.glb and amiri-OFL.txt"
} */

import { copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { bakeFont } from '@pmndrs/glyph/bake';
import { slugBaker } from '@pmndrs/glyph/bakers/slug';

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(site, '../benches/fixtures/fonts/amiri-1.002');
const out = resolve(site, 'docs/assets/fonts/editing');

/** Every character the bidirectional caret scene draws; its captions use the shared Inter. */
const TEXT = 'abc سلام def';

await mkdir(out, { recursive: true });
await copyFile(resolve(source, 'OFL.txt'), resolve(out, 'amiri-OFL.txt'));

const output = resolve(out, 'amiri-bidi.font.glb');
await bakeFont({
  input: resolve(source, 'Amiri-Regular.ttf'),
  output,
  font: { fontFaceIndex: 0 },
  unicodeRanges: [...new Set(TEXT)]
    .map((character) => character.codePointAt(0)!)
    .sort((left, right) => left - right)
    .map((codePoint) => ({ start: codePoint, end: codePoint })),
  // Slug draws the outlines themselves, so the large calligraphic shapes stay sharp at a small file size.
  rasters: [{ baker: slugBaker, packaging: { artifact: 'embedded' }, options: undefined }],
});
console.log(`${relative(site, output)}  ${(await stat(output)).size} bytes`);
