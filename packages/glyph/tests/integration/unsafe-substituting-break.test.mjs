import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { bitmap, glyph } from '@pmndrs/glyph';
import { defineThreeConfig } from '@pmndrs/glyph/three';

import { loadFont } from '../../dist/loader.js';

// CrossSpace4 substitutes `hyphen' k -> hyphen.alt` and `hyphen' j -> hyphen.wide` (contextual units a line
// end would undo), and only kerns `hyphen z`: a positioning-only unsafe boundary.
const fontUrl = new URL('../../../../benches/fixtures/rendering/cross-space-4-bitmap-16.font.glb', import.meta.url);
const text =
  'the well-known knit and half-jnit sweater, a fine-zebra and far-zest coat, the slow-known yard is half-zoned and snow-jnown';

test('a break after a hyphen whose standalone shaping substitutes glyphs is not taken, a kerning-only one is', async (t) => {
  await glyph.init();
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  const root = glyph.handle(
    'three:integration:unsafe-substituting-break',
    defineThreeConfig({ capacity: { size: 1024, policy: 'grow' } }),
  );
  t.after(() => {
    root.dispose();
    font.dispose();
  });
  let kerned = 0;
  for (let width = 120; width <= 600; width += 8) {
    const paragraph = root.createText({
      font,
      text,
      style: { fontSize: 24 },
      layout: { wrap: 'word' },
      constraints: { width: { mode: 'exact', size: width } },
    });
    const glyphs = paragraph.glyphs();
    for (const end of glyphs.lineTextEnds) {
      if (text[end - 1] !== '-') continue;
      assert.equal(
        'kj'.includes(text[end]),
        false,
        `width ${String(width)} breaks after the substituting hyphen at ${String(end)}`,
      );
      kerned += 1;
    }
    paragraph.dispose();
  }
  assert.equal(kerned > 0, true, 'the kerning-only hyphen still breaks');
});
