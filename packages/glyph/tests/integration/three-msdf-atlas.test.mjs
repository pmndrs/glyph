import assert from 'node:assert/strict';
import test from 'node:test';

import { msdf, msdfCodec } from '../../dist/raster/msdf.js';
import { createMsdfAtlas } from '../../dist/three/internal/msdf-atlas.js';

const STRIDE = 4;
const RECORD_STRIDE = 20;
const LAYER_STEP = 4096;

/**
 * A decoded MSDF font of `count` cells, `size` texels square, each filled with its own row number + 1, and the atlas
 * resource group the codec retains for it.
 */
function bakedGroup(count, size, bakedWidth, bakedHeight) {
  const perRow = Math.floor(bakedWidth / size);
  const perLayer = perRow * Math.floor(bakedHeight / size);
  const layers = Math.ceil(count / perLayer);
  const pages = Array.from({ length: layers }, () => ({
    width: bakedWidth,
    height: bakedHeight,
    format: 'rgba8unorm',
    bytes: new Uint8Array(bakedWidth * bakedHeight * 4),
  }));
  const records = new Uint8Array((count + 1) * RECORD_STRIDE);
  const view = new DataView(records.buffer);
  view.setUint16(count * RECORD_STRIDE + 16, 0xffff, true);
  for (let row = 0; row < count; row += 1) {
    const layer = Math.floor(row / perLayer);
    const slot = row % perLayer;
    const left = (slot % perRow) * size;
    const top = Math.floor(slot / perRow) * size;
    const record = row * RECORD_STRIDE;
    view.setUint16(record + 8, left, true);
    view.setUint16(record + 10, top, true);
    view.setUint16(record + 12, left + size, true);
    view.setUint16(record + 14, top + size, true);
    view.setUint16(record + 16, layer, true);
    for (let y = 0; y < size; y += 1) {
      const start = ((top + y) * bakedWidth + left) * 4;
      pages[layer].bytes.fill(row + 1, start, start + size * 4);
    }
  }
  const data = {
    resource: `test/${count}/${size}`,
    binding: { width: bakedWidth, height: bakedHeight, layers },
    emSize: 64,
    pixelRange: 8,
    planeUnitsPerEm: 64,
    records,
    pages,
  };
  let retained;
  msdfCodec.compileFont({
    font: { data },
    retain: (_name, _id, payload) => (retained = payload),
    compile: () => undefined,
  });
  return { group: retained, data };
}

/** One instance per glyph row, with the row in the last lane as the MSDF effect lane carries it. */
function lane(rows) {
  const values = new Float32Array(rows.length * STRIDE);
  rows.forEach((row, index) => (values[index * STRIDE + 3] = row));
  return values;
}

function residentCell(atlas, row) {
  const [left, top, width, packed] = atlas.glyphs.image.data.subarray(row * STRIDE, row * STRIDE + STRIDE);
  const layer = Math.floor(packed / LAYER_STEP);
  return { left, top, width, height: packed - layer * LAYER_STEP, layer };
}

function texel(atlas, cell, x, y) {
  const { data, width, height } = atlas.texture.image;
  return data[((cell.layer * height + cell.top + y) * width + cell.left + x) * 4];
}

test('an MSDF atlas holds only the glyphs that were drawn', () => {
  const atlas = createMsdfAtlas(bakedGroup(200, 40, 1024, 344).group);
  try {
    assert.equal(atlas.texture.image.depth, 1, 'the resident atlas starts with one layer');
    assert.equal(atlas.byteLength < 1024 * 344 * 4, true, 'resident memory starts below the baked atlas');
    assert.deepEqual(residentCell(atlas, 7).width, 0, 'a glyph nobody drew has no resident cell');

    atlas.use(lane([7, 3, 7, 150]), 0, 4, STRIDE);
    const cells = [7, 3, 150].map((row) => residentCell(atlas, row));
    for (const [index, row] of [7, 3, 150].entries()) {
      const cell = cells[index];
      assert.deepEqual([cell.width, cell.height, cell.layer], [40, 40, 0]);
      assert.equal(texel(atlas, cell, 0, 0), row + 1, 'the cell carries its own baked texels');
      assert.equal(texel(atlas, cell, 39, 39), row + 1);
    }
    assert.deepEqual(
      cells.map((cell) => cell.left),
      [0, 40, 80],
      'cells are shelved in the order instances first name them',
    );
    assert.equal(residentCell(atlas, 4).width, 0, 'neighbors in the baked atlas stay out');
    assert.equal(atlas.texture.layerUpdates.has(0), true, 'the written layer is marked for upload');

    const before = residentCell(atlas, 3);
    atlas.use(lane([3, 7]), 0, 2, STRIDE);
    assert.deepEqual(residentCell(atlas, 3), before, 'a resident cell never moves');
  } finally {
    atlas.dispose();
  }
});

test('an MSDF atlas grows by whole layers and keeps earlier cells', () => {
  const atlas = createMsdfAtlas(bakedGroup(200, 40, 1024, 344).group);
  try {
    const perLayer = Math.floor(256 / 40) ** 2;
    atlas.use(lane(Array.from({ length: perLayer }, (_, row) => row)), 0, perLayer, STRIDE);
    assert.equal(atlas.texture.image.depth, 1);
    const first = residentCell(atlas, 0);
    atlas.texture.clearLayerUpdates();

    atlas.use(lane([perLayer + 5]), 0, 1, STRIDE);
    assert.equal(atlas.texture.image.depth, 2, 'a full layer makes room with a second one');
    const grown = residentCell(atlas, perLayer + 5);
    assert.deepEqual([grown.left, grown.top, grown.layer], [0, 0, 1]);
    assert.equal(texel(atlas, grown, 20, 20), perLayer + 6);
    assert.deepEqual(residentCell(atlas, 0), first);
    assert.equal(texel(atlas, first, 20, 20), 1, 'growth preserves resident texels');
    assert.deepEqual([...atlas.texture.layerUpdates].sort(), [0, 1], 'a rebuilt texture uploads every layer');
  } finally {
    atlas.dispose();
  }
});

test('an MSDF atlas sizes its layers to the largest baked cell', () => {
  const atlas = createMsdfAtlas(bakedGroup(4, 300, 1024, 1024).group);
  try {
    atlas.use(lane([0, 1, 2]), 0, 3, STRIDE);
    assert.equal(atlas.texture.image.width, 512);
    assert.equal(atlas.metrics.x, 512, 'the shader normalizes by the resident extent');
    assert.equal(atlas.texture.image.depth, 3, 'one 300-texel cell fits per 512-texel layer');
  } finally {
    atlas.dispose();
  }
});

test('an MSDF atlas reads baked pages by reference and outlives the font data', () => {
  const { group, data } = bakedGroup(8, 40, 256, 256);
  assert.equal(group.members.pages.bytes.byteLength, 4, 'the resource carries a token, not the baked texels');
  const atlas = createMsdfAtlas(group);
  try {
    // Disposing the decoded font releases the token; a realized atlas keeps the pages it resolved.
    msdf.dispose(data);
    data.pages[0].bytes.fill(77, 0, 4);
    atlas.use(lane([0]), 0, 1, STRIDE);
    assert.equal(texel(atlas, residentCell(atlas, 0), 0, 0), 77, 'cells are copied from the page itself');
    assert.throws(() => createMsdfAtlas(group), /released before a renderer realized them/);
  } finally {
    atlas.dispose();
  }
});
