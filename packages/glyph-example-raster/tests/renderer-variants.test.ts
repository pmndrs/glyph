import { registerThreeRasterProgram } from '@pmndrs/glyph/three';
import tgpu from 'typegpu';
import * as d from 'typegpu/data';
import { afterAll, expect, test } from 'vitest';
import { positionLocal, storage, uint, uv } from 'three/tsl';
import * as THREE from 'three/webgpu';

import { glyphExampleCodec, glyphExampleSchema, glyphExampleShaderContract } from '@pmndrs/glyph-example-raster';
import { glyphExampleTslShader, glyphExampleTslVariant } from '@pmndrs/glyph-example-raster/tsl';
import {
  glyphExampleTypeGpuVariant,
  glyphExampleFragment,
  glyphExampleVertex,
  TypeGpuGlyphExampleFragmentInput,
  TypeGpuGlyphExampleVertexInput,
} from '@pmndrs/glyph-example-raster/typegpu';

import { glyphExampleRendererLanguageFixtures } from './renderer-language-fixture.js';

const materials: THREE.NodeMaterial[] = [];

test('renderer languages share one exact portable shader contract', () => {
  expect(glyphExampleRendererLanguageFixtures.map((variant) => variant.language)).toEqual([
    'typegpu',
    'tsl',
    'wgsl',
    'glsl',
  ]);
  for (const variant of glyphExampleRendererLanguageFixtures) {
    expect(variant.techniqueId).toBe(glyphExampleShaderContract.techniqueId);
    expect(variant.geometry).toBe(glyphExampleShaderContract.geometry);
    expect(variant.buffers).toBe(glyphExampleShaderContract.buffers);
    expect(variant.resources).toBe(glyphExampleShaderContract.resources);
    expect(variant.outputs).toBe(glyphExampleShaderContract.outputs);
  }
});

test('a Three consumer manually registers the example TSL realization', () => {
  expect(glyphExampleTslVariant.language).toBe('tsl');
  expect(glyphExampleTslVariant.techniqueId).toBe(glyphExampleCodec.raster.id);

  const program = {
    raster: glyphExampleCodec.raster,
    schema: glyphExampleCodec.schema,
    variant: {
      id: 'tsl',
      language: 'tsl',
      buffers: glyphExampleTslVariant.buffers,
      resources: glyphExampleTslVariant.resources,
      outputs: glyphExampleTslVariant.outputs,
      geometry: glyphExampleTslVariant.geometry,
      createMaterial(context: import('@pmndrs/glyph/three').ThreeRasterMaterialContext) {
        if (context.material !== undefined) throw new TypeError('glyph-example test expects the default material');
        const origin = context.namedBuffers.get('origin');
        const size = context.namedBuffers.get('size');
        const color = context.namedBuffers.get('color');
        if (
          origin?.scalarType !== 'f32' ||
          origin.vectorWidth !== 2 ||
          size?.scalarType !== 'f32' ||
          size.vectorWidth !== 2 ||
          color?.scalarType !== 'f32' ||
          color.vectorWidth !== 4
        ) {
          throw new TypeError('glyph-example TSL registration received incompatible buffers');
        }
        const shader = glyphExampleTslShader({
          origin: storage(origin.attribute, 'vec2', origin.attribute.count).element(context.instance),
          size: storage(size.attribute, 'vec2', size.attribute.count).element(context.instance),
          color: storage(color.attribute, 'vec4', color.attribute.count).element(context.instance),
          quadPosition: positionLocal,
          quadUv: uv(),
          transformPosition: context.transformPosition,
        });
        const material = new THREE.MeshBasicNodeMaterial({ transparent: true });
        material.positionNode = shader.position;
        material.colorNode = shader.color;
        material.opacityNode = shader.opacity;
        materials.push(material);
        return material;
      },
    },
  };

  registerThreeRasterProgram(program);
  registerThreeRasterProgram(program);
  const attribute = new THREE.StorageInstancedBufferAttribute(new Float32Array(4), 2);
  const namedBuffers = new Map([
    ['origin', { scalarType: 'f32' as const, vectorWidth: 2, attribute }],
    ['size', { scalarType: 'f32' as const, vectorWidth: 2, attribute }],
    ['color', { scalarType: 'f32' as const, vectorWidth: 4, attribute }],
  ]);
  const material = program.variant.createMaterial({
    raster: glyphExampleCodec.raster,
    schema: glyphExampleCodec.schema,
    variantId: 'tsl',
    language: 'tsl',
    outputTypes: glyphExampleTslVariant.outputs,
    namedBuffers,
    namedResources: new Map(),
    resourceName: 'glyphColors',
    instance: uint(0),
    material: undefined,
    root: { name: undefined, scene: undefined, drawRoot: new THREE.Object3D() },
    transformPosition: (position) => position,
  });
  expect(material).toBeInstanceOf(THREE.MeshBasicNodeMaterial);
});

test('the TypeGPU realization matches the same contract and resolves to WGSL', () => {
  expect(glyphExampleTypeGpuVariant).toMatchObject({
    language: 'typegpu',
    techniqueId: glyphExampleTslVariant.techniqueId,
    geometry: glyphExampleTslVariant.geometry,
    buffers: glyphExampleTslVariant.buffers,
  });
  expect(glyphExampleShaderContract).toMatchObject({
    techniqueId: glyphExampleCodec.raster.id,
    geometry: glyphExampleSchema.render?.geometry,
    buffers: {
      origin: { id: glyphExampleSchema.buffers.origin.id, vectorWidth: glyphExampleSchema.buffers.origin.lanes.length },
      size: { id: glyphExampleSchema.buffers.size.id, vectorWidth: glyphExampleSchema.buffers.size.lanes.length },
      color: { id: glyphExampleSchema.buffers.color.id, vectorWidth: glyphExampleSchema.buffers.color.lanes.length },
    },
  });
  expect(tgpu.resolve([glyphExampleVertex])).toContain('fn glyphExampleVertex(');
  expect(tgpu.resolve([glyphExampleFragment])).toContain('fn glyphExampleFragment(');
  const output = tgpu['~unstable'].simulate(() =>
    glyphExampleVertex(
      TypeGpuGlyphExampleVertexInput({
        quadPosition: d.vec2f(0.25, 0.75),
        quadUv: d.vec2f(0.25, 0.75),
        instance: { origin: d.vec2f(10, 20), size: d.vec2f(30, 40), color: d.vec4f(1, 0.5, 0.25, 1) },
      }),
    ),
  ).value;
  expect([...output.position]).toEqual([17.5, -50, 0]);
  expect([...output.quadUv]).toEqual([0.25, 0.75]);
  const fragment = tgpu['~unstable'].simulate(() =>
    glyphExampleFragment(
      TypeGpuGlyphExampleFragmentInput({ color: d.vec4f(1, 0.5, 0.25, 1), quadUv: d.vec2f(0.25, 0.75) }),
    ),
  ).value;
  expect([...fragment]).toEqual([1, 0.5, 0.25, 0]);
  const corner = tgpu['~unstable'].simulate(() =>
    glyphExampleFragment(TypeGpuGlyphExampleFragmentInput({ color: d.vec4f(1, 0.5, 0.25, 1), quadUv: d.vec2f(0, 0) })),
  ).value;
  expect([...corner]).toEqual([1, 0.5, 0.25, 1]);
});

afterAll(() => {
  for (const material of materials) material.dispose();
});
