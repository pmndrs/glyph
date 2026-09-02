import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { FontRegistry } from '../../dist/loader.js';
import { createGlyphEngine, createGlyphHandleState } from '../../dist/glyph-engine.js';
import { validateFontArtifact } from '@pmndrs/glyph/bake';
import { GlyphHandleState } from '../../dist/internal/handle-state.js';
import { assertGlyphId, id } from '../../dist/core/render-policy.js';
import { threeCodecBytes } from '../../dist/three/render-policy.js';
import { createRuntimeShaper } from '../../dist/shaper.js';
import {
  engineFrameUpdateBytes,
  engineUpdateBytes,
  fontBindingBytes,
  renderPolicyBytes,
} from '../support/engine-abi.mjs';
import { textShaperAbi } from '../../dist/text-shaper-abi.js';

const wasmUrl = new URL('../../dist/text-shaper.wasm', import.meta.url);
const TEST_POLICY_HANDLE = id.policy('test.text-engine-handle-state/default');
const TEST_PLANNER_HANDLE = id.planner('test.text-engine-handle-state/default');
const THREE_POLICY_HANDLE = id.policy('test.text-engine-handle-state/three');

test('a glyph engine owns every configured-handle state it creates', async () => {
  const glyphEngine = await createGlyphEngine({ wasm: await readFile(wasmUrl) });
  assert.throws(() => createGlyphHandleState(glyphEngine, { integration: '' }), /nonempty string/u);
  const handleState = createGlyphHandleState(glyphEngine, { integration: 'test.glyphEngine-owner' });
  const plannerHandle = handleState.id('planner', 'test.glyphEngine-owner/transport');
  const policyHandle = handleState.id('policy', 'test.glyphEngine-owner/policy');
  handleState.registerCodec(policyHandle, renderPolicyBytes(textShaperAbi));
  const request = engineUpdateBytes(textShaperAbi, {
    plannerId: plannerHandle,
    policyHandle,
    expectedEngineRevision: 0,
    consumedPlanRevision: 0,
  });
  const transport = handleState._createPlanTransport({
    handle: plannerHandle,
    requestCapacity: request.byteLength,
    resultCapacity: textShaperAbi.layouts.engineResult.size,
  });

  assert.equal(handleState.integration, 'test.glyphEngine-owner');
  glyphEngine.dispose();
  assert.throws(() => handleState.id('planner', 'test.glyphEngine-owner/stale'), /disposed/u);
  assert.throws(() => transport.update(request), /disposed/u);
});

test('a Glyph handle state publishes borrowed A/B plans through the engine shaper', async () => {
  const wasm = await readFile(wasmUrl);
  const abi = textShaperAbi;
  const shaper = await createRuntimeShaper({ wasm });
  const handleState = new GlyphHandleState(shaper);
  const policyHandle = TEST_POLICY_HANDLE;
  const plannerId = TEST_PLANNER_HANDLE;
  handleState.registerCodec(policyHandle, renderPolicyBytes(abi));
  const firstRequest = engineUpdateBytes(abi, {
    plannerId,
    policyHandle,
    expectedEngineRevision: 0,
    consumedPlanRevision: 0,
  });
  const transport = handleState._createPlanTransport({
    handle: plannerId,
    requestCapacity: firstRequest.byteLength,
    resultCapacity: abi.layouts.engineResult.size,
  });

  const first = transport.update(firstRequest);
  assert.equal(first.engineRevision, 1);
  assert.equal(first.planRevision, 1);
  assert.equal(first.requiredBaseRevision, 0);
  assert.equal(first.publicationGeneration, 1);
  assert.equal(first.outputSlot, 0);
  assert.equal(first.policyHandle, policyHandle);
  assert.equal(first.bytes.byteLength, abi.layouts.engineResult.size);
  const retainedFirst = first.bytes.slice();

  const second = transport.update(
    engineUpdateBytes(abi, {
      plannerId,
      policyHandle,
      expectedEngineRevision: first.engineRevision,
      consumedPlanRevision: first.planRevision,
      acknowledgedPublicationGeneration: first.publicationGeneration,
    }),
  );
  assert.equal(second.engineRevision, 2);
  assert.equal(second.planRevision, 2);
  assert.equal(second.requiredBaseRevision, first.planRevision);
  assert.equal(second.publicationGeneration, 2);
  assert.equal(second.outputSlot, 1);
  assert.deepEqual(first.bytes, retainedFirst, 'publishing slot B must not mutate borrowed slot A');

  handleState.dispose();
  assert.throws(() => transport.update(firstRequest), /disposed/);
  shaper.dispose();
});

test('handle-scoped ID provenance expires with its owning handle state', async () => {
  const shaper = await createRuntimeShaper({ wasm: await readFile(wasmUrl) });
  const handleState = new GlyphHandleState(shaper);
  const handle = handleState.id('planner', 'test.text-engine-handle-state/scoped-transport');
  assert.equal(assertGlyphId(handle, 'planner', 'transport handle'), handle);
  handleState.dispose();
  assert.throws(() => assertGlyphId(handle, 'planner', 'transport handle'), /must come from id/);
  assert.throws(() => handleState.id('planner', 'test.text-engine-handle-state/after-dispose'), /disposed/);
  shaper.dispose();
});

test('font bindings cannot be disposed while an owned stack still references them', async () => {
  const [artifact, wasm] = await Promise.all([
    readFile(new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url)),
    readFile(wasmUrl),
  ]);
  const validated = await validateFontArtifact(artifact);
  const registry = new FontRegistry();
  const font = await registry.registerAsset(artifact);
  const shaper = await createRuntimeShaper({ registry, wasm });
  shaper.registerFont(font);
  const handleState = new GlyphHandleState(shaper);
  const foreignHandle = new GlyphHandleState(shaper);
  const bindingHandle = handleState.id('font-binding', 'test.text-engine-handle-state/lifecycle-binding');
  const stackHandle = handleState.id('font-stack', 'test.text-engine-handle-state/lifecycle-stack');
  const foreignStackHandle = foreignHandle.id('font-stack', 'test.text-engine-handle-state/foreign-lifecycle-stack');
  const glyphCount = validated.glyphExtents.byteLength / 8;
  const binding = fontBindingBytes(textShaperAbi, {
    techniqueId: 1,
    glyphCount,
    strikes: [0],
    resources: [{ id: 1, generation: 1, kind: 1, reference: 1 }],
    resourceIndices: new Array(glyphCount).fill(0),
    glyphF32: [new Array(glyphCount).fill(1)],
  });
  try {
    handleState.registerFontBinding(bindingHandle, font.handle, binding);
    assert.throws(
      () => foreignHandle.registerFontStack(foreignStackHandle, [bindingHandle]),
      /not owned by this Glyph handle state/u,
    );
    handleState.registerFontStack(stackHandle, [bindingHandle]);
    assert.throws(() => handleState.disposeFontBinding(bindingHandle), /still used by font stack/u);
    assert.throws(() => shaper.disposeFont(font), /retained by a registered font stack/u);
    assert.equal(shaper.memoryReport().fontCount, 1, 'a refused disposal must keep the shaper registration owned');
    const policyHandle = handleState.id('policy', 'test.text-engine-handle-state/lifecycle-policy');
    const plannerHandle = handleState.id('planner', 'test.text-engine-handle-state/lifecycle-transport');
    handleState.registerCodec(policyHandle, renderPolicyBytes(textShaperAbi));
    const request = engineFrameUpdateBytes(textShaperAbi, {
      plannerId: plannerHandle,
      policyHandle,
      fontStackHandle: stackHandle,
      textMutation: { start: 0, deleteCount: 0, insert: [0x41] },
      style: { textEnd: 1, fontSize: 16, lineHeight: 19.2, rasterPixelRatio: 1 },
      geometry: { width: 100, height: 100, maxLines: 4, revision: 1 },
      limits: { maxClusters: 16, maxLines: 4, maxOutputBytes: 128 * 1024 },
    });
    const transport = handleState._createPlanTransport({
      handle: plannerHandle,
      requestCapacity: request.byteLength,
      resultCapacity: 128 * 1024,
    });
    transport.update(request);
    assert.throws(
      () => handleState.disposeFontStack(stackHandle),
      (error) => error.code === 'registration-in-use',
      'a committed transport must retain the stack named by its styles',
    );
    assert.throws(
      () => handleState.disposeCodec(policyHandle),
      (error) => error.code === 'registration-in-use',
      'a committed transport must retain its policy',
    );
    transport.dispose();
    handleState.disposeFontStack(stackHandle);
    handleState.disposeFontBinding(bindingHandle);
    handleState.disposeCodec(policyHandle);
    assert.throws(() => handleState.disposeFontBinding(bindingHandle), /must come from id/u);
    shaper.disposeFont(font);
    assert.equal(shaper.memoryReport().fontCount, 0);
  } finally {
    foreignHandle.dispose();
    handleState.dispose();
    font.dispose();
    shaper.dispose();
  }
});

test('one deterministic Three policy registers Bitmap, MSDF, and Slug with material-directed draws', async () => {
  const wasm = await readFile(wasmUrl);
  const abi = textShaperAbi;
  const wireIds = {
    bitmap: id.technique('pmndrs.bitmap'),
    msdf: id.technique('pmndrs.msdf'),
    slug: id.technique('pmndrs.slug'),
    decoration: id.technique('pmndrs.decoration'),
  };
  assert.deepEqual(wireIds, {
    bitmap: 0x1775_3b8c,
    msdf: 0xf9a7_e4fd,
    slug: 0xf22c_7908,
    decoration: 0x3455fa81,
  });
  const bytes = threeCodecBytes();
  const request = abi.layouts.policyRequest;
  const program = abi.layouts.policyProgram;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(request.programCount, true), 4);
  const programsOffset = view.getUint32(request.programsOffset, true);
  const expectedTechniques = [wireIds.bitmap, wireIds.msdf, wireIds.slug, wireIds.decoration];
  const expectedPrograms = [
    id.program('pmndrs.bitmap', 'three'),
    id.program('pmndrs.msdf', 'three'),
    id.program('pmndrs.slug', 'three'),
    id.program('pmndrs.decoration', 'three'),
  ];
  for (const [index, wireTechniqueId] of expectedTechniques.entries()) {
    const offset = programsOffset + index * program.size;
    assert.equal(view.getUint32(offset + program.techniqueId, true), wireTechniqueId);
    assert.equal(view.getUint32(offset + program.programId, true), expectedPrograms[index]);
    assert.ok(view.getUint32(offset + program.drawKeyMask, true) & abi.policy.batchFields.material);
    assert.equal(view.getUint32(offset + program.storageKeyMask, true) & abi.policy.batchFields.material, 0);
    const expectedKind =
      wireTechniqueId === wireIds.decoration ? abi.engine.primitiveKinds.decoration : abi.engine.primitiveKinds.glyph;
    assert.equal(view.getUint16(offset + program.primitiveKind, true), expectedKind);
  }

  const shaper = await createRuntimeShaper({ wasm });
  const handleState = new GlyphHandleState(shaper);
  handleState.registerCodec(THREE_POLICY_HANDLE, bytes);
  handleState.dispose();
  shaper.dispose();
});
