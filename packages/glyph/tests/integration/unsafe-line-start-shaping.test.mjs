import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { bitmap, glyph } from '@pmndrs/glyph';
import { defineThreeConfig } from '@pmndrs/glyph/three';

import { loadFont } from '../../dist/loader.js';

// CrossSpace substitutes `space a' -> a.init` and `e' space -> e.fina`: both contexts cross the space a line breaks at.
const crossSpaceUrl = new URL('../../../../benches/fixtures/rendering/cross-space-bitmap-16.font.glb', import.meta.url);
const A = 28;
const E_FINA = 1465;
const ELLIPSIS = 483;
const text =
  'the apple ate a banana while the eagle and the ape made a cake at the lake; a bee came and ate a pear near a tree';

async function crossSpace(t, name, layout, widths) {
  await glyph.init();
  const font = await loadFont({ baked: { bytes: await readFile(crossSpaceUrl) } }, bitmap({ strikes: [16] }));
  const root = glyph.handle(
    `three:integration:unsafe-line-start:${name}`,
    defineThreeConfig({ capacity: { size: 1024, policy: 'grow' } }),
  );
  t.after(() => {
    root.dispose();
    font.dispose();
  });
  return widths.map((width) => {
    const paragraph = root.createText({
      font,
      text,
      style: { fontSize: 24 },
      layout,
      constraints: { width: { mode: 'exact', size: width } },
    });
    t.after(() => paragraph.dispose());
    return paragraph.glyphs();
  });
}

const lines = (glyphs) =>
  Array.from(glyphs.lineTextStarts, (start, line) => {
    const first = glyphs.lineGlyphStarts[line];
    return {
      text: text.slice(start, glyphs.lineTextEnds[line]),
      ids: Array.from(glyphs.glyphIds.slice(first, first + glyphs.lineGlyphCounts[line])),
    };
  });

test('a line starting at an unsafe boundary draws its start as the line shaped alone, and keeps the hanging-space end', async (t) => {
  const paragraphs = await crossSpace(t, 'wrap', { wrap: 'word' }, [200, 240, 280, 320, 360, 400, 440]);
  let starts = 0;
  let ends = 0;
  for (const glyphs of paragraphs) {
    for (const line of lines(glyphs)) {
      if (line.text.startsWith('a')) {
        starts += 1;
        assert.equal(line.ids[0], A, `"${line.text}" starts with the base a, as Chromium draws it`);
      }
      const visible = line.text.trimEnd();
      if (visible.endsWith('e') && visible !== line.text) {
        ends += 1;
        const last = line.ids.findLastIndex((id) => id !== 1);
        assert.equal(line.ids[last], E_FINA, `"${line.text}" keeps e.fina before its hanging space`);
      }
    }
  }
  assert.equal(starts > 0 && ends > 0, true, 'the fixture wraps at both contexts');
});

test('an ellipsis line that starts at an unsafe boundary also draws its start shaped alone', async (t) => {
  const paragraphs = await crossSpace(
    t,
    'ellipsis',
    { wrap: 'word', maxLines: 2, overflow: 'ellipsis' },
    [60, 80, 130, 180, 200],
  );
  for (const glyphs of paragraphs) {
    const last = lines(glyphs).at(-1);
    assert.equal(last.text.startsWith('a'), true, `"${last.text}" starts at a corrected boundary`);
    assert.equal(last.ids[0], A, `"${last.text}" starts with the base a`);
    assert.equal(last.ids.at(-1), ELLIPSIS, `"${last.text}" ends with its ellipsis`);
  }
});
