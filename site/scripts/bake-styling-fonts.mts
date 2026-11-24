import { copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';

import { msdfBaker } from '@pmndrs/glyph/bakers/msdf';
import { slugBaker } from '@pmndrs/glyph/bakers/slug';
import { bakeFont } from '@pmndrs/glyph/bake';

import { BIDI_TEXT } from '../examples/src/scenes/text-bidi/config.ts';
import { CJK_TEXT } from '../examples/src/scenes/text-cjk-line-breaking/config.ts';
import { LANGUAGE_TEXT } from '../examples/src/scenes/text-language-shaping/config.ts';
import { SERIF_MSDF } from '../examples/src/scenes/text-opentype-features/config.ts';

/**
 * The fonts the text-styling guides' scenes draw with, each baked to exactly
 * what its scenes show. Coverage is read from the scenes' own `config.ts`, so
 * the strings on screen and the code points in the file cannot drift apart.
 *
 * - Amiri: Arabic for the bidirectional and language scenes, a Slug subset.
 * - M PLUS 1p: Japanese for the line-breaking scene, a Slug subset.
 * - Source Serif 4: baked whole so discretionary OpenType features survive,
 *   with an MSDF raster narrowed to the glyphs the features scene shapes to.
 */
const site = resolve(dirname(new URL(import.meta.url).pathname), '..');
const fixtures = resolve(site, '../benches/fixtures/fonts');
const assets = resolve(site, 'docs/assets/fonts');
const out = resolve(assets, 'styling');

await mkdir(out, { recursive: true });

/** One inclusive range per distinct code point of `text`. */
function codePoints(text: string) {
  const points = [...new Set(Array.from(text, (character) => character.codePointAt(0)!))].sort((a, b) => a - b);
  return points.map((point) => ({ start: point, end: point }));
}

const slug = [{ baker: slugBaker, packaging: { artifact: 'embedded' }, options: undefined }] as const;

const jobs = [
  {
    id: 'amiri-arabic',
    input: resolve(fixtures, 'amiri-1.002/Amiri-Regular.ttf'),
    license: [resolve(fixtures, 'amiri-1.002/OFL.txt'), 'amiri-OFL.txt'],
    unicodeRanges: codePoints(`${BIDI_TEXT} ${LANGUAGE_TEXT}`),
    rasters: slug,
  },
  {
    id: 'mplus1p-cjk',
    input: resolve(assets, 'mplus1p-regular.ttf'),
    license: [resolve(assets, 'mplus1p-OFL.txt'), 'mplus1p-OFL.txt'],
    unicodeRanges: codePoints(CJK_TEXT),
    rasters: slug,
  },
  {
    id: 'source-serif-features',
    input: resolve(fixtures, 'source-serif-4.005/SourceSerif4-Regular.ttf'),
    license: [resolve(fixtures, 'source-serif-4.005/OFL.md'), 'source-serif-OFL.txt'],
    // No unicodeRanges: subsetting would drop smcp, onum and zero.
    unicodeRanges: undefined,
    rasters: [{ baker: msdfBaker, packaging: { artifact: 'embedded' }, options: SERIF_MSDF }],
  },
] as const;

for (const job of jobs) {
  const output = resolve(out, `${job.id}.font.glb`);
  await bakeFont({
    input: job.input,
    output,
    font: { fontFaceIndex: 0 },
    ...(job.unicodeRanges === undefined ? {} : { unicodeRanges: job.unicodeRanges }),
    rasters: job.rasters,
  });
  await copyFile(job.license[0], resolve(out, job.license[1]));
  const { size } = await stat(output);
  console.log(`${job.id} -> ${relative(site, output)} (${(size / 1024).toFixed(0)} KB)`);
}

/* @workflow
{
  "name": "site:bake-styling-fonts",
  "summary": "Bake the Arabic, Japanese and OpenType-feature fonts the text-styling guide scenes draw with.",
  "requirements": "A built @pmndrs/glyph, the font fixtures under benches/fixtures/fonts, and M PLUS 1p under site/docs/assets/fonts.",
  "writes": "site/docs/assets/fonts/styling/*.font.glb and each source font's licence beside them."
}
*/
