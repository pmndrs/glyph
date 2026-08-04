import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three/webgpu';
import { bitmap } from '../../dist/raster/bitmap.js';

const bitmapModule = bitmap({ strikes: [16] }).module;

test('Bitmap retains every instance field within capacity and replaces changed run topology or overflow', () => {
  const resource = syntheticResource();
  const initialLayout = layout([0, 0, 0], 1, 2, 16);
  let batch = committedBatch(initialLayout, resource, paint(3, [0.1, 0.2, 0.3, 0.4]));
  try {
    const mesh = batch.object.children[0];
    assert.ok(mesh);
    const geometry = mesh.geometry;
    const material = mesh.material;
    const attributes = bitmapAttributes(geometry);
    const arrays = Object.fromEntries(Object.entries(attributes).map(([name, attribute]) => [name, attribute.array]));
    const initialValues = Object.fromEntries(
      Object.entries(arrays).map(([name, values]) => [name, Array.from(values)]),
    );
    assert.equal(batch.glyphCount, 3);
    assert.equal(batch.drawCount, 1);
    assert.equal(geometry.instanceCount, 3);
    assert.equal(batch.object.isGroup, undefined);
    batch.setRenderOrderBase(600);
    assert.equal(mesh.renderOrder, 600);
    for (const attribute of Object.values(attributes)) assert.equal(attribute.usage, THREE.DynamicDrawUsage);

    const replacementLayout = layout([1, 1, 1], 9, 11, 32);
    const replacement = bitmapModule.stageBatch(
      batch,
      replacementLayout,
      resource,
      0,
      paint(3, [0.6, 0.5, 0.4, 0.3]),
      1,
    );
    assert.equal(replacement.batch, batch);
    assert.equal(batch.glyphCount, 3, 'staging preserves the live logical count');
    for (const [name, values] of Object.entries(arrays)) {
      assert.deepEqual(Array.from(values), initialValues[name], `staging preserves live ${name} data`);
    }
    replacement.commit();

    assert.equal(batch.object.children[0], mesh);
    assert.equal(mesh.geometry, geometry);
    assert.equal(mesh.material, material);
    assert.equal(batch.glyphCount, 3);
    assert.equal(geometry.instanceCount, 3);
    assert.equal(batch.object.isGroup, undefined, 'retained replacement keeps a neutral root');
    assert.equal(mesh.renderOrder, 600, 'retained replacement preserves the Text-local order');
    for (const [name, attribute] of Object.entries(bitmapAttributes(geometry))) {
      assert.equal(attribute, attributes[name], `retains ${name} attribute identity`);
      assert.equal(attribute.array, arrays[name], `retains ${name} backing allocation`);
      assert.notDeepEqual(Array.from(attribute.array), initialValues[name], `updates ${name} values`);
      assert.deepEqual(attribute.updateRanges, [{ start: 0, count: 3 * attribute.itemSize }]);
    }

    const externalOrigin = attributes.origin;
    externalOrigin.setXY(0, 123, 456);
    const colorOnly = bitmapModule.stageBatch(batch, replacementLayout, resource, 0, paint(3, [0.2, 0.3, 0.4, 0.5]), 1);
    colorOnly.commit();
    assert.deepEqual([externalOrigin.getX(0), externalOrigin.getY(0)], [123, 456]);

    const shrunk = bitmapModule.stageBatch(
      batch,
      layout([0, 1], 3, 5, 20),
      resource,
      0,
      paint(2, [0.4, 0.3, 0.2, 0.1]),
      1,
    );
    assert.equal(shrunk.batch, batch);
    shrunk.commit();
    assert.equal(batch.glyphCount, 2);
    assert.equal(geometry.instanceCount, 2);
    for (const [name, attribute] of Object.entries(bitmapAttributes(geometry))) {
      assert.equal(attribute.array, arrays[name], `shrink retains ${name} allocation`);
    }

    const exactCapacity = bitmapModule.stageBatch(
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
    for (const [name, attribute] of Object.entries(bitmapAttributes(geometry))) {
      assert.equal(attribute.array, arrays[name], `exact-capacity growth retains ${name} allocation`);
    }

    const liveValues = Object.fromEntries(Object.entries(arrays).map(([name, values]) => [name, Array.from(values)]));
    const aborted = bitmapModule.stageBatch(
      batch,
      layout([0, 1, 0], 7, 8, 18),
      resource,
      0,
      paint(3, [0.7, 0.6, 0.5, 0.4]),
      1,
    );
    assert.equal(aborted.batch, batch);
    aborted.abort();
    assert.equal(batch.glyphCount, 4);
    assert.equal(geometry.instanceCount, 4);
    for (const [name, values] of Object.entries(arrays)) {
      assert.deepEqual(Array.from(values), liveValues[name], `retained abort preserves ${name}`);
    }

    const changedTopology = bitmapModule.stageBatch(
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

    const overflow = bitmapModule.stageBatch(
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
    bitmapModule.dispose(resource);
  }
});

function committedBatch(layoutValue, resource, paintValue) {
  const stage = bitmapModule.stageBatch(undefined, layoutValue, resource, 0, paintValue, 1);
  stage.commit();
  return stage.batch;
}

function bitmapAttributes(geometry) {
  return {
    origin: geometry.getAttribute('bitmapOrigin'),
    size: geometry.getAttribute('bitmapSize'),
    uvOrigin: geometry.getAttribute('bitmapUvOrigin'),
    uvSize: geometry.getAttribute('bitmapUvSize'),
    color: geometry.getAttribute('bitmapColor'),
  };
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
  const records = new Uint8Array(3 * 20);
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
    atlasRight: 3,
    atlasBottom: 4,
    page: 0,
  });
  writeRecord(records, 2, {
    left: 2,
    bottom: 3,
    right: 14,
    top: 19,
    atlasLeft: 0,
    atlasTop: 0,
    atlasRight: 2,
    atlasBottom: 2,
    page: 1,
  });
  return {
    strikes: [
      {
        ppem: 16,
        planeUnitsPerEm: 16,
        records,
        pages: [bitmapPage(4, 8), bitmapPage(2, 2)],
      },
    ],
  };
}

function bitmapPage(width, height) {
  return {
    width,
    height,
    texture: new THREE.DataTexture(new Uint8Array(width * height), width, height, THREE.RedFormat),
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
