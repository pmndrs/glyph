import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { glyph } from '@pmndrs/glyph';
import { bitmap } from '@pmndrs/glyph/raster/bitmap';
import '../support/browser-globals.mjs';

const fontUrl = new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);
const bytes = await readFile(fontUrl);

test('FontFace loading and explicit cloning do not initialize the Glyph engine', async () => {
  assert.equal(glyph.initialized, false);
  const face = glyph.fontFace(
    { baked: { bytes, ownership: 'copy' } },
    { family: 'FontFaceBeforeInit', format: bitmap({ strikes: [16] }) },
  );
  try {
    const [serialized, transfer] = await face.bitmap.clone();
    assert.equal(glyph.initialized, false);
    assert.equal(serialized.rasters.length, 1);
    assert.ok(transfer.includes(serialized.data));
  } finally {
    face.dispose();
  }
});
