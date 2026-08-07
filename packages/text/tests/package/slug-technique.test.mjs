import assert from 'node:assert/strict';
import test from 'node:test';

import { defineRasterResourceId } from '@pmndrs/text';
import { slug } from '@pmndrs/text/raster/slug';

const records = new Uint8Array(80);
const view = new DataView(records.buffer);
view.setUint16(8, 0xffff, true);
view.setInt16(40, -2, true);
view.setInt16(42, -3, true);
view.setInt16(44, 8, true);
view.setInt16(46, 10, true);
view.setUint16(48, 0, true);
view.setUint16(50, 2, true);
view.setUint16(52, 3, true);
view.setUint32(56, 1, true);
view.setUint32(60, 2, true);
view.setUint32(64, 4, true);
view.setUint32(68, 6, true);
view.setUint32(72, 8, true);
view.setUint32(76, 5, true);

const page = {
  resource: defineRasterResourceId('test/slug/font/page/0'),
  curveWidth: 8,
  curveHeight: 8,
  curveBytes: new Uint8Array(8 * 8 * 8),
  headerCount: 16,
  headerWidth: 4,
  headerHeight: 4,
  headerBytes: new Uint8Array(4 * 4 * 4),
  referenceCount: 16,
  referenceWidth: 4,
  referenceHeight: 4,
  referenceBytes: new Uint8Array(4 * 4 * 2),
};
const binding = Object.freeze({
  page: 0,
  curveWidth: 8,
  curveHeight: 8,
  headerWidth: 4,
  headerHeight: 4,
  referenceWidth: 4,
  referenceHeight: 4,
});
const data = { planeUnitsPerEm: 16, records, pages: [page], bindings: [binding] };
const paint = { color: [1, 0.5, 0.25, 1] };

function glyph(glyphId) {
  return {
    data,
    glyphId,
    fontSize: 16,
    originX: 100,
    originY: 50,
    rasterPixelRatio: 1,
    paint,
  };
}

test('portable Slug selection omits absent records and retains one analytic page binding', () => {
  assert.equal(slug.select(glyph(0)), undefined);
  assert.deepEqual(slug.select(glyph(1)), {
    resource: page.resource,
    pipelineVariant: 0,
    binding,
  });
});

test('portable Slug storage packs positive-down geometry and exact analytic addresses', () => {
  const storage = slug.createStorage(2);
  slug.writeStorage(storage, { start: 1, count: 1 }, { data, binding, glyphs: [glyph(1)] });

  assert.deepEqual([...storage.origins], [0, 0, 98, 40]);
  assert.deepEqual([...storage.sizes], [0, 0, 10, 13]);
  assert.equal(storage.inverseScales[1], 1 / 16);
  assert.deepEqual([...storage.colors.slice(4)], paint.color);
  assert.equal(storage.curveBases[1], 1);
  assert.equal(storage.horizontalHeaderBases[1], 4);
  assert.equal(storage.verticalHeaderBases[1], 6);
  assert.equal(storage.referenceBases[1], 8);
  assert.equal(storage.horizontalBandCounts[1], 2);
  assert.equal(storage.verticalBandCounts[1], 3);
});

test('portable Slug storage rejects a binding from outside its decoded data', () => {
  const storage = slug.createStorage(1);
  assert.throws(
    () => slug.writeStorage(storage, { start: 0, count: 1 }, { data, binding: { ...binding }, glyphs: [glyph(1)] }),
    /binding does not belong/,
  );
});
