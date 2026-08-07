import assert from 'node:assert/strict';
import test from 'node:test';

import { defineRasterResourceId } from '@pmndrs/text';
import { bitmap } from '@pmndrs/text/raster/bitmap';

function records() {
  const bytes = new Uint8Array(40);
  const view = new DataView(bytes.buffer);
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
  return bytes;
}

function strike(index, ppem) {
  const resource = defineRasterResourceId(`test/bitmap/strike/${index}/page/0`);
  const binding = Object.freeze({ strike: index, page: 0, ppem, width: 32, height: 32 });
  return {
    ppem,
    planeUnitsPerEm: 16,
    records: records(),
    pages: [{ width: 32, height: 32, format: 'r8unorm', bytes: new Uint8Array(32 * 32), resource }],
    bindings: [binding],
  };
}

const data = { strikes: [strike(0, 16), strike(1, 32)] };
const paint = { color: [1, 0.5, 0.25, 1] };

function glyph(glyphId, fontSize = 16) {
  return {
    data,
    glyphId,
    fontSize,
    originX: 100,
    originY: 50,
    rasterPixelRatio: 1,
    paint,
  };
}

test('portable Bitmap selection omits absent records and chooses a physical strike page', () => {
  assert.equal(bitmap.select(glyph(0)), undefined);
  assert.deepEqual(bitmap.select(glyph(1, 31)), {
    resource: data.strikes[1].pages[0].resource,
    pipelineVariant: 0,
    binding: data.strikes[1].bindings[0],
  });
});

test('portable Bitmap storage packs positive-down origins and top-left UVs', () => {
  const storage = bitmap.createStorage(2);
  const binding = data.strikes[0].bindings[0];
  bitmap.writeStorage(storage, { start: 1, count: 1 }, { data, binding, glyphs: [glyph(1)] });

  assert.deepEqual([...storage.origins], [0, 0, 98, 40]);
  assert.deepEqual([...storage.sizes], [0, 0, 10, 13]);
  assert.deepEqual([...storage.uvOrigins], [0, 0, 4 / 32, 5 / 32]);
  assert.deepEqual([...storage.uvSizes], [0, 0, 10 / 32, 13 / 32]);
  assert.deepEqual([...storage.colors.slice(4)], paint.color);
});

test('portable Bitmap storage rejects a binding from outside its decoded data', () => {
  const storage = bitmap.createStorage(1);
  assert.throws(
    () =>
      bitmap.writeStorage(
        storage,
        { start: 0, count: 1 },
        { data, binding: { ...data.strikes[0].bindings[0] }, glyphs: [glyph(1)] },
      ),
    /binding does not belong/,
  );
});
