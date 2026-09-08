import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { glyph } from '@pmndrs/glyph';
import * as stableThree from '@pmndrs/glyph/three';
import * as experimentalThree from '@pmndrs/glyph/three/typegpu';
import { bitmap } from '@pmndrs/glyph/raster/bitmap';
import { createThreeTestHandle } from '../support/three-handle.mjs';

import * as d from 'typegpu/data';
import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

import { bitmapShader, decorationShader, msdfShader } from '../../dist/three/typegpu.js';
import { msdfPosition } from '../../dist/shaders/msdf-shader.js';
import { compileNodeMaterialBackends } from '../support/node-material-shaders.mjs';

test('MTSDF placement converts downward paragraph y to upward Three y', () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(msdfPosition(d.vec2f(13.5, 7.25), d.vec2f(21, 34), d.vec3f(0.25, 0.75, 0)))),
    [18.75, -32.75, 0],
  );
});

test('the Bitmap Three adapter captures its texture instead of passing it to a GLSL function', () => {
  const page = new THREE.DataArrayTexture(new Uint8Array(4 * 4), 4, 4, 1);
  page.format = THREE.RedFormat;
  const output = bitmapShader(
    {
      origin: TSL.vec2(0),
      size: TSL.vec2(1),
      uvOrigin: TSL.vec2(0),
      uvSize: TSL.vec2(1),
      color: TSL.vec4(1),
      pageIndex: TSL.uint(0),
    },
    { page },
  );
  withMaterial(output, (mesh) => {
    const backends = compileNodeMaterialBackends(mesh);
    const { fragment } = backends.webgl2;
    assert.doesNotMatch(fragment, /texture_\w+</);
    assert.doesNotMatch(fragment, /bitmapPageCoverage\s*\(/);
    assert.match(fragment, /texelFetch\s*\([^,]+,\s*ivec3\s*\([^)]+\),\s*int\s*\(\s*0(?:\.0)?\s*\)\s*\)/);
    assert.doesNotMatch(fragment, /texelFetch\s*\([^,]+,\s*uvec2/);
    assert.doesNotMatch(fragment, /uvec2\s+\w+\s*=\s*textureSize\s*\(/);
    assert.doesNotMatch(fragment, /ivec2\s+\w+\s*=\s*item_\w*\s*\(\s*\)/);
    assert.doesNotMatch(backends.webgpu.fragment, /vec3<u32>\s*\(\s*vec2<f32>\s*\(\s*textureDimensions/);
  });
  page.dispose();
});

test('the MTSDF Three adapter compiles the canonical TypeGPU functions on both backends', () => {
  const atlas = new THREE.DataArrayTexture(new Uint8Array(4 * 4 * 4), 4, 4, 1);
  atlas.format = THREE.RGBAFormat;
  const output = msdfShader(
    {
      origin: TSL.vec2(0),
      size: TSL.vec2(1),
      uvOrigin: TSL.vec2(0),
      uvSize: TSL.vec2(1),
      uvBounds: TSL.vec4(0, 0, 1, 1),
      fillColor: TSL.vec4(1),
      effectColor: TSL.uvec2(0xffffffff, 0),
      shadowOffset: TSL.vec2(0),
      outlineWidth: TSL.float(0),
      pageIndex: TSL.float(0),
    },
    { atlas, atlasWidth: 4, atlasHeight: 4, pixelRange: 4 },
  );
  withMaterial(output, (mesh) => {
    for (const [backend, source] of Object.entries(compileNodeMaterialBackends(mesh))) {
      assert.match(source.fragment, backend === 'webgpu' ? /dpdx\s*\(/ : /dFdx\s*\(/);
      assert.match(source.fragment, backend === 'webgpu' ? /dpdy\s*\(/ : /dFdy\s*\(/);
      assert.match(source.fragment, backend === 'webgpu' ? /inverseSqrt\s*\(/ : /inversesqrt\s*\(/);
      assert.doesNotMatch(source.fragment, /fwidth\(/, 'MTSDF must retain its rotation-invariant derivative norm');
      if (backend === 'webgl2') assert.doesNotMatch(source.fragment, /\b(?:dpdx|dpdy|inverseSqrt)\s*\(/);
      for (const name of [
        'msdfPosition',
        'msdfAtlasCoordinate',
        'msdfClampedCoordinates',
        'msdfCoverage',
        'msdfComposite',
      ]) {
        assert.equal(declarationCount(`${source.vertex}\n${source.fragment}`, name, backend), 1);
      }
    }
  });
  atlas.dispose();
});

test('the decoration Three adapter compiles the canonical TypeGPU functions on both backends', () => {
  const output = decorationShader({ rect: TSL.vec4(0, 0, 1, 1), packed: TSL.uvec2(0xffffffff, 0) });
  withMaterial(output, (mesh) => {
    for (const [backend, source] of Object.entries(compileNodeMaterialBackends(mesh))) {
      const program = `${source.vertex}\n${source.fragment}`;
      for (const name of ['decorationPosition', 'decorationPaint', 'srgbChannelToLinear']) {
        assert.equal(declarationCount(program, name, backend), 1);
      }
    }
  });
});

function withMaterial(output, body) {
  const material = new THREE.MeshBasicNodeMaterial({ transparent: true });
  material.positionNode = output.position;
  material.colorNode = output.color;
  material.opacityNode = output.opacity;
  const geometry = new THREE.PlaneGeometry(1, 1);
  const mesh = new THREE.Mesh(geometry, material);
  try {
    body(mesh);
  } finally {
    geometry.dispose();
    material.dispose();
  }
}

function declarationCount(source, name, backend) {
  const declaration = backend === 'webgpu' ? `^fn ${name}\\(` : `^\\w+ ${name}\\(`;
  return (source.match(new RegExp(declaration, 'gm')) ?? []).length;
}

test('stable and experimental handles retain independent shader selection in one scene', async (t) => {
  assert.equal(experimentalThree.Text, stableThree.Text);
  assert.equal(experimentalThree.TextGroup, stableThree.TextGroup);
  const stable = await createThreeTestHandle(t, stableThree.ThreeConfig);
  const experimental = await createThreeTestHandle(t, experimentalThree.ThreeConfig);
  const font = glyph.fontFace(
    new Blob([
      await readFile(
        new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url),
      ),
    ]),
    { format: bitmap({ strikes: [16] }) },
  );
  await font.load();
  t.after(() => font.dispose());
  const scene = new THREE.Scene();
  const stableText = stable.createText({ font, text: 'Stable' });
  const experimentalText = experimental.createText({ font, text: 'Experimental' });
  scene.add(stableText, experimentalText);
  scene.updateMatrixWorld();
  const draws = [];
  scene.traverse((object) => {
    if (object.isMesh) draws.push(object);
  });
  assert.equal(draws.length, 2);
  const programs = draws.map((mesh) => compileNodeMaterialBackends(mesh, { scene }).webgpu.vertex);
  assert.equal(programs.filter((source) => /fn bitmapQuadPosition\(/.test(source)).length, 1);
  experimental.dispose();
  stableText.text = 'Still stable';
  scene.updateMatrixWorld();
  assert.equal(stableText.error, undefined);
  const remaining = [];
  scene.traverse((object) => {
    if (object.isMesh) remaining.push(object);
  });
  assert.equal(remaining.length, 1);
  assert.doesNotMatch(compileNodeMaterialBackends(remaining[0], { scene }).webgpu.vertex, /fn bitmapQuadPosition\(/);
});

test('stable and experimental Three configs share the custom material override contract', async (t) => {
  const font = glyph.fontFace(
    new Blob([
      await readFile(
        new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url),
      ),
    ]),
    { format: bitmap({ strikes: [16] }) },
  );
  await font.load();
  t.after(() => font.dispose());
  const contracts = [];

  for (const [name, config] of [
    ['stable', stableThree.ThreeConfig],
    ['experimental', experimentalThree.ThreeConfig],
  ]) {
    const handle = await createThreeTestHandle(t, config);
    const seen = [];
    const material = stableThree.defineTextMaterial((context) => {
      const realized = context.createDefaultMaterial();
      if (context.kind === 'glyph') {
        realized.colorNode = TSL.vec3(context.shader.color.r, 0, context.shader.color.b);
        seen.push({ kind: context.format, shader: Object.keys(context.shader).sort() });
      } else {
        realized.colorNode = context.shader.color.mul(0.5);
        seen.push({ kind: context.kind, shader: Object.keys(context.shader).sort() });
      }
      return realized;
    });
    const scene = new THREE.Scene();
    const label = handle.createText({
      font,
      material,
      text: name,
      style: { decoration: { underline: true, color: '#ff0088' } },
    });
    scene.add(label);
    scene.updateMatrixWorld();

    assert.equal(label.error, undefined);
    const draws = [];
    scene.traverse((object) => {
      if (object.isMesh) draws.push(object);
    });
    assert.equal(draws.length, 2, `${name} config must realize separate glyph and decoration draws`);
    assert.equal(new Set(draws.map((draw) => draw.material)).size, 2);
    contracts.push(seen.sort((left, right) => left.kind.localeCompare(right.kind)));
    label.dispose();
  }

  assert.deepEqual(contracts[1], contracts[0]);
});
