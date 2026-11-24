/* @workflow {
  "name": "site:bake-inspect-fonts",
  "summary": "Bake the Inter subset with glyph outlines that the outline inspection example reads.",
  "requirements": "A built @pmndrs/glyph and the Inter source under benches/fixtures/fonts.",
  "writes": "site/docs/assets/fonts/inspect/inter-outlines.font.glb and inter-LICENSE.txt"
} */

import { copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { bakeFont } from '@pmndrs/glyph/bake';
import { msdfBaker } from '@pmndrs/glyph/bakers/msdf';

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(site, '../benches/fixtures/fonts/inter-v4.1');
const out = resolve(site, 'docs/assets/fonts/inspect');

/** Every character the outline scene draws; its captions use the shared Inter. */
const TEXT = 'glyph';

await mkdir(out, { recursive: true });
await copyFile(resolve(source, 'LICENSE.txt'), resolve(out, 'inter-LICENSE.txt'));

const output = resolve(out, 'inter-outlines.font.glb');
await bakeFont({
  input: resolve(source, 'Inter-Regular.ttf'),
  output,
  // `outlines: true` is the Node API's form of `glyph bake --outlines`: outlineAt() needs it.
  font: { fontFaceIndex: 0, outlines: true },
  unicodeRanges: [...new Set(TEXT)]
    .map((character) => character.codePointAt(0)!)
    .sort((left, right) => left - right)
    .map((codePoint) => ({ start: codePoint, end: codePoint })),
  // Must match OUTLINE_MSDF in the scene that loads this font.
  rasters: [{ baker: msdfBaker, packaging: { artifact: 'embedded' }, options: { emSize: 32, pixelRange: 6 } }],
});
console.log(`${relative(site, output)}  ${(await stat(output)).size} bytes`);
