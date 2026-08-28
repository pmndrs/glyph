import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createFontStack, defineRasterTechnique, loadFont, rasterBake } from '@pmndrs/glyph';
import { bakeFont } from '@pmndrs/glyph/bake';
import {
  createTextRuntime,
  textShaperAbi,
  defineTechniqueSchema,
  programId,
  registerRasterPlanProgram,
  techniqueId,
  TextEngineTransportError,
  type AsyncPlanTarget,
  type TextEngineBufferRecord,
  type TextEnginePatchRecord,
  type TextEngineRetirementRecord,
  type PlanTarget,
  type PlanTargetControl,
} from '@pmndrs/glyph/core';
import { afterEach, expect, test } from 'vitest';

import glyphExampleBaker from '@pmndrs/glyph-example-raster/baker';
import {
  glyphExample,
  glyphExampleIndexedQuadGeometry,
  glyphExampleSchema,
  glyphExampleSuppliedGeometryDeclaration,
} from '@pmndrs/glyph-example-raster';
import {
  exampleRendererShader,
  RecordingExampleRendererDevice,
  type ExampleDrawList,
  type ExamplePendingResources,
  type ExamplePendingSubmission,
  type ExampleRendererDevice,
  type ExampleRendererResourceInput,
  type ExampleRendererShader,
} from '../src/index.js';
import { ExampleTextEngine } from '../src/engine.js';
import { exampleRenderPolicyDescriptor } from '../src/policy.js';

const source = new URL('../../../apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf', import.meta.url);
const shaperWasm = new URL('../../glyph/dist/text-shaper.wasm', import.meta.url);
const temporaryDirectories: string[] = [];
const EXPECTED_RECOVERED_TEXT_GLYPHS = 4;

class ThrowOnceExampleRendererDevice implements ExampleRendererDevice {
  readonly primary = new RecordingExampleRendererDevice();
  readonly oracle = new RecordingExampleRendererDevice();
  readonly shader = this.primary.shader;
  readonly #oracleGenerations = new Set<number>();
  failNextResourceCommit = false;
  failNextSubmission = false;
  discardedResourceBatches = 0;

  get resources() {
    return this.primary.resources;
  }
  get resourcesByName() {
    return this.primary.resourcesByName;
  }
  get buffersByName() {
    return this.primary.buffersByName;
  }
  get submissions() {
    return this.primary.submissions;
  }
  get realizedDraws() {
    return this.primary.realizedDraws;
  }

  prepareResources(resources: readonly ExampleRendererResourceInput[]): ExamplePendingResources {
    const primary = this.primary.prepareResources(resources);
    const oracle = this.oracle.prepareResources(resources);
    return Object.freeze({
      commit: () => {
        if (this.failNextResourceCommit) {
          this.failNextResourceCommit = false;
          throw new Error('injected resource commit failure');
        }
        oracle.commit();
        primary.commit();
      },
      discard: () => {
        this.discardedResourceBatches += 1;
        oracle.discard();
        primary.discard();
      },
    });
  }

  prepareSubmission(drawList: ExampleDrawList): ExamplePendingSubmission {
    const generation = drawList.publicationGeneration;
    const oracle = this.#oracleGenerations.has(generation) ? undefined : this.oracle.prepareSubmission(drawList);
    if (this.failNextSubmission) {
      this.failNextSubmission = false;
      oracle?.commit();
      this.#oracleGenerations.add(generation);
      throw new Error('injected submission failure');
    }
    const primary = this.primary.prepareSubmission(drawList);
    return Object.freeze({
      commit: () => {
        oracle?.commit();
        primary.commit();
        this.#oracleGenerations.add(generation);
        return true;
      },
      discard: () => {
        oracle?.discard();
        primary.discard();
      },
    });
  }
}

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
  const device = new ThrowOnceExampleRendererDevice();
  const engine = new ExampleTextEngine(runtime, device);
  try {
    const bytes = await readFile(output);
    const font = await loadFont({
      input: { baked: `data:model/gltf-binary;base64,${bytes.toString('base64')}` },
      raster: { technique: glyphExample, options: { paletteSeed: 7 } },
    });
    try {
      const flowHost = runtime.createTextEngineHost({ integration: 'glyph-example-renderer-test/flow-retention' });
      type InstrumentedRawSession = { measureParagraph: (...arguments_: unknown[]) => unknown };
      const instrumentedHost = flowHost as unknown as {
        _createRawSession: (options: unknown) => InstrumentedRawSession;
      };
      const createRawSession = instrumentedHost._createRawSession.bind(instrumentedHost);
      let paragraphQueries = 0;
      instrumentedHost._createRawSession = (options) => {
        const session = createRawSession(options);
        const measureParagraph = session.measureParagraph.bind(session);
        session.measureParagraph = (...arguments_) => {
          paragraphQueries += 1;
          return measureParagraph(...arguments_);
        };
        return session;
      };
      const flowPolicy = flowHost.installPolicy(exampleRenderPolicyDescriptor(flowHost.wireIdentities));
      const flowFont = flowHost.bindFontStack(createFontStack(font));
      const flowTransform = flowHost.createTransformBinding();
      const flowLimits = {
        maxParagraphs: 2,
        maxClusters: 64,
        maxLines: 16,
        maxRegions: 4,
        maxExclusions: 4,
        maxInlineObjects: 1,
        maxSlotsPerBand: 4,
        maxOutputBytes: 128 * 1024,
      } as const;
      let flowTargetAcceptances = 0;
      let flowControl: PlanTargetControl | undefined;
      let requestCheckpointDuringAcceptance = false;
      const flowPublicationFlags: number[] = [];
      const flowTarget: PlanTarget = {
        delivery: 'borrowed',
        accept: (candidate) => {
          expect(() => flowHost.dispose()).toThrow('borrowed render plan');
          flowTargetAcceptances += 1;
          flowPublicationFlags.push(candidate.plan.u32(textShaperAbi.layouts.engineResult.flags));
          if (requestCheckpointDuringAcceptance) {
            requestCheckpointDuringAcceptance = false;
            flowControl!.requestCheckpoint();
          }
          return { accepted: true };
        },
        dispose() {},
      };
      const flowSession = flowHost.createSession({
        policy: flowPolicy,
        target: (control) => {
          flowControl = control;
          return flowTarget;
        },
        limits: flowLimits,
        requestCapacity: 4096,
        resultCapacity: 128 * 1024,
        textCapacity: 1024,
      });
      const mutableWidth = { mode: 'at-most' as const, size: 512 };
      const mutableRegion = {
        transform: flowTransform,
        shape: 'rectangle' as const,
        writingMode: 'horizontal-tb' as const,
        textOrientation: 'mixed' as const,
        inlineStart: 0,
        blockStart: 0,
        inlineEnd: 512,
        blockEnd: 256,
        clipInlineStart: 0,
        clipBlockStart: 0,
        clipInlineEnd: 512,
        clipBlockEnd: 256,
      };
      const flowText = flowSession.createText({
        font: flowFont,
        text: 'a',
        style: { fontSize: 32 },
        contentBox: { width: mutableWidth },
        flow: { regions: [{ region: mutableRegion }] },
      });
      expect(() => flowSession.createText({ font: flowFont, text: 'duplicate', order: 0 })).toThrow(
        /order 0 is already in use/,
      );
      expect(() => flowSession.createText({ font: flowFont, text: 'invalid', style: { fontSize: 0 } })).toThrow(
        /font size must be positive/,
      );
      expect(() =>
        flowText.update({
          contentBox: { width: { mode: 'at-most', size: 512 }, firstLineIndent: -1 },
        }),
      ).toThrow(/indent and spacing must be nonnegative/);
      flowTransform.dispose();
      mutableWidth.size = Number.NaN;
      mutableRegion.inlineEnd = Number.NaN;
      expect(flowText.layout().glyphCount).toBe(1);
      expect(flowText.glyphs().glyphCount).toBe(1);
      expect(flowTargetAcceptances).toBe(0);
      flowText.update({ text: 'abcd' });
      expect(flowText.layout().glyphCount).toBe(4);
      expect(flowText.glyphs().glyphCount).toBe(4);
      expect(flowTargetAcceptances).toBe(0);
      expect(flowSession.publish()).toEqual({ accepted: true });
      expect(flowTargetAcceptances).toBe(1);
      const publishUnchecked = flowSession.publish.bind(flowSession) as (options: unknown) => unknown;
      expect(() => publishUnchecked({ policyParameters: new Uint8Array() })).toThrow(/not supported/);
      expect(flowTargetAcceptances).toBe(1);
      flowText.update({ text: 'abcde' });
      expect(flowSession.publish({ semanticViews: 'measurement' })).toEqual({ accepted: true });
      const queriesAfterMeasuredPublish = paragraphQueries;
      expect(flowText.layout().glyphCount).toBe(5);
      expect(paragraphQueries).toBe(queriesAfterMeasuredPublish);
      expect(flowText.glyphs().glyphCount).toBe(5);
      expect(paragraphQueries).toBe(queriesAfterMeasuredPublish + 1);
      flowText.update({ text: 'abcdef' });
      expect(flowSession.publish({ semanticViews: 'layout-inspection' })).toEqual({ accepted: true });
      const queriesAfterInspectedPublish = paragraphQueries;
      expect(flowText.layout().glyphCount).toBe(6);
      expect(flowText.glyphs().glyphCount).toBe(6);
      expect(paragraphQueries).toBe(queriesAfterInspectedPublish);
      expect(flowTargetAcceptances).toBe(3);
      flowControl!.requestCheckpoint();
      expect(flowSession.publish()).toEqual({ accepted: true });
      expect(flowPublicationFlags.at(-1)! & textShaperAbi.engine.resultFlags.checkpoint).not.toBe(0);
      requestCheckpointDuringAcceptance = true;
      flowText.update({ text: 'abcdefg' });
      expect(flowSession.publish()).toEqual({ accepted: true });
      expect(flowSession.publish()).toEqual({ accepted: true });
      expect(flowPublicationFlags.at(-1)! & textShaperAbi.engine.resultFlags.checkpoint).not.toBe(0);
      flowText.dispose();
      expect(() => flowText.layout()).toThrow('disposed');
      const sessionOwnedText = flowSession.createText({ font: flowFont, text: 'session-owned' });
      expect(sessionOwnedText.layout().glyphCount).toBeGreaterThan(0);
      expect(() => flowSession.createText({ font: flowFont, text: 'too-many-pending' })).toThrow(
        /pending paragraph mutations exceed limits.maxParagraphs/,
      );
      flowSession.dispose();
      expect(sessionOwnedText.disposed).toBe(true);
      expect(() => sessionOwnedText.layout()).toThrow('disposed');

      let returnedBuffer: ArrayBuffer | undefined;
      let reusedBuffers = 0;
      let corruptReturn = false;
      const asyncTarget: AsyncPlanTarget = {
        delivery: 'owned',
        maximumPlanBytes: flowLimits.maxOutputBytes,
        async accept(candidate) {
          if (candidate.bytes.buffer === returnedBuffer) reusedBuffers += 1;
          const workerBytes = structuredClone(candidate.bytes, { transfer: [candidate.bytes.buffer] });
          if (corruptReturn) {
            const layout = textShaperAbi.layouts.engineResult;
            new DataView(workerBytes.buffer).setUint32(layout.planRevision, candidate.planRevision + 1, true);
          }
          const returnedBytes = structuredClone(workerBytes, { transfer: [workerBytes.buffer] });
          returnedBuffer = returnedBytes.buffer;
          return { accepted: true, returnedBytes };
        },
        dispose() {},
      };
      const asyncSession = flowHost.createSession({
        policy: flowPolicy,
        target: () => asyncTarget,
        limits: flowLimits,
        requestCapacity: 4096,
        resultCapacity: flowLimits.maxOutputBytes,
        textCapacity: 1024,
      });
      const asyncText = asyncSession.createText({
        font: flowFont,
        text: { text: 'abc', spans: [{ start: 1, end: 1, style: { fontSize: 12 } }] },
      });
      expect(await asyncSession.publish()).toEqual({ accepted: true });
      asyncText.update({ text: 'def' });
      expect(await asyncSession.publish()).toEqual({ accepted: true });
      asyncText.update({ text: 'ghi' });
      expect(await asyncSession.publish()).toEqual({ accepted: true });
      expect(reusedBuffers).toBe(1);
      corruptReturn = true;
      asyncText.update({ text: 'jkl' });
      await expect(asyncSession.publish()).rejects.toBeInstanceOf(TextEngineTransportError);
      asyncSession.dispose();
      flowHost.dispose();

      const foreignFont = Object.create(font) as typeof font;
      Object.defineProperty(foreignFont, 'technique', {
        value: { ...font.technique, id: 'studio.other-technique' },
      });
      expect(() => engine.bindFont(foreignFont)).toThrow('cannot render');
      expect(device.resources.size).toBe(0);

      const stackBinding = engine.bindFontStack(createFontStack(font));
      expect(() => engine.createText({ font: stackBinding, text: 'invalid', fontSize: Number.NaN })).toThrow(
        'fontSize',
      );
      const text = engine.createText({ font: stackBinding, text: 'glyph', fontSize: 48, width: 1000, height: 1000 });

      device.failNextResourceCommit = true;
      expect(() => text.publish()).toThrow('injected resource commit failure');
      expect(device.discardedResourceBatches).toBe(1);
      expect(device.resources.size).toBe(0);

      text.update({ text: 'Glyph' });
      const list = text.publish();

      expect(list.draws.length).toBeGreaterThan(0);
      expect(device.resources.size).toBeGreaterThan(0);
      expect(device.resourcesByName.has('glyphGeometry')).toBe(true);
      expect(device.buffersByName.has('origin')).toBe(true);
      expect(device.buffersByName.has('size')).toBe(true);
      expect(device.buffersByName.has('color')).toBe(true);
      expect(device.shader.variant.language).toBe('typegpu');
      expect(device.shader.vertexWgsl).toContain('glyphExampleVertex');
      expect(device.shader.fragmentWgsl).toContain('glyphExampleFragment');
      expect(device.submissions).toEqual([list]);
      const declaredBuffers = Object.keys(device.shader.variant.buffers);
      expect(device.realizedDraws).toHaveLength(list.draws.length);
      for (const [index, realized] of device.realizedDraws.entries()) {
        const draw = list.draws[index]!;
        const primitive = list.primitiveRecords[draw.primitiveStart]!;
        expect(realized.draw).toBe(draw);
        expect(realized.primitive).toBe(primitive);
        expect(realized.geometry.instanceCount).toBe(primitive.recordCount);
        for (const name of declaredBuffers) {
          expect(realized.buffers.get(name), name).toBeInstanceOf(Uint8Array);
        }
        expect(realized.resources.get('glyphGeometry')).toBeDefined();
      }
      const acceptedDraws = [...device.realizedDraws];
      const retainedBufferTable = list.buffers.records.slice();
      const retainedPatchPayloads = list.patches.map(({ payload }) => payload?.slice());
      const noOp = engine.publish();
      expect(noOp.draws).toEqual([]);
      expect(device.realizedDraws).toEqual(acceptedDraws);

      device.failNextSubmission = true;
      text.update({ text: 'WXYZ' });
      expect(() => text.publish()).toThrow('injected submission failure');
      text.update({ text: 'wxyz' });
      const recovered = text.publish();
      expect(recovered.primitiveRecords.reduce((count, primitive) => count + primitive.recordCount, 0)).toBe(
        EXPECTED_RECOVERED_TEXT_GLYPHS,
      );
      expect(list.buffers.records).toEqual(retainedBufferTable);
      expect(list.patches.map(({ payload }) => payload)).toEqual(retainedPatchPayloads);
      expect(bufferSnapshot(device.primary.buffers)).toEqual(bufferSnapshot(device.oracle.buffers));
      text.update({ text: 'updated', color: '#ff8040' });
      expect(text.publish().draws.length).toBeGreaterThan(0);
      expect(text.text).toBe('updated');
      text.dispose();
      expect(() => text.publish()).toThrow('disposed');
      engine.publish();
      const replacement = engine.createText({
        font: stackBinding,
        text: 'replacement',
        fontSize: 42,
        width: 512,
      });
      expect(replacement.publish().draws.length).toBeGreaterThan(0);
      replacement.dispose();
      engine.publish();
      engine.dispose();
      expect(() => engine.bindFont(font)).toThrow('disposed');
      expect(device.discardedResourceBatches).toBe(1);
      stackBinding.dispose();
    } finally {
      engine.dispose();
      font.dispose();
    }
  } finally {
    runtime.dispose();
  }
});

test('realizes a supplied indexed geometry resource from an authenticated portable declaration', async () => {
  expect(
    () =>
      new RecordingExampleRendererDevice({
        ...exampleRendererShader,
        variant: {
          ...exampleRendererShader.variant,
          geometry: glyphExampleSuppliedGeometryDeclaration,
        },
      }),
  ).toThrow('registered portable geometry and resource schema');

  const suppliedTechnique = defineRasterTechnique({
    id: 'test.example-renderer-supplied-geometry',
    kind: 'test',
    extension: 'TEST_example_renderer_geometry',
    version: 0,
    descriptor: () => ({}),
    async decode() {
      return {};
    },
    dispose() {},
  });
  const suppliedSchema = defineTechniqueSchema({
    technique: suppliedTechnique.id,
    scope: 'glyph',
    binding: {},
    buffers: glyphExampleSchema.buffers,
    resources: {
      glyphColors: { kind: 'buffer' },
      glyphGeometry: {
        kind: 'geometry' as const,
        attributes: Object.freeze([
          { semantic: 'position' as const, componentType: 'f32' as const, components: 3 as const },
          { semantic: 'uv' as const, componentType: 'f32' as const, components: 2 as const },
        ]),
      },
    },
    render: { resource: 'glyphColors', geometry: glyphExampleSuppliedGeometryDeclaration },
  });
  const suppliedPlan = registerRasterPlanProgram({
    technique: suppliedTechnique,
    schema: suppliedSchema,
    policyBody() {
      throw new Error('not used by the device geometry fixture');
    },
    compileFont() {
      throw new Error('not used by the device geometry fixture');
    },
  });
  const shader: ExampleRendererShader = {
    ...exampleRendererShader,
    variant: Object.freeze({
      ...exampleRendererShader.variant,
      techniqueId: suppliedTechnique.id,
      geometry: suppliedSchema.render.geometry,
      resources: suppliedSchema.resources,
    }),
    programVariant: suppliedPlan.programVariant ?? 0,
  };
  const device = new RecordingExampleRendererDevice(shader);
  device.createResource(41, 'glyphColors', { kind: 'buffer', bytes: new Uint8Array(16), stride: 4 });
  device.createResource(42, 'glyphGeometry', glyphExampleIndexedQuadGeometry);
  const bufferRecords = bindShaderContract(device);
  const techniqueWireId = techniqueId(shader.variant.techniqueId);
  const programWireId = programId(shader.variant.techniqueId, shader.programNamespace, shader.programName);

  const drawList: ExampleDrawList = {
    engineRevision: 1,
    planRevision: 1,
    publicationGeneration: 1,
    draws: [
      {
        id: 1,
        programId: programWireId,
        programVariant: 0,
        flags: 0,
        materialId: 1,
        clipId: 0,
        depthKey: 0,
        transformId: 0,
        primitiveStart: 0,
        primitiveCount: 1,
        bufferStart: 0,
        bufferCount: bufferRecords.length,
        resourceStart: 0,
        resourceCount: 2,
        orderToken: 0,
        indirectBufferId: 0,
        indirectOffset: 0,
      },
    ],
    resourceRecords: [
      { id: 51, generation: 1, techniqueId: techniqueWireId, resourceKind: 1, referenceId: 41, action: 1 },
      { id: 52, generation: 1, techniqueId: techniqueWireId, resourceKind: 1, referenceId: 42, action: 1 },
    ],
    bufferRecords,
    primitiveRecords: [
      {
        id: 1,
        techniqueId: techniqueWireId,
        programId: programWireId,
        programVariant: 0,
        kind: textShaperAbi.engine.primitiveKinds.glyph,
        recordCount: 5,
        recordIndex: 0,
        resourceId: 51,
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
    device.prepareSubmission({
      ...drawList,
      resourceRecords: drawList.resourceRecords.slice(0, 1),
      draws: [{ ...drawList.draws[0]!, resourceCount: 1 }],
    }),
  ).toThrow('missing its required "glyphGeometry" resource');
  expect(() =>
    device.prepareSubmission({
      ...drawList,
      draws: [...drawList.draws, { ...drawList.draws[0]!, id: 2, primitiveStart: 1 }],
    }),
  ).toThrow('primitive span exceeds its table');
  expect(device.realizedDraws).toEqual([]);
  expect(device.submissions).toEqual([]);
  const rejected = device.prepareSubmission(drawList);
  expect(() =>
    rejected.publish(() => {
      throw new Error('injected backend rejection');
    }),
  ).toThrow('injected backend rejection');
  expect(device.realizedDraws).toEqual([]);
  expect(device.submissions).toEqual([]);
  const pending = device.prepareSubmission(drawList);
  expect(pending.replacesRenderState).toBe(true);
  expect(device.realizedDraws).toEqual([]);
  pending.commit();
  pending.commit();
  expect(device.realizedDraws).toHaveLength(1);
  expect(device.realizedDraws[0]?.geometry).toMatchObject({
    kind: 'supplied',
    indexed: true,
    vertexCount: 4,
    indexCount: 6,
    instanceCount: 5,
    resourceName: 'glyphGeometry',
  });

  const stale = device.prepareSubmission({ ...drawList, publicationGeneration: 2 });
  const retirementOnly = device.prepareSubmission({
    ...drawList,
    publicationGeneration: 3,
    draws: [],
    resourceRecords: [],
    bufferRecords: [],
    primitiveRecords: [],
    retirements: [
      retirement(textShaperAbi.engine.retirementKinds.resource, 51, 1),
      retirement(textShaperAbi.engine.retirementKinds.resource, 52, 1),
    ],
  });
  expect(retirementOnly.replacesRenderState).toBe(true);
  retirementOnly.commit();
  expect(device.realizedDraws).toEqual([]);
  expect(device.resources.has(41)).toBe(true);
  expect(device.resources.has(42)).toBe(true);
  stale.commit();
  expect(device.realizedDraws).toEqual([]);

  device.prepareSubmission({ ...drawList, publicationGeneration: 4 }).commit();
  expect(device.realizedDraws).toHaveLength(1);

  const idle = device.prepareSubmission({
    ...drawList,
    publicationGeneration: 5,
    draws: [],
    resourceRecords: [],
    bufferRecords: [],
    primitiveRecords: [],
    retirements: [],
  });
  expect(idle.replacesRenderState).toBe(false);
  const release = Promise.withResolvers<void>();
  const idleCommit = idle.publishAsync(() => release.promise);
  expect(() => device.prepareResources([])).toThrow('asynchronous publication is in progress');
  expect(() => device.applyBufferPlan([], [], [])).toThrow('asynchronous publication is in progress');
  release.resolve();
  await expect(idleCommit).resolves.toBe(true);
});

test('does not retire a newer resource generation through a stale retirement', () => {
  const device = new RecordingExampleRendererDevice();
  device.createResource(42, 'glyphGeometry', portableGeometry(4), 3);

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
  expect(() => device.applyBufferPlan([{ ...first, programId: techniqueId('foreign-program') }], [], [])).toThrow(
    'belongs to a different renderer program',
  );
  expect(() => device.applyBufferPlan([], [], [retirement(99, 1, 1)])).toThrow(
    'unsupported text-engine retirement kind',
  );
  expect(() => device.applyBufferPlan([{ ...first, capacityRecords: 3 }], [], [])).toThrow(
    'requires tightly packed physical buffers',
  );
  expect(device.bufferBytes(1, 1)).toBeUndefined();
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

test('prepares resources without restoring stale device state', () => {
  const device = new RecordingExampleRendererDevice();
  const first = portableGeometry(4);
  device.createResource(42, 'glyphGeometry', first, 1);
  expect(device.resources.get(42)).toBe(first);

  const second = portableGeometry(8);
  const pending = device.prepareResources([{ id: 42, generation: 2, name: 'glyphGeometry', resource: second }]);
  expect(device.resources.get(42)).toBe(first);
  pending.commit();
  expect(device.resources.get(42)).toBe(second);

  expect(() =>
    device.prepareResources([
      { id: 42, generation: 3, name: 'glyphGeometry', resource: portableGeometry(12) },
      { id: 42, generation: 3, name: 'glyphGeometry', resource: portableGeometry(16) },
    ]),
  ).toThrow('changed content without changing generation');
  expect(device.resources.get(42)).toBe(second);

  const staleResource = portableGeometry(12);
  const stale = device.prepareResources([{ id: 42, generation: 3, name: 'glyphGeometry', resource: staleResource }]);
  const newer = portableGeometry(16);
  device.createResource(42, 'glyphGeometry', newer, 4);
  stale.commit();
  expect(device.resources.get(42)).toBe(newer);
});

function portableGeometry(marker: number) {
  const bytes = new Uint8Array(glyphExampleIndexedQuadGeometry.bytes);
  bytes[0] = marker;
  return { ...glyphExampleIndexedQuadGeometry, bytes };
}

function bindShaderContract(device: RecordingExampleRendererDevice): readonly TextEngineBufferRecord[] {
  const selectedProgramId = programId(
    device.shader.variant.techniqueId,
    device.shader.programNamespace,
    device.shader.programName,
  );
  const records = Object.values(device.shader.variant.buffers).map((buffer, index) => ({
    id: index + 1,
    generation: 1,
    programId: selectedProgramId,
    scalarType: textShaperAbi.policy.scalarTypes[buffer.scalar],
    vectorWidth: buffer.vectorWidth,
    capacityRecords: 8,
    byteLength: 8 * buffer.vectorWidth * 4,
    policyBufferId: buffer.id,
  }));
  device.applyBufferPlan(
    records,
    records.map((record) => ({
      opcode: textShaperAbi.engine.patchOpcodes.allocateOrResize,
      bufferId: record.id,
      bufferGeneration: record.generation,
      destinationOffset: 0,
      byteLength: record.byteLength,
      payload: undefined,
      fillValue: 0,
      sourceBufferId: 0,
      sourceOffset: 0,
    })),
    [],
  );
  return records;
}

function bufferRecord(
  id: number,
  generation: number,
  byteLength: number,
  policyBufferId: number,
): TextEngineBufferRecord {
  return {
    id,
    generation,
    programId: programId(
      exampleRendererShader.variant.techniqueId,
      exampleRendererShader.programNamespace,
      exampleRendererShader.programName,
    ),
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

function bufferSnapshot(buffers: ReadonlyMap<number, Uint8Array>): readonly (readonly [number, readonly number[]])[] {
  return [...buffers].sort(([left], [right]) => left - right).map(([id, bytes]) => [id, Array.from(bytes)] as const);
}

function retirement(kind: number, id: number, generation: number): TextEngineRetirementRecord {
  return { kind, id, generation, afterPublicationGeneration: 1, byteOffset: 0, byteLength: 0 };
}
