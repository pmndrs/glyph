import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createTextRuntime, FontRegistry } from '@pmndrs/text';
import { bitmap } from '@pmndrs/text/three/bitmap';
import { bitmapShader, defineTextMaterial, msdfShader, slugShader, Text } from '@pmndrs/text/three';
import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

const fontUrl = new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);

test('the canonical technique shaders are exported as callable node builders', () => {
  assert.equal(typeof bitmapShader, 'function');
  assert.equal(typeof msdfShader, 'function');
  assert.equal(typeof slugShader, 'function');
});

test('a custom Three material composes over the Bitmap shader in the Rust command-buffer draw path', async () => {
  const registry = new FontRegistry();
  const runtime = await createTextRuntime({
    registry,
    wasm: await readFile(new URL('../../dist/text_shaper.wasm', import.meta.url)),
  });
  const font = await runtime.loadFont({
    input: { baked: dataUrl(await readFile(fontUrl)) },
    raster: { technique: bitmap, options: { strikes: [16] } },
  });
  const built = [];
  const material = defineTextMaterial((context) => {
    const composed = context.createDefaultMaterial();
    composed.colorNode = TSL.vec3(context.shader.color.r, 0, context.shader.color.b);
    built.push({ context, material: composed });
    return composed;
  });
  const scene = new THREE.Scene();
  const label = new Text({ font, material, text: 'Composed' });
  scene.add(label);
  scene.updateMatrixWorld();

  assert.equal(label.error, undefined);
  const draws = label.children.filter((child) => child.isMesh);
  assert.equal(draws.length, 1, 'the Rust publication must produce one real custom-material draw');
  assert.equal(built.length, 1, 'the material factory must run once for one retained realization');
  const { context, material: realized } = built[0];
  assert.equal(context.technique, bitmap.id);
  assert.deepEqual(Object.keys(context.shader).sort(), [
    'atlasUv',
    'clipPosition',
    'color',
    'coverage',
    'opacity',
    'position',
  ]);
  for (const [name, node] of Object.entries(context.shader)) {
    assert.ok(node?.isNode === true, `canonical Bitmap output "${name}" must be a TSL node`);
  }
  assert.equal(draws[0].material, realized);

  scene.updateMatrixWorld();
  assert.equal(label.children[0], draws[0], 'an unchanged frame must retain the draw and material realization');
  assert.equal(built.length, 1);

  label.removeFromParent();
  label.dispose();
  font.dispose();
  runtime.dispose();
});

function dataUrl(bytes) {
  return `data:model/gltf-binary;base64,${bytes.toString('base64')}`;
}
