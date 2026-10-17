import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { bitmap, glyph } from '@pmndrs/glyph';
import { defineThreeConfig } from '@pmndrs/glyph/three';

import { loadFont } from '../../dist/loader.js';

// CrossSpace substitutes `space a' -> a.init`: a line that starts at `a` must draw glyph 28, not 1464.
const fixtureUrl = new URL('../../../../benches/fixtures/rendering/cross-space-bitmap-16.font.glb', import.meta.url);
const amiriUrl = new URL('../../../../benches/fixtures/rendering/amiri-bitmap-16.font.glb', import.meta.url);
const text = 'the apple ate a banana while the eagle and the ape made a cake at the lake; a bee came and ate a pear';
const WIDTHS = [200, 240, 280, 320, 360, 400];

test('an RTL tail does not suppress corrected breaks in the LTR run', async (t) => {
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
      for (const [line, start] of glyphs.lineTextStarts.entries()) {
        if (start === 0 || source[start] !== 'a') continue;
        const first = glyphs.lineGlyphStarts[line];
        const end = first + glyphs.lineGlyphCounts[line];
        const firstA = Array.from(glyphs.clusters.slice(first, end)).indexOf(start);
        assert.notEqual(firstA, -1, `width ${width}: the line publishes its first cluster`);
        assert.equal(glyphs.glyphIds[first + firstA], 28, `width ${width}: line-start a is shaped alone`);
        count += 1;
      }
      paragraph.dispose();
    }
    return count;
  };
  assert.equal(startsAtA('') > 0, true, 'an LTR paragraph breaks before `a` and draws it shaped alone');
  assert.equal(startsAtA(' אב') > 0, true, 'a mixed-direction paragraph uses the same legal breaks');
});

test('pure RTL contextual lines draw the glyphs and advances shaped for those lines', async (t) => {
  await glyph.init();
  const font = await loadFont({ baked: { bytes: await readFile(amiriUrl) } }, bitmap({ strikes: [16] }));
  const root = glyph.handle('three:integration:unsafe-break-bidi:rtl', defineThreeConfig());
  t.after(() => {
    root.dispose();
    font.dispose();
  });
  const source = 'مرحبا بالعالم هذا اختبار لتغليف النص العربي بشكل صحيح.';
  const paragraph = root.createText({
    font,
    text: source,
    style: { fontSize: 24 },
    layout: { wrap: 'word' },
    constraints: { width: { mode: 'exact', size: 180 } },
  });
  t.after(() => paragraph.dispose());
  const wrapped = paragraph.glyphs();
  assert.ok(wrapped.lineTextStarts.length > 1, 'the fixture wraps');
  for (const [line, start] of wrapped.lineTextStarts.entries()) {
    const visible = source.slice(start, wrapped.lineTextEnds[line]).trimEnd();
    const standalone = root.createText({ font, text: visible, style: { fontSize: 24 }, layout: { wrap: 'none' } });
    const alone = standalone.glyphs();
    const first = wrapped.lineGlyphStarts[line];
    const last = first + wrapped.lineGlyphCounts[line];
    const drawn = Array.from({ length: last - first }, (_, i) => first + i).filter(
      (index) => wrapped.clusters[index] < start + visible.length,
    );
    assert.deepEqual(
      drawn.map((index) => wrapped.glyphIds[index]),
      Array.from(alone.glyphIds),
      `line ${line} glyphs`,
    );
    assert.deepEqual(
      drawn.map((index) => wrapped.glyphAdvances[index]),
      Array.from(alone.glyphAdvances),
      `line ${line} advances`,
    );
    const origin = wrapped.x[drawn[0]];
    const aloneOrigin = alone.x[0];
    for (const [ordinal, index] of drawn.entries()) {
      assert.ok(
        Math.abs(wrapped.x[index] - origin - (alone.x[ordinal] - aloneOrigin)) < 0.05,
        `line ${line} glyph ${ordinal} visual position`,
      );
    }
    assert.ok(Math.abs(wrapped.lineAdvances[line] - alone.lineAdvances[0]) < 0.05, `line ${line} fitted width`);
    standalone.dispose();
  }
});
