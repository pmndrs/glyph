import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { bitmap, glyph } from '@pmndrs/glyph';
import { defineThreeConfig } from '@pmndrs/glyph/three';

import { loadFont } from '../../dist/loader.js';

// CrossSpace4 substitutes `hyphen' k -> hyphen.alt`: the fitter never breaks after that hyphen, so min-content
// must not offer it as a break either, or a box sized to min-content would overflow.
const fontUrl = new URL('../../../../benches/fixtures/rendering/cross-space-4-bitmap-16.font.glb', import.meta.url);
const text = 'i-k i';

test('no line overflows the min-content width of a paragraph with a substituting hyphen', async (t) => {
  await glyph.init();
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  const root = glyph.handle('three:integration:unsafe-min-content', defineThreeConfig());
  t.after(() => {
    root.dispose();
    font.dispose();
  });
  const create = (size) =>
    root.createText({
      font,
      text,
      style: { fontSize: 24 },
      layout: { wrap: 'word' },
      constraints: { width: { mode: 'exact', size } },
    });
  const probe = create(10_000);
  const { minContentWidth } = probe.measure();
  probe.dispose();
  const paragraph = create(minContentWidth);
  const { lines } = paragraph.measure();
  paragraph.dispose();
  assert.equal(lines.length > 1, true, 'the paragraph wraps at its min-content width');
  for (const line of lines) {
    assert.equal(
      line.advance <= minContentWidth + 0.01,
      true,
      `"${text.slice(line.textStart, line.textEnd)}" is ${String(line.advance)} wide in ${String(minContentWidth)}`,
    );
  }
});
