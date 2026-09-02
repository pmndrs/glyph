import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import {
  createFontLibrary,
  defineRasterResourceId,
  defineRasterTechnique,
  glyph,
  loadFont,
  type RasterKey,
  type Sha256Hex,
} from '@pmndrs/glyph';
import { bakeFont } from '@pmndrs/glyph/bake';
import { rasterBake } from '@pmndrs/glyph/baker';
import {
  defineTechniqueSchema,
  f32,
  registerRasterPlanProgram,
  techniqueProgram,
  type PortableGeometryPayload,
} from '@pmndrs/glyph';
import {
  registerThreeRasterPlanProgram,
  defineTextMaterial,
  FontLoader,
  ThreeConfig,
  threeCodecAbi,
  type ThreePlanProgramBuffer,
  type ThreePlanProgramMaterialContext,
  type ThreeRootContext,
  type ThreeTextMaterialContextMap,
} from '@pmndrs/glyph/three';
import { positionLocal, storage, uv } from 'three/tsl';
import * as THREE from 'three/webgpu';
import { afterEach, describe, expect, test, vi } from 'vitest';

import glyphExampleBaker from '../src/baker.js';
import { glyphExampleSchema } from '../src/portable.js';
import { glyphExamplePlanProgram } from '../src/register.js';
import { glyphExampleTslShader, glyphExampleTslVariant } from '../src/tsl.js';
import {
  GLYPH_EXAMPLE_KIND,
  glyphExample,
  glyphExampleDescriptor,
  glyphExampleIndexedQuadGeometry,
  type GlyphExampleData,
} from '../src/index.js';

declare module '@pmndrs/glyph/three' {
  interface ThreeTextMaterialContextMap {
    readonly 'studio.glyph-example': Readonly<{
      root: ThreeRootContext;
      kind: 'glyph';
      technique: 'studio.glyph-example';
      outputs: ReadonlyMap<string, THREE.Node>;
      position: THREE.Node<'vec3'>;
      createDefaultMaterial(): THREE.NodeMaterial;
    }>;
  }
}

type GlyphExampleMaterialContext = ThreeTextMaterialContextMap['studio.glyph-example'];

const source = new URL('../../../apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf', import.meta.url);
const temporaryDirectories: string[] = [];
const materials: THREE.NodeMaterial[] = [];
const genericMaterialContexts: GlyphExampleMaterialContext[] = [];
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
    const files = new Map(baked.execution.outputs.map((output) => [basename(output.file), output.file] as const));
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input);
      const file = files.get(basename(new URL(url).pathname));
      return file === undefined ? new Response(null, { status: 404 }) : new Response(await readFile(file));
    });
    const library = createFontLibrary({ fetch });
    const font = await library.loadFont(
      { baked: 'https://glyph.invalid/inter.font.glb' },
      { technique: glyphExample, options: { paletteSeed: 7 } },
    );

    try {
      expect(font.technique).toBe(glyphExample);
      expect(font.glyphCount).toBeGreaterThan(0);
      expect(
        fetch.mock.calls.map(([input]) =>
          basename(new URL(input instanceof Request ? input.url : String(input)).pathname),
        ),
      ).toEqual(expect.arrayContaining([basename(core.file), basename(companion.file), basename(records.file)]));
    } finally {
      font.dispose();
      library.dispose();
    }
  });

  test('honors cancellation before decoding and leaves no decoded data', async () => {
    const baked = await bakeFixture({ artifact: 'embedded', pages: 'embedded' });
    const core = baked.execution.outputs.find(({ role }) => role === 'font');
    assert.ok(core);
    const controller = new AbortController();
    controller.abort(new DOMException('cancel glyph-example decode', 'AbortError'));
    const bytes = await readFile(core.file);

    expect(() =>
      loadFont(
        { baked: { bytes, ownership: 'copy' } },
        { technique: glyphExample, options: { paletteSeed: 7 } },
        { signal: controller.signal },
      ),
    ).toThrowError(expect.objectContaining({ name: 'AbortError' }));
  });

  test('manually registers the TSL realization and preserves Three draw reuse', async () => {
    registerThreeRasterPlanProgram(threeProgram);
    const three = await createThreeHandle();
    const baked = await bakeFixture({ artifact: 'embedded', pages: 'embedded' });
    const core = baked.execution.outputs.find(({ role }) => role === 'font');
    assert.ok(core);
    const loader = new FontLoader();
    const font = await loader.loadAsync({
      input: { baked: dataUrl(await readFile(core.file)) },
      raster: { technique: glyphExample, options: { paletteSeed: 7 } },
    });
    const material = defineTextMaterial((context) => {
      if (context.kind !== 'glyph' || context.technique !== glyphExample.id) return context.createDefaultMaterial();
      genericMaterialContexts.push(context);
      const realized = context.createDefaultMaterial();
      realized.depthTest = true;
      return realized;
    });
    const text = three.createText({ font, text: 'PUBLIC RASTER', style: { fontSize: 48 }, material });
    const group = three.createTextGroup({ renderOrder: 200 });
    group.add(text);
    const scene = new THREE.Scene();
    scene.add(group);
    scene.updateMatrixWorld();

    try {
      expect(group.error).toBeUndefined();
      const draw = rootDraws(scene)[0];
      expect(draw).toBeDefined();
      expect(draw?.renderOrder).toBe(200);
      expect((draw?.material as THREE.Material | undefined)?.depthTest).toBe(true);
      expect(genericMaterialContexts).toHaveLength(1);
      expect(genericMaterialContexts[0]?.technique).toBe(glyphExample.id);
      expect([...genericMaterialContexts[0]!.outputs.keys()]).toEqual(['position', 'color', 'opacity']);
      const geometry = draw?.geometry as THREE.InstancedBufferGeometry;
      expect(geometry.getAttribute(glyphAttribute(glyphExampleSchema.buffers.origin.id))).toBeDefined();
      expect(geometry.getAttribute(glyphAttribute(glyphExampleSchema.buffers.size.id))).toBeDefined();
      expect(geometry.getAttribute(glyphAttribute(glyphExampleSchema.buffers.color.id))).toBeDefined();
      expect(geometry.getAttribute(glyphAttribute(threeCodecAbi.transformBufferId))).toBeDefined();
      expect(geometry.instanceCount).toBeGreaterThan(0);
      const sizes = geometry.getAttribute(glyphAttribute(glyphExampleSchema.buffers.size.id));
      const inset = glyphExampleDescriptor({ paletteSeed: 7 }).inset;
      const expectedWidth = Math.max(48 * 0.05, 48 * 0.65 - inset * 48 * 2);
      const expectedHeight = Math.max(48 * 0.05, 48 - inset * 48 * 2);
      for (let instance = 0; instance < geometry.instanceCount; instance += 1) {
        expect(sizes.getX(instance)).toBeCloseTo(expectedWidth, 5);
        expect(sizes.getY(instance)).toBeCloseTo(expectedHeight, 5);
      }
      const colors = geometry.getAttribute(glyphAttribute(glyphExampleSchema.buffers.color.id));
      for (let instance = 0; instance < geometry.instanceCount; instance += 1) {
        expect(colors.getX(instance)).toBeGreaterThanOrEqual(64 / 255);
        expect(colors.getX(instance)).toBeLessThanOrEqual(191 / 255);
        expect(colors.getY(instance)).toBeGreaterThanOrEqual(64 / 255);
        expect(colors.getY(instance)).toBeLessThanOrEqual(191 / 255);
        expect(colors.getZ(instance)).toBeGreaterThanOrEqual(64 / 255);
        expect(colors.getZ(instance)).toBeLessThanOrEqual(191 / 255);
        expect(colors.getW(instance)).toBe(1);
      }

      text.text = 'PLUGIN UPDATE';
      scene.updateMatrixWorld();
      expect(group.error).toBeUndefined();
      expect(rootDraws(scene)[0]).toBe(draw);
      expect(draw?.geometry).toBe(geometry);
    } finally {
      group.dispose();
      text.dispose();
      font.dispose();
      loader.dispose();
      three.dispose();
    }
  });

  test('realizes and reuses supplied indexed triangle-strip geometry through Three', async () => {
    registerThreeRasterPlanProgram(suppliedThreeProgram);
    const three = await createThreeHandle();
    const baked = await bakeFixture({ artifact: 'embedded', pages: 'embedded' });
    const core = baked.execution.outputs.find(({ role }) => role === 'font');
    assert.ok(core);
    const loader = new FontLoader();
    const font = await loader.loadAsync({
      input: { baked: dataUrl(await readFile(core.file)) },
      raster: { technique: suppliedGlyphExample, options: { paletteSeed: 7 } },
    });
    const text = three.createText({ font, text: 'STRIP QUAD', style: { fontSize: 48 } });
    const group = three.createTextGroup();
    group.add(text);
    const scene = new THREE.Scene();
    scene.add(group);
    scene.updateMatrixWorld();

    let materialDisposals = 0;
    try {
      expect(group.error).toBeUndefined();
      const draw = rootDraws(scene)[0];
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
      expect(geometry.getAttribute('position').itemSize).toBe(3);
      geometry.computeBoundingBox();
      expect(geometry.boundingBox?.min.toArray()).toEqual([0, 0, 0]);
      expect(geometry.boundingBox?.max.toArray()).toEqual([1, 1, 0]);

      text.text = 'QUAD STRIP';
      scene.updateMatrixWorld();
      expect(group.error).toBeUndefined();
      expect(rootDraws(scene)[0]).toBe(draw);
      expect(draw?.geometry).toBe(geometry);
      expect(geometry.drawRange).toEqual({ start: 0, count: 6 });
    } finally {
      group.dispose();
      text.dispose();
      font.dispose();
      loader.dispose();
      three.dispose();
    }
    expect(materialDisposals).toBe(1);
  });
});

let nextThreeHandle = 1;

async function createThreeHandle() {
  await glyph.init();
  const handle = glyph.handle(`three:glyph-example:${String(nextThreeHandle)}`, ThreeConfig);
  nextThreeHandle += 1;
  return handle;
}

function rootDraws(scene: THREE.Scene): THREE.Mesh[] {
  return (
    scene
      .getObjectByName('@pmndrs/glyph:anonymous')
      ?.children.filter((child): child is THREE.Mesh => child instanceof THREE.Mesh) ?? []
  );
}

const suppliedGlyphExample = defineRasterTechnique({
  ...glyphExample,
  id: 'studio.glyph-example-supplied',
});

const suppliedGlyphExampleSchema = defineTechniqueSchema({
  technique: suppliedGlyphExample.id,
  scope: glyphExampleSchema.scope,
  binding: glyphExampleSchema.binding,
  buffers: glyphExampleSchema.buffers,
  resources: {
    glyphColors: { kind: 'buffer' },
    glyphGeometry: {
      kind: 'geometry',
      attributes: [
        { semantic: 'position', componentType: 'f32', components: 3 },
        { semantic: 'uv', componentType: 'f32', components: 2 },
      ],
    },
  },
  render: {
    resource: 'glyphColors',
    geometry: { kind: 'quad', resource: 'glyphGeometry', coordinates: 'unit-square' },
  },
  glyphOrigin: { buffer: 'origin' },
});

const stripGeometry = triangleStripGeometry(glyphExampleIndexedQuadGeometry);

registerRasterPlanProgram({
  technique: suppliedGlyphExample,
  schema: suppliedGlyphExampleSchema,
  policyBody(system) {
    const p = techniqueProgram(suppliedGlyphExampleSchema, { system });
    const { inlineOrigin, blockOrigin, fontSize, color } = p.semantics;
    const { inset, red, green, blue, alpha } = p.binding;
    const insetPixels = f32.mul(inset, fontSize);
    const twiceInsetPixels = f32.mul(insetPixels, f32.const(2));
    return p.compile({
      origin: [f32.add(inlineOrigin, insetPixels), f32.sub(blockOrigin, insetPixels)],
      size: [f32.sub(f32.mul(fontSize, f32.const(0.65)), twiceInsetPixels), f32.sub(fontSize, twiceInsetPixels)],
      color: [
        f32.mul(color.red, red),
        f32.mul(color.green, green),
        f32.mul(color.blue, blue),
        f32.mul(color.alpha, alpha),
      ],
    });
  },
  compileFont(compiler) {
    const data: GlyphExampleData = compiler.font.data;
    const geometryKey = defineRasterResourceId(`${data.resource}/strip-geometry`);
    compiler.retain('glyphColors', data.resource, { kind: 'buffer', bytes: data.colors, stride: 4 });
    compiler.retain('glyphGeometry', geometryKey, stripGeometry);
    return compiler.compile({
      strikes: [0],
      resource: () => data.resource,
      f32: {
        inset: () => data.inset,
        red: (row) => data.colors[row * 4]! / 255,
        green: (row) => data.colors[row * 4 + 1]! / 255,
        blue: (row) => data.colors[row * 4 + 2]! / 255,
        alpha: (row) => data.colors[row * 4 + 3]! / 255,
      },
    });
  },
});

const suppliedThreeProgram = {
  technique: suppliedGlyphExample,
  schema: suppliedGlyphExampleSchema,
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
  schema: glyphExamplePlanProgram.schema,
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
      root: context.root,
      kind: 'glyph',
      technique: glyphExample.id,
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

function glyphAttribute(bufferId: number): string {
  return `_pmndrsGlyph_${bufferId}`;
}

function floatBuffer(buffers: ReadonlyMap<string, ThreePlanProgramBuffer>, name: string, vectorWidth: number) {
  const buffer = buffers.get(name);
  if (buffer === undefined || buffer.scalarType !== 'f32' || buffer.vectorWidth !== vectorWidth) {
    throw new TypeError(`glyph-example draw requires f32x${vectorWidth} policy buffer "${name}"`);
  }
  return buffer;
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
  const bytes = new Uint8Array(88);
  bytes.set(source.bytes.subarray(0, 80));
  bytes.set(new Uint8Array(new Uint16Array([0, 1, 2, 3]).buffer), 80);
  return {
    kind: 'geometry',
    topology: 'triangle-strip',
    bytes,
    views: [source.views[0]!, { offset: 80, length: 8 }],
    accessors: [source.accessors[0]!, source.accessors[1]!, { componentType: 'u16', components: 1, view: 1, count: 4 }],
    attributes: source.attributes,
    indices: { accessor: 2 },
    drawRange: { start: 0, count: 4 },
  };
}
