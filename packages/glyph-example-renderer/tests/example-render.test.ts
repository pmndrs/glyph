import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createTextRuntime, rasterBake } from '@pmndrs/glyph';
import { bakeFont } from '@pmndrs/glyph/bake';
import { textRuntimeShaper } from '@pmndrs/glyph/core';
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
      const binding = engine.registerFont(font);
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
