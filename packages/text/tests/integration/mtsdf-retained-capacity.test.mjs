import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three/webgpu';
import {
  coalesceRasterInstanceRanges,
  rasterInstanceCapacity,
  rasterInstanceUpdateRanges,
} from '../../dist/internal/raster-instance-capacity.js';
import { msdf } from '../../dist/raster/msdf.js';

const STRIDE = 28;

test('MTSDF retained capacity plans bounded slack and coalesces dirty buckets', () => {
  assert.equal(rasterInstanceCapacity(0), 0);
  assert.equal(rasterInstanceCapacity(1), 2);
  assert.equal(rasterInstanceCapacity(4), 5);
  assert.equal(rasterInstanceCapacity(1024), 1280);
  assert.equal(rasterInstanceCapacity(1025), 1281);

  assert.deepEqual(coalesceRasterInstanceRanges([0, 31, 32, 63, 96], 128, STRIDE), [
    { start: 0, count: 64 * STRIDE },
    { start: 96 * STRIDE, count: 32 * STRIDE },
  ]);
  assert.deepEqual(coalesceRasterInstanceRanges([0, 64, 128, 192, 256, 320, 384, 448, 512], 576, STRIDE), [
    { start: 0, count: 576 * STRIDE },
  ]);
  assert.deepEqual(rasterInstanceUpdateRanges([1, 2, 0, 0], [1, 3, 4, 5], [], 1, 2, 2), [{ start: 0, count: 4 }]);
  assert.throws(() => rasterInstanceUpdateRanges([1, 2], [1], [], 1, 1, 2), /logical instance range/);
});

test('MTSDF retains capacity for arbitrary glyph replacement and replaces only on overflow', () => {
  const resource = syntheticResource();
  const initialLayout = layout([0, 0, 0], 1, 2, 16);
  const initialPaint = paint(3, [0.1, 0.2, 0.3, 0.4], [0.2, 0.3, 0.4, 0.5], [0.3, 0.4, 0.5, 0.6], 1, [-1, 2]);
  let batch = committedBatch(initialLayout, resource, initialPaint);
  try {
    const mesh = batch.object.children[0];
    assert.ok(mesh);
    const geometry = mesh.geometry;
    const material = mesh.material;
    const data = geometry.getAttribute('msdfOrigin').data;
    const backingArray = data.array;
    const initialValues = Array.from(backingArray.subarray(0, STRIDE));
    assert.equal(data.usage, THREE.DynamicDrawUsage);
    assert.equal(batch.glyphCount, 3);
    assert.equal(batch.drawCount, 1);
    assert.equal(geometry.instanceCount, 3);

    const replacementLayout = layout([1, 1, 1], 9, 11, 32);
    const replacementPaint = paint(3, [0.6, 0.5, 0.4, 0.3], [0.7, 0.6, 0.5, 0.4], [0.8, 0.7, 0.6, 0.5], 3, [3, -4]);
    const replacement = msdf.stageBatch(batch, replacementLayout, resource, 0, replacementPaint, 1);
    assert.equal(replacement.batch, batch);
    assert.equal(batch.glyphCount, 3, 'staging preserves the live logical count');
    assert.equal(geometry.instanceCount, 3, 'staging preserves the live draw count');
    assert.deepEqual(
      Array.from(backingArray.subarray(0, STRIDE)),
      initialValues,
      'staging preserves live instance data',
    );
    replacement.commit();

    assert.equal(batch.object.children[0], mesh);
    assert.equal(mesh.geometry, geometry);
    assert.equal(mesh.material, material);
    assert.equal(geometry.getAttribute('msdfOrigin').data, data);
    assert.equal(data.array, backingArray);
    assert.equal(batch.glyphCount, 3);
    assert.equal(geometry.instanceCount, 3);
    for (const [component, value] of Array.from(backingArray.subarray(0, STRIDE)).entries()) {
      assert.notEqual(value, initialValues[component], `all-field replacement updates component ${component}`);
    }
    assert.deepEqual(data.updateRanges, [{ start: 0, count: 3 * STRIDE }]);

    const origin = geometry.getAttribute('msdfOrigin');
    origin.setXY(0, 123, 456);
    const colorOnly = msdf.stageBatch(
      batch,
      replacementLayout,
      resource,
      0,
      paint(3, [0.2, 0.3, 0.4, 0.5], [0.3, 0.4, 0.5, 0.6], [0.4, 0.5, 0.6, 0.7], 3, [3, -4]),
      1,
    );
    assert.equal(colorOnly.batch, batch);
    colorOnly.commit();
    assert.equal(batch.glyphCount, 3, 'same-layout paint keeps the logical count');
    assert.equal(geometry.instanceCount, 3, 'same-layout paint keeps the authoritative draw count');
    assert.deepEqual([origin.getX(0), origin.getY(0)], [123, 456], 'color-only staging preserves structural values');

    const shrunk = msdf.stageBatch(
      batch,
      layout([0, 1], 3, 5, 20),
      resource,
      0,
      paint(2, [0.6, 0.5, 0.4, 0.3], [0.7, 0.6, 0.5, 0.4], [0.8, 0.7, 0.6, 0.5], 2, [3, -4]),
      1,
    );
    assert.equal(shrunk.batch, batch);
    shrunk.commit();
    assert.equal(batch.glyphCount, 2);
    assert.equal(batch.drawCount, 1);
    assert.equal(geometry.instanceCount, 2);
    assert.equal(data.array, backingArray, 'shrinking retains the backing allocation');

    const exactCapacity = msdf.stageBatch(
      batch,
      layout([0, 1, 0, 1], 4, 6, 24),
      resource,
      0,
      paint(4, [0.1, 0.2, 0.3, 0.4], [0.2, 0.3, 0.4, 0.5], [0.3, 0.4, 0.5, 0.6], 1, [-1, 2]),
      1,
    );
    assert.equal(exactCapacity.batch, batch);
    exactCapacity.commit();
    assert.equal(batch.glyphCount, 4);
    assert.equal(geometry.instanceCount, 4);
    assert.equal(data.array, backingArray, 'growth through the allocated capacity retains the backing allocation');

    const liveValues = Array.from(backingArray);
    const liveRanges = data.updateRanges.map(({ start, count }) => ({ start, count }));
    const aborted = msdf.stageBatch(
      batch,
      layout([1, 0, 1], 7, 8, 18),
      resource,
      0,
      paint(3, [0.6, 0.5, 0.4, 0.3], [0.7, 0.6, 0.5, 0.4], [0.8, 0.7, 0.6, 0.5], 2, [3, -4]),
      1,
    );
    assert.equal(aborted.batch, batch);
    aborted.abort();
    assert.equal(batch.glyphCount, 4);
    assert.equal(geometry.instanceCount, 4);
    assert.deepEqual(Array.from(backingArray), liveValues, 'aborting retained staging preserves live instance data');
    assert.deepEqual(data.updateRanges, liveRanges, 'aborting retained staging preserves live upload ranges');

    const abortedOverflow = msdf.stageBatch(
      batch,
      layout([1, 0, 1, 0, 1], 10, 11, 18),
      resource,
      0,
      paint(5, [0.6, 0.5, 0.4, 0.3], [0.7, 0.6, 0.5, 0.4], [0.8, 0.7, 0.6, 0.5], 2, [3, -4]),
      1,
    );
    assert.notEqual(abortedOverflow.batch, batch);
    const abortedOverflowMesh = abortedOverflow.batch.object.children[0];
    assert.ok(abortedOverflowMesh);
    let abortedOverflowGeometryDisposed = false;
    abortedOverflowMesh.geometry.addEventListener('dispose', () => {
      abortedOverflowGeometryDisposed = true;
    });
    abortedOverflow.abort();
    assert.equal(abortedOverflowGeometryDisposed, true, 'aborting overflow disposes the staged geometry');
    assert.equal(abortedOverflow.batch.object.children.length, 0, 'aborting overflow clears staged draw objects');
    assert.equal(batch.glyphCount, 4);
    assert.equal(geometry.instanceCount, 4);
    assert.deepEqual(Array.from(backingArray), liveValues, 'aborting overflow preserves the live backing data');
    assert.deepEqual(data.updateRanges, liveRanges, 'aborting overflow preserves the live upload ranges');

    const overflow = msdf.stageBatch(
      batch,
      layout([0, 1, 0, 1, 0], 12, 13, 18),
      resource,
      0,
      paint(5, [0.1, 0.2, 0.3, 0.4], [0.2, 0.3, 0.4, 0.5], [0.3, 0.4, 0.5, 0.6], 1, [-1, 2]),
      1,
    );
    assert.notEqual(overflow.batch, batch);
    assert.equal(batch.glyphCount, 4);
    assert.equal(geometry.instanceCount, 4);
    overflow.commit();
    const previous = batch;
    batch = overflow.batch;
    const replacementMesh = batch.object.children[0];
    assert.ok(replacementMesh);
    assert.notEqual(replacementMesh.geometry, geometry);
    assert.notEqual(replacementMesh.geometry.getAttribute('msdfOrigin').data.array, backingArray);
    assert.equal(batch.glyphCount, 5);
    assert.equal(replacementMesh.geometry.instanceCount, 5);
    previous.dispose();
  } finally {
    batch.dispose();
    msdf.dispose(resource);
  }
});

function committedBatch(layoutValue, resource, paintValue) {
  const stage = msdf.stageBatch(undefined, layoutValue, resource, 0, paintValue, 1);
  stage.commit();
  return stage.batch;
}

function layout(glyphIds, x, y, fontSize) {
  return {
    glyphIds: Uint16Array.from(glyphIds),
    glyphFontSlots: new Uint16Array(glyphIds.length),
    glyphFontSizes: Float32Array.from({ length: glyphIds.length }, () => fontSize),
    x: Float32Array.from({ length: glyphIds.length }, (_value, index) => x + index),
    y: Float32Array.from({ length: glyphIds.length }, (_value, index) => y + index),
  };
}

function paint(count, color, outlineColor, shadowColor, outlineWidth, shadowOffset) {
  return {
    paintIndices: new Uint16Array(count),
    palette: [
      {
        color,
        outline: { color: outlineColor, width: outlineWidth },
        shadow: { color: shadowColor, offset: shadowOffset },
      },
    ],
  };
}

function syntheticResource() {
  const records = new Uint8Array(2 * 20);
  writeRecord(records, 0, {
    left: 0,
    bottom: 0,
    right: 8,
    top: 12,
    atlasLeft: 0,
    atlasTop: 0,
    atlasRight: 1,
    atlasBottom: 1,
    page: 0,
  });
  writeRecord(records, 1, {
    left: 4,
    bottom: 5,
    right: 28,
    top: 37,
    atlasLeft: 1,
    atlasTop: 1,
    atlasRight: 2,
    atlasBottom: 2,
    page: 1,
  });
  const texture = new THREE.DataArrayTexture(new Uint8Array(4 * 4 * 2 * 4), 4, 4, 2);
  return {
    emSize: 16,
    pixelRange: 4,
    planeUnitsPerEm: 16,
    records,
    pages: [
      { width: 4, height: 4 },
      { width: 4, height: 4 },
    ],
    atlas: { width: 4, height: 4, layers: 2, texture },
    gpuBytes: 4 * 4 * 2 * 4,
  };
}

function writeRecord(records, glyph, values) {
  const view = new DataView(records.buffer, records.byteOffset, records.byteLength);
  const offset = glyph * 20;
  view.setInt16(offset, values.left, true);
  view.setInt16(offset + 2, values.bottom, true);
  view.setInt16(offset + 4, values.right, true);
  view.setInt16(offset + 6, values.top, true);
  view.setUint16(offset + 8, values.atlasLeft, true);
  view.setUint16(offset + 10, values.atlasTop, true);
  view.setUint16(offset + 12, values.atlasRight, true);
  view.setUint16(offset + 14, values.atlasBottom, true);
  view.setUint16(offset + 16, values.page, true);
}
