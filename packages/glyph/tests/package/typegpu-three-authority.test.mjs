import assert from 'node:assert/strict';
import test from 'node:test';

import * as d from 'typegpu/data';
import * as TSL from 'three/tsl';
import * as THREE from 'three/webgpu';

import { bitmapShader, decorationShader, msdfShader } from '../../dist/tsl.js';
import { msdfPosition } from '../../dist/typegpu/msdf-shader.js';
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
