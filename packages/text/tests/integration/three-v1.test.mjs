import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createRuntimeShaper, createTextRuntime, FontRegistry } from '@pmndrs/text';
import { bitmap } from '@pmndrs/text/three/bitmap';
import { Text, TextGroup } from '@pmndrs/text/three';
import * as THREE from 'three/webgpu';

const fontUrl = new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);

test('Three Text and TextGroup late-bind, synchronize, reparent, and dispose through the scene graph', async () => {
  const registry = new FontRegistry();
  const shaper = await createRuntimeShaper({
    registry,
    wasm: await readFile(new URL('../../dist/text_shaper.wasm', import.meta.url)),
  });
  const runtime = await createTextRuntime({ registry, shaper });
  const font = await runtime.loadFont({
    input: { baked: dataUrl(await readFile(fontUrl)) },
    raster: { technique: bitmap, options: { strikes: [16] } },
  });

  const scene = new THREE.Scene();
  const group = new TextGroup({ renderOrder: 12 });
  const container = new THREE.Object3D();
  const label = new Text({ font, text: 'First frame' });
  container.add(label);
  group.add(container);
  scene.add(group);

  assert.equal(label.bound, false, 'construction and add must not shape eagerly');
  scene.updateMatrixWorld();
  assert.equal(label.bound, true);
  assert.equal(label.textGroup, group);
  assert.equal(group.textCount, 1);
  assert.equal(label.layout, undefined, 'rendering must not materialize layout readback');
  assert.equal(group.error, undefined);
  const firstDraws = group.children.filter((child) => child.isMesh);
  assert.ok(firstDraws.length > 0);
  assert.equal(firstDraws[0].geometry.instanceCount, 10, 'the GPU plan omits the non-rendering space glyph');
  assert.equal(firstDraws[0].renderOrder, 12);

  group.renderOrder = 20;
  scene.updateMatrixWorld();
  assert.equal(firstDraws[0].renderOrder, 20, 'group render order must update existing draw proxies');

  label.renderOrder = 7;
  scene.updateMatrixWorld();
  assert.equal(group.children.filter((child) => child.isMesh)[0].renderOrder, 20);
  assert.equal(firstDraws[0].geometry.instanceCount, 10, 'render-order-only updates must preserve the Rust plan');

  label.text = 'Only the final desired value';
  label.text = 'Updated';
  scene.updateMatrixWorld();
  assert.equal(label.layout, undefined);
  assert.ok(group.children.some((child) => child.isMesh));
  assert.equal(group.children.filter((child) => child.isMesh)[0], firstDraws[0]);
  assert.equal(
    firstDraws[0].geometry.instanceCount,
    7,
    'compatible revisions must retain draws and resize live counts',
  );

  scene.add(label);
  scene.updateMatrixWorld();
  assert.equal(label.textGroup, undefined);
  assert.equal(label.bound, true, 'a directly attached Text must own an implicit batch');
  assert.equal(group.textCount, 0);

  group.add(label);
  scene.updateMatrixWorld();
  group.dispose();
  assert.equal(group.disposed, true);
  assert.equal(label.disposed, false);
  assert.equal(label.bound, false);
  assert.equal(label.textGroup, undefined);

  scene.add(label);
  scene.updateMatrixWorld();
  assert.equal(label.bound, true, 'text retained by a disposed group can bind elsewhere');

  label.removeFromParent();
  label.dispose();
  font.dispose();
  runtime.dispose();
});

test('TextGroup realizes two public Text objects as one indexed Rust draw', async () => {
  const registry = new FontRegistry();
  const shaper = await createRuntimeShaper({
    registry,
    wasm: await readFile(new URL('../../dist/text_shaper.wasm', import.meta.url)),
  });
  const runtime = await createTextRuntime({ registry, shaper });
  const font = await runtime.loadFont({
    input: { baked: dataUrl(await readFile(fontUrl)) },
    raster: { technique: bitmap, options: { strikes: [16] } },
  });
  const scene = new THREE.Scene();
  const group = new TextGroup({ renderOrder: 3 });
  const left = new Text({ font, text: 'AB' });
  const right = new Text({ font, text: 'CD' });
  left.position.x = 2;
  right.position.x = 5;
  group.add(left, right);
  scene.add(group);
  scene.updateMatrixWorld();

  assert.equal(group.error, undefined);
  const draws = group.children.filter((child) => child.isMesh);
  assert.equal(draws.length, 1, 'compatible paragraphs must batch in Rust before Three sees the plan');
  assert.equal(draws[0].geometry.instanceCount, 4);
  const start = draws[0].userData.pmndrsTextRunStart;
  const indices = draws[0].geometry.getAttribute('_pmndrsText_15').array;
  assert.deepEqual(Array.from(indices.subarray(start, start + 4)), [1, 1, 2, 2]);
  const transforms = draws[0].geometry.getAttribute('_pmndrsTextTransforms');
  assert.equal(transforms.array[1 * 16 + 12], 2);
  assert.equal(transforms.array[2 * 16 + 12], 5);

  const version = transforms.version;
  right.position.x = 7;
  scene.updateMatrixWorld();
  assert.equal(group.children.filter((child) => child.isMesh)[0], draws[0]);
  assert.equal(transforms.version, version + 1);
  assert.equal(transforms.array[2 * 16 + 12], 7);

  group.dispose();
  left.dispose();
  right.dispose();
  font.dispose();
  runtime.dispose();
});

function dataUrl(bytes) {
  return `data:model/gltf-binary;base64,${bytes.toString('base64')}`;
}
