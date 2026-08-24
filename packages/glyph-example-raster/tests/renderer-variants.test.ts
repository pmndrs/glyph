import { registerThreeRasterPlanProgram, threePolicyAbi } from '@pmndrs/glyph/three';
import tgpu from 'typegpu';
import * as d from 'typegpu/data';
import { afterAll, expect, test } from 'vitest';
import { positionLocal, storage, uint, uv } from 'three/tsl';
import * as THREE from 'three/webgpu';

import { glyphExamplePlanProgram, glyphExampleSchema, glyphExampleShaderContract } from '@pmndrs/glyph-example-raster';
import { glyphExampleTslShader, glyphExampleTslVariant } from '@pmndrs/glyph-example-raster/tsl';
import {
  glyphExampleTypeGpuVariant,
  glyphExampleFragment,
  glyphExampleVertex,
  TypeGpuGlyphExampleFragmentInput,
  TypeGpuGlyphExampleVertexInput,
} from '@pmndrs/glyph-example-raster/typegpu';

const materials: THREE.NodeMaterial[] = [];

test('a Three consumer manually registers the example TSL realization', () => {
  expect(glyphExampleTslVariant.language).toBe('tsl');
  expect(glyphExampleTslVariant.techniqueId).toBe(glyphExamplePlanProgram.technique.id);

  const program = {
    technique: glyphExamplePlanProgram.technique,
    realizeResource: (resource: unknown) => resource,
    createMaterial(context: {
      readonly buffers: ReadonlyMap<
        number,
        {
          readonly scalarType: number;
          readonly vectorWidth: number;
          readonly attribute: THREE.StorageInstancedBufferAttribute;
        }
      >;
      readonly instance: THREE.Node<'uint'>;
      readonly materialId: number;
      transformPosition(position: THREE.Node<'vec3'>): THREE.Node<'vec3'>;
    }) {
      if (context.materialId !== 0) throw new TypeError('glyph-example supports only the default material');
      const origin = context.buffers.get(1);
      const size = context.buffers.get(2);
      const color = context.buffers.get(3);
      if (
        origin?.scalarType !== threePolicyAbi.scalarTypes.f32 ||
        origin.vectorWidth !== 2 ||
        size?.scalarType !== threePolicyAbi.scalarTypes.f32 ||
        size.vectorWidth !== 2 ||
        color?.scalarType !== threePolicyAbi.scalarTypes.f32 ||
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
  };

  registerThreeRasterPlanProgram(program);
  registerThreeRasterPlanProgram(program);
  const attribute = new THREE.StorageInstancedBufferAttribute(new Float32Array(4), 2);
  const material = program.createMaterial({
    buffers: new Map([
      [1, { scalarType: threePolicyAbi.scalarTypes.f32, vectorWidth: 2, attribute }],
      [2, { scalarType: threePolicyAbi.scalarTypes.f32, vectorWidth: 2, attribute }],
      [3, { scalarType: threePolicyAbi.scalarTypes.f32, vectorWidth: 4, attribute }],
    ]),
    instance: uint(0),
    materialId: 0,
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
    resource: glyphExampleTslVariant.resource,
  });
  expect(glyphExampleShaderContract).toMatchObject({
    techniqueId: glyphExamplePlanProgram.technique.id,
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
