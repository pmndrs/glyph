import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { glyph } from '@pmndrs/glyph';
import { defineTechniqueSchema, registerRasterPlanProgram, techniqueProgram, id } from '../../dist/index.js';
import {
  createImmutableFontBacking,
  createImmutableFontLease,
  createImmutableFontVariant,
} from '../../dist/loaded-font.js';
import { FontRegistry } from '../../dist/loader.js';
import { defineRasterResourceId, defineRasterFormat } from '../../dist/raster-format.js';
import { markStorageAttributeUpdated } from '../../dist/three/engine-plan-target.js';
import { registerThreeRasterPlanProgram, ThreeConfig } from '../../dist/three.js';
import { indexedQuadGeometry } from '../support/portable-geometry.mjs';
import * as THREE from 'three/webgpu';

const fixtureUrl = new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);
const ORIGIN_BUFFER_ID = id.buffer('test.three-supplied-geometry/origin');

const suppliedGeometryTechnique = defineRasterFormat({
  id: 'test.three-supplied-geometry',
  kind: 'test',
  extension: 'TEST_three_supplied_geometry',
  version: 0,
  textEffects: [],
  descriptor: () => ({}),
  async decode() {
    return {};
  },
  dispose() {},
});

const suppliedGeometrySchema = defineTechniqueSchema({
  technique: suppliedGeometryTechnique.id,
  scope: 'glyph',
  binding: {},
  buffers: { origin: { id: ORIGIN_BUFFER_ID, scalar: 'f32', lanes: ['x', 'y'] } },
  resources: {
    mesh: {
      kind: 'geometry',
      attributes: [
        { semantic: 'position', componentType: 'f32', components: 3 },
        { semantic: 'uv', componentType: 'f32', components: 2 },
      ],
    },
  },
  glyphOrigin: { buffer: 'origin' },
  render: { resource: 'mesh', geometry: { kind: 'quad', resource: 'mesh', coordinates: 'unit-square' } },
});

registerRasterPlanProgram({
  raster: suppliedGeometryTechnique,
  schema: suppliedGeometrySchema,
  policyBody(system) {
    const program = techniqueProgram(suppliedGeometrySchema, { system });
    return program.compile({ origin: [program.semantics.inlineOrigin, program.semantics.blockOrigin] });
  },
  compileFont(compiler) {
    const { resource, geometry } = compiler.font.data;
    compiler.retain('mesh', resource, geometry);
    return compiler.compile({ strikes: [0], resource: () => resource });
  },
});

registerThreeRasterPlanProgram({
  raster: suppliedGeometryTechnique,
  schema: suppliedGeometrySchema,
  variant: {
    id: 'test-tsl',
    language: 'tsl',
    buffers: { origin: { scalar: 'f32', vectorWidth: 2 } },
    resources: { mesh: { kind: 'geometry' } },
    outputs: { position: 'vec3' },
    geometry: suppliedGeometrySchema.render.geometry,
    createMaterial() {
      return new THREE.MeshBasicNodeMaterial();
    },
  },
});

await glyph.init();

test('sparse detached writes cap upload-range bookkeeping', () => {
  const attribute = new THREE.StorageInstancedBufferAttribute(new Float32Array(160 * 16), 4);
  for (let record = 0; record < 80; record += 2) markStorageAttributeUpdated(attribute, record * 16, 16);
  assert.ok(attribute.updateRanges.length <= 32);
  const coveredStart = Math.min(...attribute.updateRanges.map((range) => range.start));
  const coveredEnd = Math.max(...attribute.updateRanges.map((range) => range.start + range.count));
  assert.equal(coveredStart, 0);
  assert.ok(coveredEnd >= 79 * 16);
  attribute.dispose();
});

test('a custom Three technique realizes supplied geometry through GlyphConfig', async (t) => {
  const registry = new FontRegistry();
  const registered = await registry.registerAsset(await readFile(fixtureUrl));
  const backing = createImmutableFontBacking(registered);
  const resource = defineRasterResourceId('test/three-supplied-geometry/mesh');
  const geometry = indexedQuadGeometry();
  const font = fontVariant(backing, resource, geometry);
  const invalidGeometry = indexedQuadGeometry();
  invalidGeometry.accessors[0].components = 2;
  const invalidFont = fontVariant(
    backing,
    defineRasterResourceId('test/three-supplied-geometry/invalid'),
    invalidGeometry,
  );
  const three = glyph.handle('three:renderer-extension:supplied-geometry', ThreeConfig);
  t.after(() => three.dispose());

  assert.throws(() => three.createText({ font: invalidFont, text: 'invalid' }), /vertex input "position" needs f32x3/u);

  const scene = new THREE.Scene();
  const text = three.createText({ font, text: '12345', style: { fontSize: 16 } });
  scene.add(text);
  scene.updateMatrixWorld(true);
  const retainedDraw = three.drawRoot.children.find((child) => child.isMesh);
  assert.ok(retainedDraw);
  assert.equal(retainedDraw.geometry.instanceCount, 5);
  assert.deepEqual([...retainedDraw.geometry.index.array], [0, 1, 2, 0, 2, 3]);
  assert.deepEqual([...retainedDraw.geometry.getAttribute('position').array], [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
  assert.deepEqual([...retainedDraw.geometry.getAttribute('uv').array], [0, 0, 1, 0, 1, 1, 0, 1]);

  text.text = '12';
  scene.updateMatrixWorld(true);
  assert.equal(
    three.drawRoot.children.find((child) => child.isMesh),
    retainedDraw,
  );
  assert.equal(retainedDraw.geometry.instanceCount, 2);

  text.dispose();
  invalidFont.dispose();
  font.dispose();
});

function fontVariant(backing, resource, geometry) {
  return createImmutableFontLease(
    createImmutableFontVariant({
      backing,
      format: suppliedGeometryTechnique,
      raster: { dispose() {} },
      data: { resource, geometry },
    }),
  );
}
