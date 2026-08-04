import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three/webgpu';
import { slug } from '../../dist/raster/slug.js';

test('Slug retains both interleaved instance records and replaces changed page topology or overflow', () => {
  const resource = syntheticResource();
  const initialLayout = layout([0, 0, 0], 1, 2, 16);
  let batch = committedBatch(initialLayout, resource, paint(3, [0.1, 0.2, 0.3, 0.4]));
  try {
    const mesh = batch.object.children[0];
    assert.ok(mesh);
    const geometry = mesh.geometry;
    const material = mesh.material;
    const floatData = geometry.getAttribute('slugOrigin').data;
    const uintData = geometry.getAttribute('slugCurveBase').data;
    const floatArray = floatData.array;
    const uintArray = uintData.array;
    const initialFloats = Array.from(floatArray);
    const initialUints = Array.from(uintArray);
    assert.equal(floatData.usage, THREE.DynamicDrawUsage);
    assert.equal(uintData.usage, THREE.DynamicDrawUsage);
    assert.equal(batch.glyphCount, 3);
    assert.equal(batch.drawCount, 1);
    assert.equal(geometry.instanceCount, 3);
    assert.equal(batch.object.isGroup, undefined);
    batch.setRenderOrderBase(600);
    assert.equal(mesh.renderOrder, 600);

    const replacementLayout = layout([1, 1, 1], 9, 11, 32);
    const replacement = slug.stageBatch(batch, replacementLayout, resource, 0, paint(3, [0.6, 0.5, 0.4, 0.3]), 1);
    assert.equal(replacement.batch, batch);
    assert.deepEqual(Array.from(floatArray), initialFloats, 'staging preserves live float data');
    assert.deepEqual(Array.from(uintArray), initialUints, 'staging preserves live integer data');
    replacement.commit();

    assert.equal(batch.object.children[0], mesh);
    assert.equal(mesh.geometry, geometry);
    assert.equal(mesh.material, material);
    assert.equal(geometry.getAttribute('slugOrigin').data, floatData);
    assert.equal(geometry.getAttribute('slugCurveBase').data, uintData);
    assert.equal(floatData.array, floatArray);
    assert.equal(uintData.array, uintArray);
    assert.equal(batch.object.isGroup, undefined, 'retained replacement keeps a neutral root');
    assert.equal(mesh.renderOrder, 600, 'retained replacement preserves the Text-local order');
    assert.notDeepEqual(Array.from(floatArray), initialFloats);
    assert.notDeepEqual(Array.from(uintArray), initialUints);
    assert.deepEqual(floatData.updateRanges, [{ start: 0, count: 3 * floatData.stride }]);
    assert.deepEqual(uintData.updateRanges, [{ start: 0, count: 3 * uintData.stride }]);

    const origin = geometry.getAttribute('slugOrigin');
    origin.setXY(0, 123, 456);
    const colorOnly = slug.stageBatch(batch, replacementLayout, resource, 0, paint(3, [0.2, 0.3, 0.4, 0.5]), 1);
    colorOnly.commit();
    assert.deepEqual([origin.getX(0), origin.getY(0)], [123, 456], 'paint-only staging preserves structural data');

    const shrunk = slug.stageBatch(batch, layout([0, 1], 3, 5, 20), resource, 0, paint(2, [0.4, 0.3, 0.2, 0.1]), 1);
    assert.equal(shrunk.batch, batch);
    shrunk.commit();
    assert.equal(batch.glyphCount, 2);
    assert.equal(geometry.instanceCount, 2);
    assert.equal(floatData.array, floatArray);
    assert.equal(uintData.array, uintArray);

    const exactCapacity = slug.stageBatch(
      batch,
      layout([1, 0, 1, 0], 4, 6, 24),
      resource,
      0,
      paint(4, [0.3, 0.4, 0.5, 0.6]),
      1,
    );
    assert.equal(exactCapacity.batch, batch);
    exactCapacity.commit();
    assert.equal(batch.glyphCount, 4);
    assert.equal(geometry.instanceCount, 4);
    assert.equal(floatData.array, floatArray);
    assert.equal(uintData.array, uintArray);

    const liveFloats = Array.from(floatArray);
    const liveUints = Array.from(uintArray);
    const liveFloatRanges = floatData.updateRanges.map(({ start, count }) => ({ start, count }));
    const liveUintRanges = uintData.updateRanges.map(({ start, count }) => ({ start, count }));
    const aborted = slug.stageBatch(batch, layout([0, 1, 0], 7, 8, 18), resource, 0, paint(3, [0.7, 0.6, 0.5, 0.4]), 1);
    assert.equal(aborted.batch, batch);
    aborted.abort();
    assert.equal(batch.glyphCount, 4);
    assert.equal(geometry.instanceCount, 4);
    assert.deepEqual(Array.from(floatArray), liveFloats);
    assert.deepEqual(Array.from(uintArray), liveUints);
    assert.deepEqual(floatData.updateRanges, liveFloatRanges);
    assert.deepEqual(uintData.updateRanges, liveUintRanges);

    const changedTopology = slug.stageBatch(
      batch,
      layout([0, 2, 0], 10, 12, 18),
      resource,
      0,
      paint(3, [0.2, 0.4, 0.6, 0.8]),
      1,
    );
    assert.notEqual(changedTopology.batch, batch);
    assert.equal(changedTopology.batch.drawCount, 3);
    changedTopology.batch.setRenderOrderBase(600);
    assert.deepEqual(
      changedTopology.batch.object.children.map(({ renderOrder }) => renderOrder),
      [600, 601, 602],
      'page runs compose the Text-local base with first-glyph-local order',
    );
    assert.equal(changedTopology.batch.object.isGroup, undefined);
    const topologyGeometries = changedTopology.batch.object.children.map(({ geometry: stagedGeometry }) => {
      let disposed = false;
      stagedGeometry.addEventListener('dispose', () => {
        disposed = true;
      });
      return () => disposed;
    });
    changedTopology.abort();
    assert.equal(changedTopology.batch.object.children.length, 0);
    assert.ok(topologyGeometries.every((wasDisposed) => wasDisposed()));
    assert.equal(batch.glyphCount, 4);

    const overflow = slug.stageBatch(
      batch,
      layout([1, 0, 1, 0, 1], 12, 13, 18),
      resource,
      0,
      paint(5, [0.8, 0.6, 0.4, 0.2]),
      1,
    );
    assert.notEqual(overflow.batch, batch);
    overflow.commit();
    const previous = batch;
    batch = overflow.batch;
    const replacementMesh = batch.object.children[0];
    assert.ok(replacementMesh);
    assert.notEqual(replacementMesh.geometry, geometry);
    assert.equal(batch.glyphCount, 5);
    assert.equal(replacementMesh.geometry.instanceCount, 5);
    previous.dispose();
  } finally {
    batch.dispose();
    slug.dispose(resource);
  }
});

function committedBatch(layoutValue, resource, paintValue) {
  const stage = slug.stageBatch(undefined, layoutValue, resource, 0, paintValue, 1);
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

function paint(count, color) {
  return { paintIndices: new Uint16Array(count), palette: [{ color }] };
}

function syntheticResource() {
  const records = new Uint8Array(3 * 40);
  writeRecord(records, 0, {
    left: 0,
    bottom: 0,
    right: 1024,
    top: 1536,
    page: 0,
    horizontalBands: 1,
    verticalBands: 2,
    curveBase: 0,
    horizontalHeaderBase: 1,
    verticalHeaderBase: 2,
    referenceBase: 3,
  });
  writeRecord(records, 1, {
    left: 128,
    bottom: 256,
    right: 1792,
    top: 1920,
    page: 0,
    horizontalBands: 3,
    verticalBands: 4,
    curveBase: 5,
    horizontalHeaderBase: 6,
    verticalHeaderBase: 7,
    referenceBase: 8,
  });
  writeRecord(records, 2, {
    left: 64,
    bottom: 96,
    right: 960,
    top: 1408,
    page: 1,
    horizontalBands: 2,
    verticalBands: 3,
    curveBase: 2,
    horizontalHeaderBase: 3,
    verticalHeaderBase: 4,
    referenceBase: 5,
  });
  return {
    planeUnitsPerEm: 2048,
    records,
    pages: [slugPage(), slugPage()],
    gpuBytes: 0,
  };
}

function slugPage() {
  return {
    curveWidth: 4,
    curveHeight: 4,
    curveTexture: texture(new Uint16Array(4 * 4 * 4), 4, 4, THREE.RGBAFormat, THREE.HalfFloatType),
    headerCount: 16,
    headerWidth: 4,
    headerHeight: 4,
    headerTexture: texture(new Uint32Array(16), 4, 4, THREE.RedIntegerFormat, THREE.UnsignedIntType),
    referenceCount: 16,
    referenceWidth: 4,
    referenceHeight: 4,
    referenceTexture: texture(new Uint32Array(16), 4, 4, THREE.RedIntegerFormat, THREE.UnsignedIntType),
    gpuBytes: 0,
  };
}

function texture(data, width, height, format, type) {
  return new THREE.DataTexture(data, width, height, format, type);
}

function writeRecord(records, glyph, values) {
  const view = new DataView(records.buffer, records.byteOffset, records.byteLength);
  const offset = glyph * 40;
  view.setInt16(offset, values.left, true);
  view.setInt16(offset + 2, values.bottom, true);
  view.setInt16(offset + 4, values.right, true);
  view.setInt16(offset + 6, values.top, true);
  view.setUint16(offset + 8, values.page, true);
  view.setUint16(offset + 10, values.horizontalBands, true);
  view.setUint16(offset + 12, values.verticalBands, true);
  view.setUint32(offset + 16, values.curveBase, true);
  view.setUint32(offset + 20, 1, true);
  view.setUint32(offset + 24, values.horizontalHeaderBase, true);
  view.setUint32(offset + 28, values.verticalHeaderBase, true);
  view.setUint32(offset + 32, values.referenceBase, true);
  view.setUint32(offset + 36, 1, true);
}
