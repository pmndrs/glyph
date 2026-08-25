import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  FontRegistry,
  createTextRuntime,
  defineRasterResourceId,
  defineRasterTechnique,
  rasterBake,
  type RasterKey,
  type RasterResolverContext,
  type RasterResourceResolverContext,
  type RegisteredFont,
  type Sha256Hex,
} from '@pmndrs/glyph';
import { bakeFont } from '@pmndrs/glyph/bake';
import {
  defineTechniqueSchema,
  registerRasterPlanProgram,
  type PortableBufferPayload,
  type PortableGeometryPayload,
  type RasterPlanProgram,
} from '@pmndrs/glyph/core';
import {
  registerThreeRasterPlanProgram,
  defineTextMaterial,
  threePolicyAbi,
  Text,
  TextGroup,
  type ThreePlanProgramBuffer,
  type ThreePlanProgramMaterialContext,
  type ThreeTextGenericMaterialContext,
} from '@pmndrs/glyph/three';
import { positionLocal, storage, uv } from 'three/tsl';
import * as THREE from 'three/webgpu';
import { afterEach, describe, expect, test, vi } from 'vitest';

import glyphExampleBaker from '../src/baker.js';
import { glyphExamplePlanProgram } from '../src/portable.js';
import { glyphExampleTslShader, glyphExampleTslVariant } from '../src/tsl.js';
import {
  GLYPH_EXAMPLE_KIND,
  glyphExample,
  glyphExampleDescriptor,
  glyphExampleIndexedQuadGeometry,
  type GlyphExampleData,
} from '../src/index.js';

const source = new URL('../../../apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf', import.meta.url);
const temporaryDirectories: string[] = [];
const materials: THREE.NodeMaterial[] = [];
const genericMaterialContexts: ThreeTextGenericMaterialContext[] = [];
const suppliedMaterialContexts: ThreePlanProgramMaterialContext[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  for (const material of materials.splice(0)) material.dispose();
  genericMaterialContexts.splice(0);
  suppliedMaterialContexts.splice(0);
});

describe('public external raster proof', () => {
  test('bakes deterministic standalone companion bytes', async () => {
    const request = {
      font: {
        source: new Uint8Array(),
        fontFaceIndex: 0,
        glyphCount: 5,
        shapingHash: '1'.repeat(64) as Sha256Hex,
      },
      rasterKey: '2'.repeat(64) as RasterKey,
      packaging: { artifact: 'external', pages: 'external' } as const,
      descriptor: glyphExampleDescriptor({ paletteSeed: 7, inset: 0.1 }),
    };
    const [left, right] = await Promise.all([glyphExampleBaker.bake(request), glyphExampleBaker.bake(request)]);

    expect(left).toEqual(right);
    expect(left.kind).toBe(GLYPH_EXAMPLE_KIND);
    expect(left.artifacts.map(({ role }) => role)).toEqual(['raster', 'raster-page']);
    expect(left.artifacts[0]?.bytes.subarray(0, 4)).toEqual(Uint8Array.of(0x67, 0x6c, 0x54, 0x46));
  });

  test('bakes, authenticates, loads, and resolves package-owned external records through public APIs', async () => {
    const baked = await bakeFixture({ artifact: 'external', pages: 'external' });
    const core = baked.execution.outputs.find(({ role }) => role === 'font');
    const companion = baked.execution.outputs.find(({ role }) => role === 'raster');
    const records = baked.execution.outputs.find(({ role }) => role === 'raster-page');
    assert.ok(core && companion && records);
    const registry = new FontRegistry();
    const font = await registry.registerAsset(await readFile(core.file));
    const resolve = vi.fn(async (_context: RasterResolverContext) => readFile(companion.file));
    const resolveResource = vi.fn(async (_context: RasterResourceResolverContext) => readFile(records.file));

    try {
      const raster = await font.loadRaster(rasterSelection(font), { resolve, resolveResource });
      const data = await glyphExample.decode(font, raster);
      expect(raster.kind).toBe(GLYPH_EXAMPLE_KIND);
      expect(data.colors.byteLength).toBe(font.glyphCount * 4);
      expect(data.inset).toBe(glyphExampleDescriptor({ paletteSeed: 7 }).inset);
      expect(resolve).toHaveBeenCalledOnce();
      expect(resolveResource).toHaveBeenCalledOnce();
      expect(resolve.mock.calls[0]?.[0].reference.kind).toBe(GLYPH_EXAMPLE_KIND);
      expect(resolveResource.mock.calls[0]?.[0].source.artifactHash).toMatch(/^[0-9a-f]{64}$/);
      glyphExample.dispose(data);
    } finally {
      font.dispose();
    }
  });

  test('honors cancellation before decoding and leaves no decoded data', async () => {
    const baked = await bakeFixture({ artifact: 'embedded', pages: 'embedded' });
    const core = baked.execution.outputs.find(({ role }) => role === 'font');
    assert.ok(core);
    const registry = new FontRegistry();
    const font = await registry.registerAsset(await readFile(core.file));
    const raster = await font.loadRaster(rasterSelection(font));
    const controller = new AbortController();
    controller.abort(new DOMException('cancel glyph-example decode', 'AbortError'));

    await expect(glyphExample.decode(font, raster, controller.signal)).rejects.toThrowError(
      expect.objectContaining({ name: 'AbortError' }),
    );
    font.dispose();
  });

  test('manually registers the TSL realization and preserves Three draw reuse', async () => {
    registerThreeRasterPlanProgram(threeProgram);
    const baked = await bakeFixture({ artifact: 'embedded', pages: 'embedded' });
    const core = baked.execution.outputs.find(({ role }) => role === 'font');
    assert.ok(core);
    const registry = new FontRegistry();
    const runtime = await createTextRuntime({
      registry,
      wasm: await readFile(new URL('../../glyph/dist/text-shaper.wasm', import.meta.url)),
    });
    const font = await runtime.loadFont({
      input: { baked: dataUrl(await readFile(core.file)) },
      raster: { technique: glyphExample, options: { paletteSeed: 7 } },
    });
    const material = defineTextMaterial((context) => {
      if (typeof context.technique === 'string') throw new TypeError('expected a generic material context');
      genericMaterialContexts.push(context);
      const realized = context.createDefaultMaterial();
      realized.depthTest = true;
      return realized;
    });
    const text = new Text({ font, text: 'PUBLIC RASTER', style: { fontSize: 48 }, material });
    const group = new TextGroup({ renderOrder: 200 });
    group.add(text);
    const scene = new THREE.Scene();
    scene.add(group);
    scene.updateMatrixWorld();

    try {
      expect(group.error).toBeUndefined();
      const draw = group.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh);
      expect(draw).toBeDefined();
      expect(draw?.renderOrder).toBe(200);
      expect((draw?.material as THREE.Material | undefined)?.depthTest).toBe(true);
      expect(genericMaterialContexts).toHaveLength(1);
      expect(genericMaterialContexts[0]?.technique.id).toBe(glyphExample.id);
      expect([...genericMaterialContexts[0]!.outputs.keys()]).toEqual(['position', 'color', 'opacity']);
      const geometry = draw?.geometry as THREE.InstancedBufferGeometry;
      expect(geometry.getAttribute('_pmndrsGlyph_1')).toBeDefined();
      expect(geometry.getAttribute('_pmndrsGlyph_2')).toBeDefined();
      expect(geometry.getAttribute('_pmndrsGlyph_3')).toBeDefined();
      expect(geometry.getAttribute('_pmndrsGlyph_15')).toBeDefined();
      expect(geometry.instanceCount).toBeGreaterThan(0);
      const sizes = geometry.getAttribute('_pmndrsGlyph_2');
      const expectedWidth = Math.max(48 * 0.05, 48 * 0.65 - font.data.inset * 48 * 2);
      const expectedHeight = Math.max(48 * 0.05, 48 - font.data.inset * 48 * 2);
      for (let instance = 0; instance < geometry.instanceCount; instance += 1) {
        expect(sizes.getX(instance)).toBeCloseTo(expectedWidth, 5);
        expect(sizes.getY(instance)).toBeCloseTo(expectedHeight, 5);
      }
      const colors = geometry.getAttribute('_pmndrsGlyph_3');
      for (let instance = 0; instance < geometry.instanceCount; instance += 1) {
        expect(
          font.data.colors.some((_, offset) => glyphColorMatches(font.data.colors, offset, colors, instance)),
        ).toBe(true);
      }

      text.text = 'PLUGIN UPDATE';
      scene.updateMatrixWorld();
      expect(group.error).toBeUndefined();
      expect(group.children.find((child) => child instanceof THREE.Mesh)).toBe(draw);
      expect(draw?.geometry).toBe(geometry);
    } finally {
      group.dispose();
      text.dispose();
      font.dispose();
      runtime.dispose();
    }
  });

  test('realizes and reuses supplied indexed triangle-strip geometry through Three', async () => {
    registerThreeRasterPlanProgram(suppliedThreeProgram);
    const baked = await bakeFixture({ artifact: 'embedded', pages: 'embedded' });
    const core = baked.execution.outputs.find(({ role }) => role === 'font');
    assert.ok(core);
    const registry = new FontRegistry();
    const runtime = await createTextRuntime({
      registry,
      wasm: await readFile(new URL('../../glyph/dist/text-shaper.wasm', import.meta.url)),
    });
    const font = await runtime.loadFont({
      input: { baked: dataUrl(await readFile(core.file)) },
      raster: { technique: suppliedGlyphExample, options: { paletteSeed: 7 } },
    });
    const text = new Text({ font, text: 'STRIP QUAD', style: { fontSize: 48 } });
    const group = new TextGroup();
    group.add(text);
    const scene = new THREE.Scene();
    scene.add(group);
    scene.updateMatrixWorld();

    let materialDisposals = 0;
    try {
      expect(group.error).toBeUndefined();
      const draw = group.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh);
      expect(draw).toBeDefined();
      const geometry = draw?.geometry as THREE.InstancedBufferGeometry;
      const drawMaterial = draw?.material;
      assert.ok(drawMaterial && !Array.isArray(drawMaterial));
      drawMaterial.addEventListener('dispose', () => (materialDisposals += 1));
      expect(suppliedMaterialContexts).toHaveLength(1);
      expect([...suppliedMaterialContexts[0]!.namedResources.keys()]).toEqual(['glyphColors', 'glyphGeometry']);
      expect(suppliedMaterialContexts[0]!.resourceName).toBe('glyphColors');
      expect(Array.from(geometry.index?.array ?? [])).toEqual([0, 1, 2, 2, 1, 3]);
      expect(geometry.drawRange).toEqual({ start: 0, count: 6 });
      expect(geometry.instanceCount).toBeGreaterThan(0);

      text.text = 'QUAD STRIP';
      scene.updateMatrixWorld();
      expect(group.error).toBeUndefined();
      expect(group.children.find((child) => child instanceof THREE.Mesh)).toBe(draw);
      expect(draw?.geometry).toBe(geometry);
      expect(geometry.drawRange).toEqual({ start: 0, count: 6 });
    } finally {
      group.dispose();
      text.dispose();
      font.dispose();
      runtime.dispose();
    }
    expect(materialDisposals).toBe(1);
  });
});

const suppliedGlyphExample = defineRasterTechnique({
  ...glyphExample,
  id: 'studio.glyph-example-supplied',
});

const suppliedGlyphExampleSchema = defineTechniqueSchema({
  technique: suppliedGlyphExample.id,
  scope: glyphExamplePlanProgram.schema.scope,
  binding: glyphExamplePlanProgram.schema.binding,
  buffers: glyphExamplePlanProgram.schema.buffers,
  resources: { glyphColors: { kind: 'buffer' }, glyphGeometry: { kind: 'geometry' } },
  render: { geometry: { kind: 'quad', resource: 'glyphGeometry', coordinates: 'unit-square' } },
  glyphOrigin: { buffer: 'origin' },
});

const stripGeometry = triangleStripGeometry(glyphExampleIndexedQuadGeometry);

const suppliedPlanProgram: RasterPlanProgram<
  typeof suppliedGlyphExample,
  PortableBufferPayload | PortableGeometryPayload
> = {
  technique: suppliedGlyphExample,
  schema: suppliedGlyphExampleSchema,
  policyBody: glyphExamplePlanProgram.policyBody,
  compileFont(compiler) {
    const data: GlyphExampleData = compiler.font.data;
    const geometryKey = defineRasterResourceId(`${data.resource}/strip-geometry`);
    const { resources } = compiler.resources([data.resource, geometryKey]);
    compiler.retain('glyphColors', data.resource, { kind: 'buffer', bytes: data.colors, stride: 4 });
    compiler.retain('glyphGeometry', geometryKey, stripGeometry);
    compiler.compile({
      techniqueId: compiler.techniqueId,
      programVariant: 0,
      glyphCount: compiler.font.font.glyphCount,
      strikes: [0],
      resources,
      resourceIndex: () => 0,
      glyphF32: {
        rows: data.glyphCount,
        fields: [
          () => data.inset,
          (row) => data.colors[row * 4]! / 255,
          (row) => data.colors[row * 4 + 1]! / 255,
          (row) => data.colors[row * 4 + 2]! / 255,
          (row) => data.colors[row * 4 + 3]! / 255,
        ],
      },
      glyphU32: compiler.emptyTable(data.glyphCount),
      strikeF32: compiler.emptyTable(data.glyphCount),
      strikeU32: compiler.emptyTable(data.glyphCount),
      resourceF32: compiler.emptyTable(resources.length),
      resourceU32: compiler.emptyTable(resources.length),
    });
  },
};

registerRasterPlanProgram(suppliedPlanProgram);

const suppliedThreeProgram = {
  technique: suppliedGlyphExample,
  variant: {
    id: 'tsl-strip',
    language: 'tsl',
    buffers: glyphExampleTslVariant.buffers,
    resources: suppliedGlyphExampleSchema.resources!,
    outputs: glyphExampleTslVariant.outputs,
    geometry: suppliedGlyphExampleSchema.render!.geometry,
    createMaterial(context: ThreePlanProgramMaterialContext) {
      suppliedMaterialContexts.push(context);
      const material = createThreeMaterial(context);
      materials.push(material);
      return material;
    },
  },
};

const threeProgram = {
  technique: glyphExamplePlanProgram.technique,
  variant: {
    id: 'tsl',
    language: 'tsl',
    buffers: glyphExampleTslVariant.buffers,
    resources: glyphExampleTslVariant.resources,
    outputs: glyphExampleTslVariant.outputs,
    geometry: glyphExampleTslVariant.geometry,
    createMaterial(context: ThreePlanProgramMaterialContext) {
      const material = createThreeMaterial(context);
      materials.push(material);
      return material;
    },
  },
};

function createThreeMaterial(context: ThreePlanProgramMaterialContext): THREE.NodeMaterial {
  const origin = floatBuffer(context.namedBuffers, 'origin', 2);
  const size = floatBuffer(context.namedBuffers, 'size', 2);
  const color = floatBuffer(context.namedBuffers, 'color', 4);
  const shader = glyphExampleTslShader({
    origin: storage(origin.attribute, 'vec2', origin.attribute.count).setPBO(true).element(context.instance),
    size: storage(size.attribute, 'vec2', size.attribute.count).setPBO(true).element(context.instance),
    color: storage(color.attribute, 'vec4', color.attribute.count).setPBO(true).element(context.instance),
    quadPosition: positionLocal,
    quadUv: uv(),
    transformPosition: context.transformPosition,
  });
  const createDefaultMaterial = () => {
    const material = new THREE.MeshBasicNodeMaterial({
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      transparent: true,
    });
    material.positionNode = shader.position;
    material.colorNode = shader.color;
    material.opacityNode = shader.opacity;
    return material;
  };
  return (
    context.material?.create({
      technique: context.technique,
      outputs: new Map<string, THREE.Node>([
        ['position', shader.position],
        ['color', shader.color],
        ['opacity', shader.opacity],
      ]),
      position: shader.position,
      createDefaultMaterial,
    }) ?? createDefaultMaterial()
  );
}

function floatBuffer(buffers: ReadonlyMap<string, ThreePlanProgramBuffer>, name: string, vectorWidth: number) {
  const buffer = buffers.get(name);
  if (
    buffer === undefined ||
    buffer.scalarType !== threePolicyAbi.scalarTypes.f32 ||
    buffer.vectorWidth !== vectorWidth
  ) {
    throw new TypeError(`glyph-example draw requires f32x${vectorWidth} policy buffer "${name}"`);
  }
  return buffer;
}

/** The baked artifact advertises its own raster key, so the test never reimplements key derivation. */
function rasterSelection(font: RegisteredFont): { readonly rasterKey: RasterKey; readonly kind: 'glyphExample' } {
  const reference = font.rasterReferences.find(({ kind }) => kind === GLYPH_EXAMPLE_KIND);
  assert.ok(reference, 'baked font must advertise its glyph-example raster');
  return { rasterKey: reference.rasterKey, kind: GLYPH_EXAMPLE_KIND };
}

async function bakeFixture(packaging: {
  readonly artifact: 'embedded' | 'external';
  readonly pages: 'embedded' | 'external';
}) {
  const directory = await mkdtemp(join(tmpdir(), 'pmndrs-glyph-example-'));
  temporaryDirectories.push(directory);
  return bakeFont({
    input: source,
    output: join(directory, 'inter.font.glb'),
    font: { fontFaceIndex: 0 },
    rasters: [rasterBake(glyphExampleBaker, { packaging, options: { paletteSeed: 7 } })],
  });
}

function dataUrl(bytes: Uint8Array): string {
  return `data:model/gltf-binary;base64,${Buffer.from(bytes).toString('base64')}`;
}

function triangleStripGeometry(source: PortableGeometryPayload): PortableGeometryPayload {
  const bytes = new Uint8Array(72);
  bytes.set(source.bytes.subarray(0, 64));
  bytes.set(new Uint8Array(new Uint16Array([0, 1, 2, 3]).buffer), 64);
  return {
    kind: 'geometry',
    topology: 'triangle-strip',
    bytes,
    views: [source.views[0]!, { offset: 64, length: 8 }],
    accessors: [source.accessors[0]!, source.accessors[1]!, { componentType: 'u16', components: 1, view: 1, count: 4 }],
    attributes: source.attributes,
    indices: { accessor: 2 },
    drawRange: { start: 0, count: 4 },
    instances: { source: 'records' },
  };
}

function glyphColorMatches(
  records: Uint8Array,
  offset: number,
  attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  instance: number,
): boolean {
  if (offset % 4 !== 0 || offset > records.length - 4) return false;
  return (
    Math.abs(attribute.getX(instance) - records[offset]! / 255) < 1e-6 &&
    Math.abs(attribute.getY(instance) - records[offset + 1]! / 255) < 1e-6 &&
    Math.abs(attribute.getZ(instance) - records[offset + 2]! / 255) < 1e-6 &&
    Math.abs(attribute.getW(instance) - records[offset + 3]! / 255) < 1e-6
  );
}
