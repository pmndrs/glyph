import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { bitmap, glyph } from '@pmndrs/glyph';
import { defineThreeConfig } from '@pmndrs/glyph/three';

import { loadFont } from '../../dist/loader.js';

// CrossSpace2 substitutes `hyphen' k -> hyphen.alt`: the context crosses the break a line takes after a hyphen.
const fixture = new URL('../../../../benches/fixtures/rendering/cross-space-2-bitmap-16.font.glb', import.meta.url);
const HYPHEN = 502;
const HYPHEN_ALT = 1466;
const text = 'a well-known half-knit sweater and the bad-kick snow-kitten at the dark-king lake';

test('a line ending at a corrected boundary that no space follows draws its end shaped alone', async (t) => {
  await glyph.init();
  const font = await loadFont({ baked: { bytes: await readFile(fixture) } }, bitmap({ strikes: [16] }));
  const root = glyph.handle('three:integration:unsafe-line-end', defineThreeConfig());
  t.after(() => {
    root.dispose();
    font.dispose();
  });
  let ends = 0;
  let inside = 0;
  for (const width of [100, 140, 180, 220, 260, 300]) {
    const paragraph = root.createText({
      font,
      text,
      style: { fontSize: 24 },
      layout: { wrap: 'word' },
      constraints: { width: { mode: 'exact', size: width } },
    });
    t.after(() => paragraph.dispose());
    const glyphs = paragraph.glyphs();
    for (const [line, start] of glyphs.lineTextStarts.entries()) {
      const end = glyphs.lineTextEnds[line];
      const first = glyphs.lineGlyphStarts[line];
      const ids = Array.from(glyphs.glyphIds.slice(first, first + glyphs.lineGlyphCounts[line]));
      if (text.slice(end - 1, end + 1) === '-k') {
        ends += 1;
        assert.equal(
          ids.at(-1),
          HYPHEN,
          `"${text.slice(start, end)}" ends with the hyphen it draws alone, as Chromium does`,
        );
      }
      inside += ids.filter((id) => id === HYPHEN_ALT).length;
    }
  }
  assert.equal(ends > 0 && inside > 0, true, 'the fixture breaks after a hyphen and keeps it inside other lines');
});
