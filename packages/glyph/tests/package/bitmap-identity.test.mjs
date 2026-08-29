import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BITMAP_EXTENSION,
  BITMAP_FORMAT_VERSION,
  BITMAP_GENERATOR_VERSION,
  BITMAP_KIND,
  MAX_BITMAP_PPEM,
  bitmapDescriptor,
  bitmapRasterKey,
} from '@pmndrs/glyph/raster/bitmap';

test('canonicalizes bitmap strikes and owns its compatibility versions', async () => {
  const descriptor = bitmapDescriptor({ strikes: [32, 16] });

  assert.deepEqual(descriptor, { generatorVersion: '0.0.0', strikes: [16, 32] });
  assert.equal(BITMAP_KIND, 'bitmap');
  assert.equal(BITMAP_EXTENSION, 'PMNDRS_font_bitmap');
  assert.equal(BITMAP_FORMAT_VERSION, 0);
  assert.equal(BITMAP_GENERATOR_VERSION, '0.0.0');
  assert.equal(MAX_BITMAP_PPEM, 1022);
  assert.deepEqual(bitmapDescriptor({ strikes: [MAX_BITMAP_PPEM] }).strikes, [MAX_BITMAP_PPEM]);
  assert.equal(bitmapRasterKey({ strikes: [32, 16] }), bitmapRasterKey({ strikes: [16, 32] }));
});

test('rejects every invalid runtime strike form', () => {
  for (const strikes of [[], [0], [-1], [1.5], [Number.NaN], [Number.POSITIVE_INFINITY], [1023]]) {
    assert.throws(() => bitmapDescriptor({ strikes }), /bitmap strikes/);
  }
  assert.throws(() => bitmapDescriptor({ strikes: [16, 16] }), /duplicated/);
  assert.throws(() => bitmapDescriptor({}), /strikes tuple/);
  assert.throws(() => bitmapDescriptor(null), /strikes tuple/);
});
