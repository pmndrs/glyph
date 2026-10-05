import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { bitmap, glyph } from '@pmndrs/glyph';
import { defineThreeConfig } from '@pmndrs/glyph/three';

import { loadFont } from '../../dist/loader.js';

// CrossSpace substitutes `space a' -> a.init`: a line that starts at `a` has the width of the `a` it draws alone.
// A paragraph with an RTL run does not draw line edges shaped alone, so it must not price them either.
const fixtureUrl = new URL('../../../../benches/fixtures/rendering/cross-space-bitmap-16.font.glb', import.meta.url);
const text = 'the apple ate a banana while the eagle and the ape made a cake at the lake; a bee came and ate a pear';
const WIDTHS = [200, 240, 280, 320, 360, 400];

test('a paragraph with an RTL run never breaks at a boundary whose width needs the line shaped alone', async (t) => {
  await glyph.init();
  const font = await loadFont({ baked: { bytes: await readFile(fixtureUrl) } }, bitmap({ strikes: [16] }));
  const root = glyph.handle('three:integration:unsafe-break-bidi', defineThreeConfig());
  t.after(() => {
    root.dispose();
    font.dispose();
  });
  const startsAtA = (tail) => {
    const source = text + tail;
    let count = 0;
    for (const width of WIDTHS) {
      const paragraph = root.createText({
        font,
        text: source,
        style: { fontSize: 24 },
        layout: { wrap: 'word' },
        constraints: { width: { mode: 'exact', size: width } },
      });
      const glyphs = paragraph.glyphs();
      count += Array.from(glyphs.lineTextStarts).filter((start) => start > 0 && source[start] === 'a').length;
      paragraph.dispose();
    }
    return count;
  };
  assert.equal(startsAtA('') > 0, true, 'an LTR paragraph breaks before `a` and draws it shaped alone');
  assert.equal(startsAtA(' אב'), 0, 'a mixed-direction paragraph keeps main breaks at unsafe boundaries');
});
