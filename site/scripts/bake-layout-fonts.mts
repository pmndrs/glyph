/* @workflow {
  "name": "site:bake-layout-fonts",
  "summary": "Bake the one-glyph Inter subset that supplies the ellipsis for the truncation example.",
  "requirements": "A built @pmndrs/glyph and the Inter source under benches/fixtures/fonts.",
  "writes": "site/docs/assets/fonts/layout/inter-ellipsis.font.glb and inter-LICENSE.txt"
} */

import { copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { bakeFont } from '@pmndrs/glyph/bake';
import { msdfBaker } from '@pmndrs/glyph/bakers/msdf';

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = resolve(site, '../benches/fixtures/fonts/inter-v4.1');
const out = resolve(site, 'docs/assets/fonts/layout');

/**
 * `overflow: 'ellipsis'` shapes U+2026 through the paragraph's font stack. The shared Inter subset is Basic
 * Latin only, so the truncation scene stacks this face behind it. The space keeps the face usable on its own.
 */
const CODE_POINTS = [0x20, 0x2026];

await mkdir(out, { recursive: true });
await copyFile(resolve(source, 'LICENSE.txt'), resolve(out, 'inter-LICENSE.txt'));

const output = resolve(out, 'inter-ellipsis.font.glb');
await bakeFont({
  input: resolve(source, 'Inter-Regular.ttf'),
  output,
  font: { fontFaceIndex: 0 },
  unicodeRanges: CODE_POINTS.map((codePoint) => ({ start: codePoint, end: codePoint })),
  // Must match ELLIPSIS_MSDF in the scene that loads this font.
  rasters: [{ baker: msdfBaker, packaging: { artifact: 'embedded' }, options: { emSize: 32, pixelRange: 6 } }],
});
console.log(`${relative(site, output)}  ${(await stat(output)).size} bytes`);
