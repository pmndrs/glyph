import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import * as THREE from 'three/webgpu';

import {
  defineTechniqueSchema,
  registerRasterPlanProgram,
  techniqueProgram,
  RenderPlannerBackpressureError,
  RenderPlannerDisposedError,
  PlanTransportError,
  id,
} from '../../dist/core.js';
import { textShaperAbi } from '../../dist/generated/text-shaper-abi.js';
import {
  createImmutableFontBacking,
  createImmutableFontLease,
  createImmutableFontVariant,
} from '../../dist/loaded-font.js';
import { FontRegistry } from '../../dist/loader.js';
import { defineRasterResourceId, defineRasterTechnique } from '../../dist/raster-technique.js';
import { createGlyphEngine } from '../../dist/glyph-engine.js';
import { markStorageAttributeUpdated, ThreeTextRenderPlanExecutor } from '../../dist/three/engine-plan-target.js';
import { ThreeTextEngineCoordinator } from '../../dist/three/engine-coordinator.js';
import { registerThreeRasterPlanProgram } from '../../dist/three.js';
import { indexedQuadGeometry } from '../support/portable-geometry.mjs';

const fixtureUrl = new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);
const wasmUrl = new URL('../../dist/text-shaper.wasm', import.meta.url);
const ORIGIN_BUFFER_ID = id.buffer('test.three-supplied-geometry/origin');

const suppliedGeometryTechnique = defineRasterTechnique({
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
  technique: suppliedGeometryTechnique,
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
  technique: suppliedGeometryTechnique,
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

const limits = Object.freeze({
  maxParagraphs: 4,
  maxClusters: 64,
  maxLines: 16,
  maxRegions: 4,
  maxExclusions: 1,
  maxInlineObjects: 1,
  maxSlotsPerBand: 4,
  maxOutputBytes: 4 * 1024 * 1024,
});

test('sparse detached writes cap upload-range bookkeeping', () => {
  const attribute = new THREE.StorageInstancedBufferAttribute(new Float32Array(160 * 16), 4);
  for (let record = 0; record < 80; record += 2) markStorageAttributeUpdated(attribute, record * 16, 16);
  assert.ok(attribute.updateRanges.length <= 32, 'range merging must stay bounded for sparse physics writes');
  const coveredStart = Math.min(...attribute.updateRanges.map((range) => range.start));
  const coveredEnd = Math.max(...attribute.updateRanges.map((range) => range.start + range.count));
  assert.equal(coveredStart, 0);
  assert.ok(coveredEnd >= 79 * 16, 'the capped range set must retain every dirty record');
  attribute.dispose();
});

async function fontBacking() {
  const registry = new FontRegistry();
  const registered = await registry.registerAsset(await readFile(fixtureUrl));
  return createImmutableFontBacking(registered);
}

function fontVariant(backing, resource, geometry) {
  return createImmutableFontLease(
    createImmutableFontVariant({
      backing,
      technique: suppliedGeometryTechnique,
      raster: { dispose() {} },
      data: { resource, geometry },
    }),
  );
}

async function rendererHarness(limitOverrides = {}) {
  const glyphEngine = await createGlyphEngine({ wasm: await readFile(wasmUrl) });
  const coordinator = new ThreeTextEngineCoordinator(glyphEngine);
  const drawRoot = new THREE.Object3D();
  const object = new THREE.Object3D();
  drawRoot.add(object);
  const transform = coordinator.bindTransform(object);
  let target;
  const planner = coordinator.backend.createPlanner({
    policy: coordinator.policy,
    capabilitySet: coordinator.capabilitySet,
    target: () => {
      target = new ThreeTextRenderPlanExecutor(coordinator, {
        drawRoot,
        pixelSnapping: false,
        renderOrderBase: 0,
      });
      return target;
    },
    limits: { ...limits, ...limitOverrides },
    requestCapacity: 64 * 1024,
    resultCapacity: 256 * 1024,
    textCapacity: 64,
  });
  assert.ok(target instanceof ThreeTextRenderPlanExecutor);
  return {
    glyphEngine,
    coordinator,
    transform,
    planner,
    target,
    dispose() {
      planner.dispose();
      transform.dispose();
      coordinator.dispose();
      glyphEngine.dispose();
    },
  };
}

const nestedStyleSpans = Object.freeze([
  { start: 0, end: 4, style: { color: '#ff0000' } },
  { start: 0, end: 3, style: { color: '#00ff00' } },
  { start: 0, end: 2, style: { color: '#0000ff' } },
  { start: 0, end: 1, style: { color: '#ffffff' } },
]);

test('pending style limits count every content update before mutating planner state', async () => {
  const backing = await fontBacking();
  const resource = defineRasterResourceId('test/three-style-limit/mesh');
  const font = fontVariant(backing, resource, indexedQuadGeometry());
  const renderer = await rendererHarness({ maxClusters: 6 });
  const texts = [];
  let binding;
  try {
    binding = renderer.coordinator.bindFontStack(font);
    texts.push(
      renderer.planner.createText({
        font: binding,
        transform: renderer.transform,
        text: { text: 'abcd', spans: nestedStyleSpans },
        style: { fontSize: 16 },
      }),
      renderer.planner.createText({
        font: binding,
        transform: renderer.transform,
        text: 'abcd',
        style: { fontSize: 16 },
      }),
    );
    assert.deepEqual(renderer.planner.publish(), { accepted: true });

    texts[0].update({ text: 'abcd' });
    assert.throws(
      () => texts[1].update({ text: { text: 'abcd', spans: nestedStyleSpans } }),
      /pending style mutations exceed limits\.maxClusters/u,
    );

    assert.deepEqual(renderer.planner.publish(), { accepted: true }, 'the rejected update must not poison the frame');
    texts[1].update({ text: { text: 'abcd', spans: nestedStyleSpans } });
    assert.deepEqual(renderer.planner.publish(), { accepted: true });
  } finally {
    for (const text of texts) text.dispose();
    binding?.dispose();
    renderer.dispose();
    font.dispose();
  }
});

test('reordering accounts for pending removals before mutating planner state', async () => {
  const backing = await fontBacking();
  const resource = defineRasterResourceId('test/three-reorder-limit/mesh');
  const font = fontVariant(backing, resource, indexedQuadGeometry());
  const renderer = await rendererHarness({ maxParagraphs: 4 });
  const texts = [];
  let binding;
  try {
    binding = renderer.coordinator.bindFontStack(font);
    for (const text of ['a', 'b', 'c', 'd']) {
      texts.push(
        renderer.planner.createText({
          font: binding,
          transform: renderer.transform,
          text,
          style: { fontSize: 16 },
        }),
      );
    }
    assert.deepEqual(renderer.planner.publish(), { accepted: true });

    texts[0].dispose();
    texts[1].dispose();
    const replacement = renderer.planner.createText({
      font: binding,
      transform: renderer.transform,
      text: 'e',
      style: { fontSize: 16 },
    });
    texts.push(replacement);
    const reordered = [replacement, texts[2], texts[3]];
    assert.throws(
      () => renderer.planner.reorderTexts(reordered),
      /pending paragraph mutations exceed limits\.maxParagraphs/u,
    );

    assert.deepEqual(renderer.planner.publish(), { accepted: true }, 'the rejected reorder must not poison the frame');
    renderer.planner.reorderTexts(reordered);
    assert.deepEqual(renderer.planner.publish(), { accepted: true });
  } finally {
    for (const text of texts) text.dispose();
    binding?.dispose();
    renderer.dispose();
    font.dispose();
  }
});

test('reordered paragraphs publish multiple content updates in paragraph order', async () => {
  const backing = await fontBacking();
  const resource = defineRasterResourceId('test/three-reordered-content/mesh');
  const font = fontVariant(backing, resource, indexedQuadGeometry());
  const renderer = await rendererHarness();
  const texts = [];
  let binding;
  try {
    binding = renderer.coordinator.bindFontStack(font);
    for (const text of ['a', 'b', 'c']) {
      texts.push(
        renderer.planner.createText({
          font: binding,
          transform: renderer.transform,
          text,
          style: { fontSize: 16 },
        }),
      );
    }
    assert.deepEqual(renderer.planner.publish(), { accepted: true });

    renderer.planner.reorderTexts([texts[2], texts[0], texts[1]]);
    texts[0].update({ text: 'aa' });
    texts[2].update({ text: 'cc' });
    assert.deepEqual(
      renderer.planner.publish(),
      { accepted: true },
      'content records must follow the paragraph order consumed by the engine',
    );
  } finally {
    for (const text of texts) text.dispose();
    binding?.dispose();
    renderer.dispose();
    font.dispose();
  }
});

test('order-only changes remain separate from pending content accounting', async () => {
  const backing = await fontBacking();
  const resource = defineRasterResourceId('test/three-reordered-content-budget/mesh');
  const font = fontVariant(backing, resource, indexedQuadGeometry());
  const renderer = await rendererHarness({ maxClusters: 3 });
  const texts = [];
  let binding;
  try {
    binding = renderer.coordinator.bindFontStack(font);
    for (const text of ['a', 'b', 'c']) {
      texts.push(
        renderer.planner.createText({
          font: binding,
          transform: renderer.transform,
          text,
          style: { fontSize: 16 },
        }),
      );
    }
    assert.deepEqual(renderer.planner.publish(), { accepted: true });

    renderer.planner.reorderTexts([texts[2], texts[0], texts[1]]);
    texts[0].update({ text: 'updated' });
    assert.deepEqual(
      renderer.planner.publish(),
      { accepted: true },
      'three pending paragraph records and one content update must fit a three-content budget',
    );
  } finally {
    for (const text of texts) text.dispose();
    binding?.dispose();
    renderer.dispose();
    font.dispose();
  }
});

test('records-sourced Three geometry renders and retains topology across text updates', async () => {
  const backing = await fontBacking();
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
  const renderer = await rendererHarness();
  let binding;
  let text;
  try {
    assert.throws(() => renderer.coordinator.bindFontStack(invalidFont), /vertex input "position" needs f32x3/u);
    binding = renderer.coordinator.bindFontStack(font);
    text = renderer.planner.createText({
      font: binding,
      transform: renderer.transform,
      text: '12345',
      style: { fontSize: 16 },
      constraints: { width: { mode: 'at-most', size: 256 }, height: { mode: 'at-most', size: 64 } },
    });

    assert.deepEqual(renderer.planner.publish(), { accepted: true });
    assert.equal(renderer.target.draws.length, 1);
    const retainedDraw = renderer.target.draws[0];
    assert.equal(retainedDraw.geometry.instanceCount, 5);
    assert.deepEqual([...retainedDraw.geometry.index.array], [0, 1, 2, 0, 2, 3]);
    assert.deepEqual([...retainedDraw.geometry.getAttribute('position').array], [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
    assert.deepEqual([...retainedDraw.geometry.getAttribute('uv').array], [0, 0, 1, 0, 1, 1, 0, 1]);

    text.update({ text: '12' });
    assert.deepEqual(renderer.planner.publish(), { accepted: true });
    assert.equal(renderer.target.draws[0], retainedDraw);
    assert.equal(retainedDraw.geometry.instanceCount, 2);
  } finally {
    text?.dispose();
    binding?.dispose();
    renderer.dispose();
    invalidFont.dispose();
    font.dispose();
  }
});

test('planner-assisted glyph copies stay paragraph-scoped and synchronously borrowed', async () => {
  const backing = await fontBacking();
  const resource = defineRasterResourceId('test/three-detached-copy/mesh');
  const font = fontVariant(backing, resource, indexedQuadGeometry());
  const renderer = await rendererHarness();
  let binding;
  let first;
  let second;
  let detachedTarget;
  try {
    binding = renderer.coordinator.bindFontStack(font);
    first = renderer.planner.createText({
      font: binding,
      transform: renderer.transform,
      text: 'A',
      style: { fontSize: 16 },
    });
    second = renderer.planner.createText({
      font: binding,
      transform: renderer.transform,
      text: 'W',
      style: { fontSize: 16 },
    });
    assert.deepEqual(renderer.planner.publish(), { accepted: true });

    const firstStableId = first.glyphs().glyphStableIds[0];
    const secondStableId = second.glyphs().glyphStableIds[0];
    assert.notEqual(
      firstStableId,
      secondStableId,
      'stable glyph ids are unique within one planner, but paragraph ownership remains independently enforced',
    );

    let borrowedPlan;
    const target = {
      delivery: 'borrowed',
      accept(candidate) {
        assert.equal(candidate.checkpoint, true);
        assert.ok(candidate.plan.table('draws').count > 0);
        borrowedPlan = candidate.plan;
        return { accepted: true };
      },
      dispose() {},
    };
    assert.deepEqual(first.copyGlyphs([firstStableId], target), { accepted: true });
    assert.throws(() => borrowedPlan.table('draws'), /expired/u, 'borrowed copy bytes expire when accept returns');

    const detachedRoot = new THREE.Group();
    detachedTarget = new ThreeTextRenderPlanExecutor(renderer.coordinator, {
      drawRoot: detachedRoot,
      pixelSnapping: false,
      renderOrderBase: 0,
    });
    assert.deepEqual(first.copyGlyphs([firstStableId], detachedTarget), { accepted: true });
    assert.equal(detachedTarget.draws.length, 1);
    assert.deepEqual(
      [...detachedTarget.draws[0].geometry.index.array],
      [0, 1, 2, 0, 2, 3],
      'the copied plan must retain supplied topology rather than substituting a metric quad',
    );
    const copiedGeometry = detachedTarget.glyphGeometry(Uint32Array.of(firstStableId)).get(firstStableId);
    assert.equal(copiedGeometry?.kind, 'supplied');
    assert.equal(copiedGeometry?.geometryKind, 'quad');
    assert.equal(copiedGeometry?.coordinates, 'unit-square');
    assert.deepEqual(copiedGeometry?.indices, [0, 1, 2, 0, 2, 3]);

    assert.throws(() => first.copyGlyphs([], target), /at least one stable glyph id/u);
    assert.throws(() => first.copyGlyphs([firstStableId, firstStableId], target), /duplicates/u);
    assert.throws(
      () => first.copyGlyphs([secondStableId], target),
      (error) => error.code === 'invalid-request',
      "another paragraph's valid committed record id must not cross the RetainedText boundary",
    );
    assert.throws(
      () => first.copyGlyphs([0xffff_ffff], target),
      (error) => error.code === 'invalid-request',
    );
    assert.throws(
      () =>
        first.copyGlyphs([firstStableId], {
          delivery: 'borrowed',
          accept: async () => ({ accepted: true }),
          dispose() {},
        }),
      /must answer synchronously/u,
    );

    first.update({ text: 'Z' });
    assert.deepEqual(renderer.planner.publish(), { accepted: true });
    const replacementStableId = first.glyphs().glyphStableIds[0];
    assert.notEqual(replacementStableId, firstStableId, 'a reshaped record receives a fresh monotonic identity');
    assert.throws(
      () => first.copyGlyphs([firstStableId], target),
      (error) => error.code === 'invalid-request',
      'an identity from a superseded glyph stream must not resolve to a replacement record',
    );
  } finally {
    detachedTarget?.dispose();
    second?.dispose();
    first?.dispose();
    binding?.dispose();
    renderer.dispose();
    font.dispose();
  }
});

test('equal portable resource identities share ownership and conflicts reject atomically', async () => {
  const backing = await fontBacking();
  const resource = defineRasterResourceId('test/three-shared-geometry/mesh');
  const original = fontVariant(backing, resource, indexedQuadGeometry());
  const equal = fontVariant(backing, resource, indexedQuadGeometry());
  const conflictingGeometry = indexedQuadGeometry();
  new Uint16Array(conflictingGeometry.bytes.buffer, 80, 6).set([0, 2, 1, 0, 3, 2]);
  const conflicting = fontVariant(backing, resource, conflictingGeometry);
  const renderer = await rendererHarness();
  let originalBinding;
  let equalBinding;
  try {
    originalBinding = renderer.coordinator.bindFontStack(original);
    equalBinding = renderer.coordinator.bindFontStack(equal);
    const reference = renderer.coordinator.identities.resource(resource);
    const retained = renderer.coordinator.backend._acquirePortablePayload(reference);
    try {
      assert.equal(retained.techniqueId, suppliedGeometryTechnique.id);
      assert.equal(retained.payload.kind, 'geometry');
    } finally {
      retained.dispose();
    }

    assert.throws(() => renderer.coordinator.bindFontStack(conflicting), /resolves to different content/u);
    const afterRejection = renderer.coordinator.backend._acquirePortablePayload(reference);
    afterRejection.dispose();

    equalBinding.dispose();
    equalBinding = undefined;
    originalBinding.dispose();
    originalBinding = undefined;
    assert.throws(() => renderer.coordinator.backend._acquirePortablePayload(reference), /unknown portable payload/u);
  } finally {
    equalBinding?.dispose();
    originalBinding?.dispose();
    renderer.dispose();
    conflicting.dispose();
    equal.dispose();
    original.dispose();
  }
});

test('an async target must return the same unmodified transferred publication', async () => {
  const backing = await fontBacking();
  const resource = defineRasterResourceId('test/three-async-transport/mesh');
  const font = fontVariant(backing, resource, indexedQuadGeometry());
  const glyphEngine = await createGlyphEngine({ wasm: await readFile(wasmUrl) });
  const coordinator = new ThreeTextEngineCoordinator(glyphEngine);
  let corruptReturn = false;
  let holdReturn = false;
  let growEngineDuringAcceptance = false;
  let releaseReturn;
  const target = {
    delivery: 'owned',
    maximumPlanBytes: limits.maxOutputBytes,
    async accept(candidate) {
      assert.equal(candidate.bytes.byteOffset, 0);
      assert.equal(candidate.bytes.byteLength, candidate.bytes.buffer.byteLength);
      assert.equal(candidate.plan.bytes(0, candidate.bytes.byteLength).buffer, candidate.bytes.buffer);
      const workerBytes = structuredClone(candidate.bytes, { transfer: [candidate.bytes.buffer] });
      if (growEngineDuringAcceptance) {
        growEngineDuringAcceptance = false;
        const sibling = coordinator.backend.createPlanner({
          policy: coordinator.policy,
          capabilitySet: coordinator.capabilitySet,
          target: () => ({
            delivery: 'borrowed',
            accept: () => ({ accepted: true }),
            dispose() {},
          }),
          limits,
          requestCapacity: 64 * 1024,
          resultCapacity: 64 * 1024 * 1024,
          textCapacity: 64,
        });
        sibling.dispose();
      }
      if (corruptReturn) {
        new DataView(workerBytes.buffer).setUint32(
          textShaperAbi.layouts.engineResult.planRevision,
          candidate.planRevision + 1,
          true,
        );
      }
      if (holdReturn) await new Promise((resolve) => (releaseReturn = resolve));
      return {
        accepted: true,
        returnedBytes: structuredClone(workerBytes, { transfer: [workerBytes.buffer] }),
      };
    },
    dispose() {},
  };
  const planner = coordinator.backend.createPlanner({
    policy: coordinator.policy,
    capabilitySet: coordinator.capabilitySet,
    target: () => target,
    limits,
    requestCapacity: 64 * 1024,
    resultCapacity: 256 * 1024,
    textCapacity: 64,
  });
  const binding = coordinator.bindFontStack(font);
  assert.throws(
    () => planner.createText({ font: binding, text: 'invalid', style: { fontSize: 0 } }),
    /fontSize must be positive/,
  );
  assert.throws(
    () =>
      planner.createText({
        font: binding,
        text: 'invalid',
        style: { outline: { color: '#ffffff', width: 1 } },
      }),
    /test\.three-supplied-geometry.*outline/,
  );
  const text = planner.createText({ font: binding, text: 'abc', style: { fontSize: 16 } });
  try {
    assert.throws(
      () => text.update({ constraints: { width: { mode: 'exact', size: -1 } } }),
      /width size must be nonnegative/,
    );
    assert.deepEqual(await planner.publish(), { accepted: true });
    growEngineDuringAcceptance = true;
    text.update({ text: 'abcz' });
    assert.deepEqual(await planner.publish(), { accepted: true });
    holdReturn = true;
    text.update({ text: 'abcd' });
    const pending = planner.publish();
    assert.throws(() => planner.publish(), RenderPlannerBackpressureError);
    assert.throws(() => text.update({ text: 'blocked' }), RenderPlannerBackpressureError);
    holdReturn = false;
    releaseReturn();
    assert.deepEqual(await pending, { accepted: true });
    corruptReturn = true;
    text.update({ text: 'abcde' });
    await assert.rejects(() => planner.publish(), PlanTransportError);
    corruptReturn = false;
    holdReturn = true;
    text.update({ text: 'abcdef' });
    const aborted = planner.publish();
    planner.dispose();
    await assert.rejects(aborted, RenderPlannerDisposedError);
    releaseReturn();
    assert.throws(() => planner.publish(), RenderPlannerDisposedError);
  } finally {
    text.dispose();
    planner.dispose();
    binding.dispose();
    coordinator.dispose();
    glyphEngine.dispose();
    font.dispose();
  }
});
