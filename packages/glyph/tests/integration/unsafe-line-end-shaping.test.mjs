import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { bitmap, glyph } from '@pmndrs/glyph';
import { defineThreeConfig } from '@pmndrs/glyph/three';

import { loadFont } from '../../dist/loader.js';

// CrossSpace2 substitutes `hyphen' k -> hyphen.alt`: the context crosses a break after a hyphen, and Glyph never
// splits such a unit (unlike Chromium, which draws the hyphen alone at the line end).
const fixture = new URL('../../../../benches/fixtures/rendering/cross-space-2-bitmap-16.font.glb', import.meta.url);
const HYPHEN_ALT = 1466;
const text = 'a well-known half-knit sweater and the bad-kick snow-kitten at the dark-king lake';

test('no line ends at a corrected boundary that no space follows when shaping substitutes across it', async (t) => {
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
    for (const line of glyphs.lineTextStarts.keys()) {
      const end = glyphs.lineTextEnds[line];
      const first = glyphs.lineGlyphStarts[line];
      const ids = Array.from(glyphs.glyphIds.slice(first, first + glyphs.lineGlyphCounts[line]));
      if (text.slice(end - 1, end + 1) === '-k') ends += 1;
      inside += ids.filter((id) => id === HYPHEN_ALT).length;
    }
  }
  assert.equal(ends, 0, 'the substituted hyphen never ends a line');
  assert.equal(inside > 0, true, 'the fixture keeps the substituted hyphen inside its lines');
});
