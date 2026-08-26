import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { FontRegistry } from '@pmndrs/glyph';
import { validateFontArtifact } from '@pmndrs/glyph/bake';
import { TextEngineHost } from '../../dist/core/host.js';
import { assertGlyphId, id, programId, techniqueId } from '../../dist/core/render-policy.js';
import { threeRenderPolicyBytes } from '../../dist/three/render-policy.js';
import { createRuntimeShaper } from '../../dist/shaper.js';
import {
  engineFrameUpdateBytes,
  engineUpdateBytes,
  fontBindingBytes,
  renderPolicyBytes,
} from '../support/engine-abi.mjs';
import { textShaperAbi } from '../../dist/text-shaper-abi.js';

const wasmUrl = new URL('../../dist/text-shaper.wasm', import.meta.url);
const TEST_POLICY_HANDLE = id('policy', 'test.text-engine-host/default');
const TEST_SESSION_HANDLE = id('session', 'test.text-engine-host/default');
const THREE_POLICY_HANDLE = id('policy', 'test.text-engine-host/three');

test('production text-engine host publishes borrowed A/B plans through the runtime shaper instance', async () => {
  const wasm = await readFile(wasmUrl);
  const abi = textShaperAbi;
  const shaper = await createRuntimeShaper({ wasm });
  const host = new TextEngineHost(shaper);
  const policyHandle = TEST_POLICY_HANDLE;
  const sessionId = TEST_SESSION_HANDLE;
  host.registerPolicy(policyHandle, renderPolicyBytes(abi));
  const firstRequest = engineUpdateBytes(abi, {
    sessionId,
    policyHandle,
    expectedEngineRevision: 0,
    consumedPlanRevision: 0,
  });
  const session = host.createSession({
    handle: sessionId,
    requestCapacity: firstRequest.byteLength,
    resultCapacity: abi.layouts.engineResult.size,
  });

  const first = session.update(firstRequest);
  assert.equal(first.engineRevision, 1);
  assert.equal(first.planRevision, 1);
  assert.equal(first.requiredBaseRevision, 0);
  assert.equal(first.publicationGeneration, 1);
  assert.equal(first.outputSlot, 0);
  assert.equal(first.policyHandle, policyHandle);
  assert.equal(first.bytes.byteLength, abi.layouts.engineResult.size);
  const retainedFirst = first.bytes.slice();

  const second = session.update(
    engineUpdateBytes(abi, {
      sessionId,
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

  host.dispose();
  assert.throws(() => session.update(firstRequest), /disposed/);
  shaper.dispose();
});

test('host-scoped ID provenance expires with its owning host', async () => {
  const shaper = await createRuntimeShaper({ wasm: await readFile(wasmUrl) });
  const host = new TextEngineHost(shaper);
  const handle = host.id('session', 'test.text-engine-host/scoped-session');
  assert.equal(assertGlyphId(handle, 'session', 'session handle'), handle);
  host.dispose();
  assert.throws(() => assertGlyphId(handle, 'session', 'session handle'), /must come from id/);
  assert.throws(() => host.id('session', 'test.text-engine-host/after-dispose'), /disposed/);
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
  const host = new TextEngineHost(shaper);
  const foreignHost = new TextEngineHost(shaper);
  const bindingHandle = host.id('font-binding', 'test.text-engine-host/lifecycle-binding');
  const stackHandle = host.id('font-stack', 'test.text-engine-host/lifecycle-stack');
  const foreignStackHandle = foreignHost.id('font-stack', 'test.text-engine-host/foreign-lifecycle-stack');
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
    host.registerFontBinding(bindingHandle, font.handle, binding);
    assert.throws(
      () => foreignHost.registerFontStack(foreignStackHandle, [bindingHandle]),
      /not owned by this text engine host/u,
    );
    host.registerFontStack(stackHandle, [bindingHandle]);
    assert.throws(() => host.disposeFontBinding(bindingHandle), /still used by font stack/u);
    assert.throws(() => shaper.disposeFont(font), /retained by a registered font stack/u);
    assert.equal(shaper.memoryReport().fontCount, 1, 'a refused disposal must keep the shaper registration owned');
    const policyHandle = host.id('policy', 'test.text-engine-host/lifecycle-policy');
    const sessionHandle = host.id('session', 'test.text-engine-host/lifecycle-session');
    host.registerPolicy(policyHandle, renderPolicyBytes(textShaperAbi));
    const request = engineFrameUpdateBytes(textShaperAbi, {
      sessionId: sessionHandle,
      policyHandle,
      fontStackHandle: stackHandle,
      textMutation: { start: 0, deleteCount: 0, insert: [0x41] },
      style: { textEnd: 1, fontSize: 16, lineHeight: 19.2, rasterPixelRatio: 1 },
      geometry: { width: 100, height: 100, maxLines: 4, revision: 1 },
      limits: { maxClusters: 16, maxLines: 4, maxOutputBytes: 128 * 1024 },
    });
    const session = host.createSession({
      handle: sessionHandle,
      requestCapacity: request.byteLength,
      resultCapacity: 128 * 1024,
    });
    session.update(request);
    assert.throws(
      () => host.disposeFontStack(stackHandle),
      (error) => error.status === textShaperAbi.status.registrationInUse,
      'a committed session must retain the stack named by its styles',
    );
    assert.throws(
      () => host.disposePolicy(policyHandle),
      (error) => error.status === textShaperAbi.status.registrationInUse,
      'a committed session must retain its policy',
    );
    session.dispose();
    host.disposeFontStack(stackHandle);
    host.disposeFontBinding(bindingHandle);
    host.disposePolicy(policyHandle);
    assert.throws(() => host.disposeFontBinding(bindingHandle), /must come from id/u);
    shaper.disposeFont(font);
    assert.equal(shaper.memoryReport().fontCount, 0);
  } finally {
    foreignHost.dispose();
    host.dispose();
    font.dispose();
    shaper.dispose();
  }
});

test('one deterministic Three policy registers Bitmap, MSDF, and Slug with material-directed draws', async () => {
  const wasm = await readFile(wasmUrl);
  const abi = textShaperAbi;
  const wireIds = {
    bitmap: techniqueId('pmndrs.bitmap'),
    msdf: techniqueId('pmndrs.msdf'),
    slug: techniqueId('pmndrs.slug'),
    decoration: techniqueId('pmndrs.decoration'),
  };
  assert.deepEqual(wireIds, {
    bitmap: 0x1775_3b8c,
    msdf: 0xf9a7_e4fd,
    slug: 0xf22c_7908,
    decoration: 0x3455fa81,
  });
  const bytes = threeRenderPolicyBytes();
  const request = abi.layouts.policyRequest;
  const program = abi.layouts.policyProgram;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(request.programCount, true), 4);
  const programsOffset = view.getUint32(request.programsOffset, true);
  const expectedTechniques = [wireIds.bitmap, wireIds.msdf, wireIds.slug, wireIds.decoration];
  const expectedPrograms = [
    programId('pmndrs.bitmap', 'three'),
    programId('pmndrs.msdf', 'three'),
    programId('pmndrs.slug', 'three'),
    programId('pmndrs.decoration', 'three'),
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
  const host = new TextEngineHost(shaper);
  host.registerPolicy(THREE_POLICY_HANDLE, bytes);
  host.dispose();
  shaper.dispose();
});
