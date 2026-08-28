import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import * as THREE from 'three/webgpu';

import {
  defineTechniqueSchema,
  id,
  registerRasterPlanProgram,
  techniqueProgram,
  TextEngineBackpressureError,
  RetainedPlanDisposedError,
  TextEngineTransportError,
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
import { ThreeTextRenderPlanExecutor } from '../../dist/three/engine-plan-target.js';
import { ThreeTextEngineCoordinator } from '../../dist/three/engine-coordinator.js';
import { registerThreeRasterPlanProgram } from '../../dist/three.js';
import { indexedQuadGeometry } from '../support/portable-geometry.mjs';

const fixtureUrl = new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);
const wasmUrl = new URL('../../dist/text-shaper.wasm', import.meta.url);
const ORIGIN_BUFFER_ID = id('buffer', 'test.three-supplied-geometry/origin');

const suppliedGeometryTechnique = defineRasterTechnique({
  id: 'test.three-supplied-geometry',
  kind: 'test',
  extension: 'TEST_three_supplied_geometry',
  version: 0,
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

async function rendererHarness() {
  const glyphEngine = await createGlyphEngine({ wasm: await readFile(wasmUrl) });
  const coordinator = new ThreeTextEngineCoordinator(glyphEngine);
  const drawRoot = new THREE.Object3D();
  const object = new THREE.Object3D();
  drawRoot.add(object);
  const transform = coordinator.bindTransform(object);
  let target;
  const retainedPlan = coordinator.backend.createRetainedPlan({
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
    limits,
    requestCapacity: 64 * 1024,
    resultCapacity: 256 * 1024,
    textCapacity: 64,
  });
  assert.ok(target instanceof ThreeTextRenderPlanExecutor);
  return {
    glyphEngine,
    coordinator,
    transform,
    retainedPlan,
    target,
    dispose() {
      retainedPlan.dispose();
      transform.dispose();
      coordinator.dispose();
      glyphEngine.dispose();
    },
  };
}

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
    text = renderer.retainedPlan.createText({
      font: binding,
      transform: renderer.transform,
      text: '12345',
      style: { fontSize: 16 },
      contentBox: { width: { mode: 'at-most', size: 256 }, height: { mode: 'at-most', size: 64 } },
    });

    assert.deepEqual(renderer.retainedPlan.publish(), { accepted: true });
    assert.equal(renderer.target.draws.length, 1);
    const retainedDraw = renderer.target.draws[0];
    assert.equal(retainedDraw.geometry.instanceCount, 5);
    assert.deepEqual([...retainedDraw.geometry.index.array], [0, 1, 2, 0, 2, 3]);
    assert.deepEqual([...retainedDraw.geometry.getAttribute('position').array], [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
    assert.deepEqual([...retainedDraw.geometry.getAttribute('uv').array], [0, 0, 1, 0, 1, 1, 0, 1]);

    text.update({ text: '12' });
    assert.deepEqual(renderer.retainedPlan.publish(), { accepted: true });
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
    const reference = renderer.coordinator.identities.resourceId(resource);
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
        const sibling = coordinator.backend.createRetainedPlan({
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
  const retainedPlan = coordinator.backend.createRetainedPlan({
    policy: coordinator.policy,
    capabilitySet: coordinator.capabilitySet,
    target: () => target,
    limits,
    requestCapacity: 64 * 1024,
    resultCapacity: 256 * 1024,
    textCapacity: 64,
  });
  const binding = coordinator.bindFontStack(font);
  const text = retainedPlan.createText({ font: binding, text: 'abc', style: { fontSize: 16 } });
  try {
    assert.deepEqual(await retainedPlan.publish(), { accepted: true });
    growEngineDuringAcceptance = true;
    text.update({ text: 'abcz' });
    assert.deepEqual(await retainedPlan.publish(), { accepted: true });
    holdReturn = true;
    text.update({ text: 'abcd' });
    const pending = retainedPlan.publish();
    assert.throws(() => retainedPlan.publish(), TextEngineBackpressureError);
    assert.throws(() => text.update({ text: 'blocked' }), TextEngineBackpressureError);
    holdReturn = false;
    releaseReturn();
    assert.deepEqual(await pending, { accepted: true });
    corruptReturn = true;
    text.update({ text: 'abcde' });
    await assert.rejects(() => retainedPlan.publish(), TextEngineTransportError);
    corruptReturn = false;
    holdReturn = true;
    text.update({ text: 'abcdef' });
    const aborted = retainedPlan.publish();
    retainedPlan.dispose();
    await assert.rejects(aborted, RetainedPlanDisposedError);
    releaseReturn();
    assert.throws(() => retainedPlan.publish(), RetainedPlanDisposedError);
  } finally {
    text.dispose();
    retainedPlan.dispose();
    binding.dispose();
    coordinator.dispose();
    glyphEngine.dispose();
    font.dispose();
  }
});
