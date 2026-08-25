import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createTextRuntime, rasterBake } from '@pmndrs/glyph';
import { bakeFont } from '@pmndrs/glyph/bake';
import {
  textRuntimeShaper,
  textShaperAbi,
  type TextEngineBufferRecord,
  type TextEnginePatchRecord,
  type TextEngineRetirementRecord,
} from '@pmndrs/glyph/core';
import { afterEach, expect, test } from 'vitest';

import glyphExampleBaker from '@pmndrs/glyph-example-raster/baker';
import {
  glyphExample,
  glyphExampleIndexedQuadGeometry,
  glyphExampleSuppliedGeometryDeclaration,
} from '@pmndrs/glyph-example-raster';
import {
  exampleRendererShader,
  RecordingExampleRendererDevice,
  type ExampleDrawList,
  type ExampleRendererShader,
} from '../src/index.js';
import { ExampleTextEngine } from '../src/engine.js';

const source = new URL('../../../apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf', import.meta.url);
const shaperWasm = new URL('../../glyph/dist/text-shaper.wasm', import.meta.url);
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

test('loads a font, binds the portable raster, and submits non-empty example draws', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'glyph-example-renderer-'));
  temporaryDirectories.push(directory);
  const output = join(directory, 'inter.font.glb');
  await bakeFont({
    input: source,
    output,
    font: { fontFaceIndex: 0 },
    rasters: [
      rasterBake(glyphExampleBaker, {
        packaging: { artifact: 'embedded', pages: 'embedded' },
        options: { paletteSeed: 7 },
      }),
    ],
  });

  const runtime = await createTextRuntime({ wasm: await readFile(shaperWasm) });
  const device = new RecordingExampleRendererDevice();
  const engine = new ExampleTextEngine(textRuntimeShaper(runtime), device);
  try {
    const bytes = await readFile(output);
    const font = await runtime.loadFont({
      input: { baked: `data:model/gltf-binary;base64,${bytes.toString('base64')}` },
      raster: { technique: glyphExample, options: { paletteSeed: 7 } },
    });
    try {
      const invalidFont = Object.create(font) as typeof font;
      Object.defineProperty(invalidFont, 'font', { value: { ...font.font, handle: 0 } });
      expect(() => engine.registerFont(invalidFont)).toThrow();
      expect(device.resources.size).toBe(0);

      const binding = engine.registerFont(font);
      expect(binding).toBe(100);
      engine.registerFontStack(17, [binding]);
      engine.openSession(29);
      const list = engine.render({
        paragraphMutations: [{ opcode: 'upsert', paragraphId: 1, order: 0 }],
        textMutations: [{ paragraphId: 1, start: 0, deleteCount: 0, insert: 'glyph' }],
        styleMutations: [
          {
            opcode: 'upsert',
            paragraphId: 1,
            styleId: 1,
            cascadeOrder: 0,
            start: 0,
            end: 5,
            root: true,
            value: { fontStackHandle: 17, fontSize: 48, rasterPixelRatio: 1, foregroundRgba: 0xffff_ffff },
          },
        ],
        constraints: [
          {
            paragraphId: 1,
            flowThreadId: 1,
            geometryRevision: 1,
            width: 1000,
            height: 1000,
            viewportBlockStart: 0,
            viewportBlockEnd: 1000,
            resumeBlockOffset: 0,
            maxLines: 32,
            regionStart: 0,
            resumeCluster: 0,
            regionCount: 1,
            resumeRegion: 0,
            widthMode: 'at-most',
            heightMode: 'at-most',
            wrap: 'word',
            align: 'start',
            overflow: 'visible',
            blockAlign: 'start',
          },
        ],
        regions: [
          {
            id: 1,
            geometryRevision: 1,
            shape: 'rectangle',
            exclusionStart: 0,
            exclusionCount: 0,
            writingMode: 'horizontal-tb',
            textOrientation: 'mixed',
            inlineStart: 0,
            blockStart: 0,
            inlineEnd: 1000,
            blockEnd: 1000,
            clipInlineStart: 0,
            clipBlockStart: 0,
            clipInlineEnd: 1000,
            clipBlockEnd: 1000,
          },
        ],
      });

      expect(list.draws.length).toBeGreaterThan(0);
      expect(device.resources.size).toBeGreaterThan(0);
      expect(device.resourcesByName.has('glyphColors')).toBe(true);
      expect(device.buffersByName.has('origin')).toBe(true);
      expect(device.buffersByName.has('size')).toBe(true);
      expect(device.buffersByName.has('color')).toBe(true);
      expect(device.shader.variant.language).toBe('typegpu');
      expect(device.shader.vertexWgsl).toContain('glyphExampleVertex');
      expect(device.shader.fragmentWgsl).toContain('glyphExampleFragment');
      expect(device.submissions).toHaveLength(1);
      expect(device.submissions[0]?.draws.length).toBeGreaterThan(0);
    } finally {
      engine.dispose();
      font.dispose();
    }
  } finally {
    runtime.dispose();
  }
});

test('realizes a supplied indexed geometry resource from the portable declaration', () => {
  const shader: ExampleRendererShader = {
    ...exampleRendererShader,
    variant: Object.freeze({
      ...exampleRendererShader.variant,
      geometry: glyphExampleSuppliedGeometryDeclaration,
      geometryResource: glyphExampleSuppliedGeometryDeclaration.resource,
    }),
  };
  const device = new RecordingExampleRendererDevice(shader);
  device.createResource(42, 'glyphGeometry', glyphExampleIndexedQuadGeometry);
  const techniqueWireId = 7;

  const drawList: ExampleDrawList = {
    engineRevision: 1,
    planRevision: 1,
    publicationGeneration: 1,
    draws: [
      {
        id: 1,
        programId: techniqueWireId,
        programVariant: 0,
        flags: 0,
        materialId: 1,
        clipId: 0,
        depthKey: 0,
        transformId: 0,
        primitiveStart: 0,
        primitiveCount: 1,
        bufferStart: 0,
        bufferCount: 0,
        resourceStart: 0,
        resourceCount: 1,
        orderToken: 0,
        indirectBufferId: 0,
        indirectOffset: 0,
      },
    ],
    resourceRecords: [{ id: 42, generation: 1, techniqueId: techniqueWireId, referenceId: 0, action: 0 }],
    bufferRecords: [],
    primitiveRecords: [
      {
        id: 1,
        techniqueId: techniqueWireId,
        programId: techniqueWireId,
        programVariant: 0,
        kind: 0,
        recordCount: 5,
        recordIndex: 0,
        resourceId: 42,
        resourceGeneration: 1,
      },
    ],
    patches: [],
    retirements: [],
    resources: { count: 0, stride: 0, records: new Uint8Array(0) },
    buffers: { count: 0, stride: 0, records: new Uint8Array(0) },
    primitives: { count: 0, stride: 0, records: new Uint8Array(0) },
    diagnostics: { count: 0, stride: 0, records: new Uint8Array(0) },
  };

  expect(() =>
    device.submit({
      ...drawList,
      primitiveRecords: [{ ...drawList.primitiveRecords[0]!, resourceId: 41 }],
    }),
  ).toThrow('does not reference geometry resource');
  expect(() =>
    device.submit({
      ...drawList,
      draws: [...drawList.draws, { ...drawList.draws[0]!, id: 2, primitiveStart: 1 }],
    }),
  ).toThrow('unknown primitive');
  expect(device.realizedDraws).toEqual([]);
  expect(device.submissions).toEqual([]);
  device.submit(drawList);
  expect(device.realizedDraws).toHaveLength(1);
  expect(device.realizedDraws[0]?.geometry).toMatchObject({
    kind: 'supplied',
    indexed: true,
    vertexCount: 4,
    indexCount: 6,
    instanceCount: 5,
    resourceName: 'glyphGeometry',
  });
});

test('does not retire a newer resource generation through a stale retirement', () => {
  const device = new RecordingExampleRendererDevice();
  device.createResource(42, 'glyphGeometry', glyphExampleIndexedQuadGeometry, 3);

  device.retireResource(42, 2);
  expect(device.resources.has(42)).toBe(true);
  expect(device.retirements).toEqual([]);

  device.retireResource(42, 3);
  expect(device.resources.has(42)).toBe(false);
  expect(device.retirements).toEqual([42]);
});

test('applies generation-aware write, fill, copy, and retirement patches transactionally', () => {
  const device = new RecordingExampleRendererDevice();
  const first = bufferRecord(1, 1, 16, 1);
  const second = bufferRecord(2, 1, 16, 2);
  device.applyBufferPlan(
    [first, second],
    [
      patch(textShaperAbi.engine.patchOpcodes.allocateOrResize, 1, 1, 0, 16),
      patch(textShaperAbi.engine.patchOpcodes.allocateOrResize, 2, 1, 0, 16),
      patch(textShaperAbi.engine.patchOpcodes.write, 1, 1, 4, 4, { payload: new Uint8Array([5, 6, 7, 8]) }),
      patch(textShaperAbi.engine.patchOpcodes.fill, 1, 1, 8, 4, { fillValue: 0x0c0b_0a09 }),
      patch(textShaperAbi.engine.patchOpcodes.copy, 2, 1, 0, 8, { sourceBufferId: 1, sourceOffset: 4 }),
    ],
    [],
  );

  expect(device.bufferBytes(1, 1)).toEqual(new Uint8Array([0, 0, 0, 0, 5, 6, 7, 8, 9, 10, 11, 12, 0, 0, 0, 0]));
  expect(device.bufferBytes(2, 1)?.subarray(0, 8)).toEqual(new Uint8Array([5, 6, 7, 8, 9, 10, 11, 12]));

  const before = device.bufferBytes(1, 1)?.slice();
  expect(() =>
    device.applyBufferPlan(
      [first, second],
      [patch(textShaperAbi.engine.patchOpcodes.write, 1, 1, 15, 2, { payload: new Uint8Array([1, 2]) })],
      [],
    ),
  ).toThrow('buffer patch exceeds its buffer');
  expect(device.bufferBytes(1, 1)).toEqual(before);

  const replacement = bufferRecord(1, 2, 8, 1);
  device.applyBufferPlan(
    [replacement, second],
    [
      patch(textShaperAbi.engine.patchOpcodes.allocateOrResize, 1, 2, 0, 8),
      patch(textShaperAbi.engine.patchOpcodes.write, 1, 2, 0, 4, { payload: new Uint8Array([13, 14, 15, 16]) }),
    ],
    [retirement(textShaperAbi.engine.retirementKinds.buffer, 1, 1)],
  );
  expect(device.bufferBytes(1, 1)).toBeUndefined();
  expect(device.bufferBytes(1, 2)).toEqual(new Uint8Array([13, 14, 15, 16, 0, 0, 0, 0]));
  expect(device.bufferBytes(2, 1)?.subarray(0, 8)).toEqual(new Uint8Array([5, 6, 7, 8, 9, 10, 11, 12]));
});

test('creates and rolls back resource batches atomically', () => {
  const device = new RecordingExampleRendererDevice();
  device.createResource(41, 'committed', { value: 1 });
  expect(device.resources.get(41)).toEqual({ value: 1 });

  const registration = device.createResources([{ id: 42, generation: 1, name: 'temporary', resource: { value: 2 } }]);
  expect(device.resources.has(42)).toBe(true);
  registration.rollback();
  expect(device.resources.has(42)).toBe(false);

  expect(() =>
    device.createResources([
      { id: 42, generation: 1, name: 'duplicate', resource: { value: 3 } },
      { id: 43, generation: 1, name: 'duplicate', resource: { value: 4 } },
    ]),
  ).toThrow('already bound to id 42');
  expect(device.resources.has(42)).toBe(false);
  expect(device.resources.has(43)).toBe(false);
  expect(device.resources.get(41)).toEqual({ value: 1 });
});

function bufferRecord(
  id: number,
  generation: number,
  byteLength: number,
  policyBufferId: number,
): TextEngineBufferRecord {
  return {
    id,
    generation,
    scalarType: textShaperAbi.policy.scalarTypes.u32,
    vectorWidth: 1,
    capacityRecords: byteLength / 4,
    byteLength,
    policyBufferId,
  };
}

function patch(
  opcode: number,
  bufferId: number,
  bufferGeneration: number,
  destinationOffset: number,
  byteLength: number,
  overrides: Partial<TextEnginePatchRecord> = {},
): TextEnginePatchRecord {
  return {
    opcode,
    bufferId,
    bufferGeneration,
    destinationOffset,
    byteLength,
    payload: undefined,
    fillValue: 0,
    sourceBufferId: 0,
    sourceOffset: 0,
    ...overrides,
  };
}

function retirement(kind: number, id: number, generation: number): TextEngineRetirementRecord {
  return { kind, id, generation, afterPublicationGeneration: 1, byteOffset: 0, byteLength: 0 };
}
