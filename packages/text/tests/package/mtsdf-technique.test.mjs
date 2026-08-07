import assert from 'node:assert/strict';
import test from 'node:test';

import { defineRasterResourceId } from '@pmndrs/text';
import { mtsdf } from '@pmndrs/text/raster/mtsdf';

const binding = Object.freeze({ width: 32, height: 32, layers: 1 });
const records = new Uint8Array(40);
const view = new DataView(records.buffer);
view.setUint16(16, 0xffff, true);
view.setInt16(20, -2, true);
view.setInt16(22, -3, true);
view.setInt16(24, 8, true);
view.setInt16(26, 10, true);
view.setUint16(28, 4, true);
view.setUint16(30, 5, true);
view.setUint16(32, 14, true);
view.setUint16(34, 18, true);
view.setUint16(36, 0, true);

const data = {
  resource: defineRasterResourceId('test/mtsdf/font/atlas'),
  binding,
  emSize: 16,
  pixelRange: 8,
  planeUnitsPerEm: 16,
  records,
  pages: [{ width: 32, height: 32, format: 'rgba8unorm', bytes: new Uint8Array(32 * 32 * 4) }],
};

const paint = {
  color: [1, 0.5, 0.25, 1],
  outline: { color: [0, 1, 0, 1], width: 1 },
  shadow: { color: [0, 0, 1, 0.5], offset: [2, 3] },
};

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

test('portable MTSDF selection omits absent records and retains one atlas binding', () => {
  assert.equal(mtsdf.select(glyph(0)), undefined);
  assert.deepEqual(mtsdf.select(glyph(1)), {
    resource: data.resource,
    pipelineVariant: 0,
    binding,
  });
});

test('portable MTSDF storage packs positive-down paragraph origins without renderer objects', () => {
  const storage = mtsdf.createStorage(2);
  mtsdf.writeStorage(storage, { start: 1, count: 1 }, { data, binding, glyphs: [glyph(1)] });

  assert.deepEqual([...storage.origins], [0, 0, 98, 40]);
  assert.deepEqual([...storage.sizes], [0, 0, 12, 16]);
  assert.deepEqual([...storage.uvBounds.slice(4)], [4 / 32, 5 / 32, 14 / 32, 18 / 32]);
  assert.deepEqual([...storage.fillColors.slice(4)], paint.color);
  assert.deepEqual([...storage.outlineColors.slice(4)], paint.outline.color);
  assert.deepEqual([...storage.shadowColors.slice(4)], paint.shadow.color);
  assert.equal(storage.outlineWidths[1], 0.125);
  assert.equal(storage.pageIndices[1], 0);
});

test('portable MTSDF storage rejects mismatched bindings and invalid ranges', () => {
  const storage = mtsdf.createStorage(1);
  assert.throws(
    () => mtsdf.writeStorage(storage, { start: 0, count: 1 }, { data, binding: { ...binding }, glyphs: [glyph(1)] }),
    /binding does not belong/,
  );
  assert.throws(
    () => mtsdf.writeStorage(storage, { start: 1, count: 1 }, { data, binding, glyphs: [glyph(1)] }),
    /outside its capacity/,
  );
});
