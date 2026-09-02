import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { bitmap } from '@pmndrs/glyph/three/bitmap';
import { defineTextMaterial, FontLoader, Text } from '@pmndrs/glyph/three';
import { bitmapShader, decorationShader, msdfShader, slugShader } from '../../dist/tsl.js';
import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

const fontUrl = new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);

test('the canonical technique shaders are exported as callable node builders', () => {
  assert.equal(typeof bitmapShader, 'function');
  assert.equal(typeof msdfShader, 'function');
  assert.equal(typeof slugShader, 'function');
  assert.equal(typeof decorationShader, 'function');
});

test('a custom Three material composes over the Bitmap shader in the Rust command-buffer draw path', async () => {
  const loader = new FontLoader();
  const font = await loader.loadAsync({
    input: { baked: { bytes: await readFile(fontUrl) } },
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
  assert.equal(context.kind, 'glyph');
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
  loader.dispose();
});

test('the same custom material factory may override a separate decoration realization', async () => {
  const loader = new FontLoader();
  const font = await loader.loadAsync({
    input: { baked: { bytes: await readFile(fontUrl) } },
    raster: { technique: bitmap, options: { strikes: [16] } },
  });
  const realizations = [];
  const material = defineTextMaterial((context) => {
    realizations.push(context.kind === 'glyph' ? context.technique.id : context.kind);
    const realized = context.createDefaultMaterial();
    if (context.kind === 'decoration') realized.colorNode = context.shader.color.mul(0.5);
    return realized;
  });
  const scene = new THREE.Scene();
  const label = new Text({
    font,
    material,
    text: 'Decorated',
    style: { decoration: { underline: true, color: '#ff0088' } },
  });
  scene.add(label);
  scene.updateMatrixWorld();

  assert.equal(label.error, undefined);
  assert.deepEqual(realizations.sort(), ['decoration', 'pmndrs.bitmap']);
  const draws = label.children.filter((child) => child.isMesh);
  assert.equal(draws.length, 2, 'decoration and glyph programs retain separate material realizations');
  assert.equal(new Set(draws.map((draw) => draw.material)).size, 2);

  label.dispose();
  font.dispose();
  loader.dispose();
});

test('Bitmap pixel snapping is an explicit opt-in graph specialization', async () => {
  const loader = new FontLoader();
  const font = await loader.loadAsync({
    input: { baked: { bytes: await readFile(fontUrl) } },
    raster: { technique: bitmap, options: { strikes: [16] } },
  });
  const clipPositions = [];
  const material = defineTextMaterial((context) => {
    clipPositions.push(context.shader.clipPosition);
    return context.createDefaultMaterial();
  });
  const scene = new THREE.Scene();
  const unsnapped = new Text({ font, material, text: 'A' });
  const snapped = new Text({ font, material, pixelSnapping: true, text: 'B' });
  scene.add(unsnapped, snapped);
  scene.updateMatrixWorld();

  assert.equal(clipPositions[0], TSL.modelViewProjection);
  assert.notEqual(clipPositions[1], TSL.modelViewProjection);

  unsnapped.dispose();
  snapped.dispose();
  font.dispose();
  loader.dispose();
});
