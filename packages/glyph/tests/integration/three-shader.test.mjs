import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { loadFont } from '../../dist/loader.js';
import { bitmap, slug } from '@pmndrs/glyph';
import { defineTextMaterial } from '@pmndrs/glyph/three';
import { defineThreeConfig as defineTypeGpuThreeConfig } from '@pmndrs/glyph/three/typegpu';
import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

import { createThreeTestHandle } from '../support/three-handle.mjs';
import { compileNodeMaterialBackends } from '../support/node-material-shaders.mjs';

const fontUrl = new URL('../../../../benches/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);
const slugFontUrl = new URL('../../../../benches/fixtures/rendering/inter-slug.font.glb.gz', import.meta.url);

test('Slug material positions stay vertex-computed when a composed fragment reads both coordinate spaces', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFont({ baked: { bytes: gunzipSync(await readFile(slugFontUrl)) } }, slug);
  const contexts = [];
  const material = defineTextMaterial((context) => {
    contexts.push(context);
    const composed = context.createDefaultMaterial();
    composed.colorNode = TSL.vec3(context.position.x, context.paragraphPosition.y, 0);
    return composed;
  });
  const scene = new THREE.Scene();
  const label = three.createText({ font, material, text: 'A' });
  scene.add(label);
  scene.updateMatrixWorld();

  assert.equal(label.error, undefined);
  assert.equal(contexts.length, 1);
  const draw = rootDraws(scene)[0];
  assert.ok(draw, 'a real Slug draw must reach material realization');
  for (const [backend, stages] of Object.entries(compileNodeMaterialBackends(draw, { scene }))) {
    assert.match(stages.vertex, /pmndrsSlugRenderCoordinate/);
    assert.match(stages.fragment, /pmndrsSlugRenderCoordinate/);
    assert.doesNotMatch(
      stages.fragment,
      /pmndrsSlugRenderCoordinate\s*=/,
      `${backend} must consume Slug's interpolated coordinate without assigning a fragment input`,
    );
  }

  label.dispose();
  font.dispose();
});

test('TypeGPU-backed default Bitmap and decoration positions compile for both Three backends', async (t) => {
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  try {
    for (const transformMode of ['direct', 'indexed']) {
      await t.test(transformMode, async (subtest) => {
        const three = await createThreeTestHandle(subtest, defineTypeGpuThreeConfig({ transformMode }));
        const scene = new THREE.Scene();
        const label = three.createText({
          font,
          text: 'Default',
          style: { decoration: { underline: true, color: '#ff0088' } },
        });
        scene.add(label);
        scene.updateMatrixWorld();
        assert.equal(label.error, undefined);
        const draws = rootDraws(scene);
        assert.equal(draws.length, 2);
        const vertices = draws.map((draw) => {
          const stages = compileNodeMaterialBackends(draw, { scene });
          assert.ok(stages.webgpu.vertex.length > 0);
          return stages.webgl2.vertex;
        });
        assert.ok(vertices.some((vertex) => vertex.includes('bitmapQuadPosition')));
        assert.ok(vertices.some((vertex) => vertex.includes('decorationPosition')));
        for (const vertex of vertices) {
          assert.doesNotMatch(vertex, /null\./, 'a vertex builtin must not lower to null');
          assert.doesNotMatch(vertex, /,\s*\)/, 'a vertex builtin must not lower to an empty argument');
        }
        label.dispose();
      });
    }
  } finally {
    font.dispose();
  }
});

test('a custom Three material composes over the Bitmap shader in the Rust command-buffer draw path', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  const built = [];
  const material = defineTextMaterial((context) => {
    const composed = context.createDefaultMaterial();
    composed.colorNode = TSL.vec3(context.shader.color.r, 0, context.shader.color.b);
    built.push({ context, material: composed });
    return composed;
  });
  const scene = new THREE.Scene();
  const label = three.createText({ font, material, text: 'Composed' });
  scene.add(label);
  scene.updateMatrixWorld();

  assert.equal(label.error, undefined);
  const draws = rootDraws(scene);
  assert.equal(draws.length, 1, 'the Rust publication must produce one real custom-material draw');
  assert.equal(built.length, 1, 'the material factory must run once for one retained realization');
  const { context, material: realized } = built[0];
  assert.equal(context.kind, 'glyph');
  assert.equal(context.format, bitmap.id);
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
  assert.equal(rootDraws(scene)[0], draws[0], 'an unchanged frame must retain the draw and material realization');
  assert.equal(built.length, 1);

  label.removeFromParent();
  label.dispose();
  font.dispose();
});

test('the same custom material factory may override a separate decoration realization', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  const realizations = [];
  const material = defineTextMaterial((context) => {
    realizations.push(context.kind === 'glyph' ? context.format : context.kind);
    const realized = context.createDefaultMaterial();
    if (context.kind === 'decoration') realized.colorNode = context.shader.color.mul(0.5);
    return realized;
  });
  const scene = new THREE.Scene();
  const label = three.createText({
    font,
    material,
    text: 'Decorated',
    style: { decoration: { underline: true, color: '#ff0088' } },
  });
  scene.add(label);
  scene.updateMatrixWorld();

  assert.equal(label.error, undefined);
  assert.deepEqual(realizations.sort(), ['decoration', 'pmndrs.bitmap']);
  const draws = rootDraws(scene);
  assert.equal(draws.length, 2, 'decoration and glyph programs retain separate material realizations');
  assert.equal(new Set(draws.map((draw) => draw.material)).size, 2);

  label.dispose();
  font.dispose();
});

test('an undefined custom material result falls back to one retained default material', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  let attempts = 0;
  const material = defineTextMaterial((context) => {
    attempts++;
    assert.equal(context.format, bitmap.id);
    assert.ok(context.paragraphPosition?.isNode);
    assert.ok(context.position?.isNode);
    return undefined;
  });
  const scene = new THREE.Scene();
  const label = three.createText({ font, material, text: 'Fallback' });
  scene.add(label);
  scene.updateMatrixWorld();

  assert.equal(label.error, undefined);
  const draw = rootDraws(scene)[0];
  assert.ok(draw?.material?.isNodeMaterial);
  assert.equal(attempts, 1);
  scene.updateMatrixWorld();
  assert.equal(rootDraws(scene)[0]?.material, draw.material);
  assert.equal(attempts, 1);

  label.dispose();
  font.dispose();
});

test('Bitmap pixel snapping is an explicit opt-in graph specialization', async (t) => {
  const three = await createThreeTestHandle(t);
  const font = await loadFont({ baked: { bytes: await readFile(fontUrl) } }, bitmap({ strikes: [16] }));
  const clipPositions = [];
  const material = defineTextMaterial((context) => {
    clipPositions.push(context.shader.clipPosition);
    return context.createDefaultMaterial();
  });
  const scene = new THREE.Scene();
  const unsnapped = three.createText({ font, material, text: 'A' });
  const snapped = three.createText({ font, material, pixelSnapping: true, text: 'B' });
  scene.add(unsnapped, snapped);
  scene.updateMatrixWorld();

  assert.equal(clipPositions[0], TSL.modelViewProjection);
  assert.notEqual(clipPositions[1], TSL.modelViewProjection);

  unsnapped.dispose();
  snapped.dispose();
  font.dispose();
});

function rootDraws(scene) {
  return scene.getObjectByName('@pmndrs/glyph:anonymous')?.children.filter((child) => child.isMesh) ?? [];
}
