import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Worker } from 'node:worker_threads';

import { glyph } from '@pmndrs/glyph';
import { bitmap } from '@pmndrs/glyph/raster/bitmap';
import '../support/browser-globals.mjs';

const fontUrl = new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);
const bytes = await readFile(fontUrl);

test('FontFace loading and explicit cloning do not initialize the Glyph engine', async () => {
  assert.equal(glyph.initialized, false);
  const face = glyph.fontFace(new Blob([bytes], { type: 'model/gltf-binary' }), {
    family: 'FontFaceBeforeInit',
    format: bitmap({ strikes: [16] }),
  });
  try {
    const [serialized, transfer] = await face.bitmap.clone();
    assert.equal(glyph.initialized, false);
    assert.equal(serialized.rasters.length, 1);
    assert.ok(transfer.includes(serialized.data));
  } finally {
    face.dispose();
  }
});

test('an explicit FontFace clone transfers to a Worker and reconstructs without fetching or initializing Glyph', async () => {
  assert.equal(glyph.initialized, false);
  const face = glyph.fontFace(new Blob([bytes], { type: 'model/gltf-binary' }), {
    family: 'FontFaceWorkerTransfer',
    format: bitmap({ strikes: [16] }),
  });
  const worker = new Worker(new URL('../support/font-face-transfer-worker.mjs', import.meta.url));
  try {
    const [serialized, transfer] = await face.bitmap.clone();
    const result = new Promise((resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
    });
    worker.postMessage(serialized, transfer);

    assert.equal(serialized.data.byteLength, 0);
    for (const raster of serialized.rasters) assert.equal(raster.data?.byteLength ?? 0, 0);
    for (const resource of serialized.resources) assert.equal(resource.data.byteLength, 0);
    const received = await result;
    assert.equal(received.error, undefined);
    assert.deepEqual(received, {
      initialized: false,
      sameSelection: true,
      loaded: true,
      formats: ['bitmap'],
    });
    assert.equal(glyph.initialized, false);
  } finally {
    await worker.terminate();
    face.dispose();
  }
});
