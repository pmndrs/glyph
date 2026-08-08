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
  const group = new TextGroup({ technique: bitmap, renderOrder: 12 });
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
  assert.ok(label.layout.glyphIds.length > 0);
  const firstDraws = label.children.filter((child) => child.isMesh);
  assert.ok(firstDraws.length > 0);
  assert.equal(firstDraws[0].renderOrder, 12);

  group.renderOrder = 20;
  scene.updateMatrixWorld();
  assert.equal(firstDraws[0].renderOrder, 20, 'group render order must update existing draw proxies');

  label.renderOrder = 7;
  scene.updateMatrixWorld();
  assert.equal(label.children.filter((child) => child.isMesh)[0].renderOrder, 20);
  assert.equal(label.layout.glyphIds.length, 11, 'render-order-only updates must preserve the shaped paragraph');

  label.text = 'Only the final desired value';
  label.text = 'Updated';
  scene.updateMatrixWorld();
  assert.equal(label.layout.glyphIds.length, 7);
  assert.ok(label.children.some((child) => child.isMesh));
  assert.equal(label.children.filter((child) => child.isMesh)[0], firstDraws[0]);
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

function dataUrl(bytes) {
  return `data:model/gltf-binary;base64,${bytes.toString('base64')}`;
}
