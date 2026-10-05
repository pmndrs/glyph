import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { bitmap, glyph } from '@pmndrs/glyph';
import { defineThreeConfig } from '@pmndrs/glyph/three';

import { loadFont } from '../../dist/loader.js';

const fredokaUrl = new URL(
  '../../../../benches/fixtures/rendering/fredoka-issue-216-bitmap-16.font.glb',
  import.meta.url,
);
const text = 'Reveals one grapheme at a time over a duration. Layout stays put and a trigger fires at the end.';

test('a clipped paragraph reports the corrected full content extent', async (t) => {
  await glyph.init();
  const font = await loadFont({ baked: { bytes: await readFile(fredokaUrl) } }, bitmap({ strikes: [16] }));
  const root = glyph.handle(
    'three:integration:unsafe-line-breaks:clipped-intrinsic',
    defineThreeConfig({ capacity: { size: 256, policy: 'grow' } }),
  );
  const create = (width, layout, height) =>
    root.createText({
      font,
      text,
      style: { fontSize: 24 },
      layout: { wrap: 'word', ...layout },
      constraints: { width: { mode: 'exact', size: width }, ...(height && { height }) },
    });
  const paragraphs = [];
  t.after(() => {
    for (const paragraph of paragraphs) paragraph.dispose();
    root.dispose();
    font.dispose();
  });

  for (let width = 150; width <= 450; width += 7.3) {
    const open = create(width);
    const clipped = create(width, { overflow: 'clip' }, { mode: 'exact', size: 28 });
    paragraphs.push(open, clipped);
    const full = open.measure();
    const visible = clipped.measure();
    assert.equal(visible.contentHeight, full.contentHeight, `content height at width ${width}`);
    assert.equal(visible.contentWidth, full.contentWidth, `content width at width ${width}`);
  }
});
