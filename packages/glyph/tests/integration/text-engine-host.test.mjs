import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { TextEngineHost } from '../../dist/core/host.js';
import { assertGlyphId, id, programId, techniqueId } from '../../dist/core/render-policy.js';
import { threeRenderPolicyBytes } from '../../dist/three/render-policy.js';
import { createRuntimeShaper } from '../../dist/shaper.js';
import { engineUpdateBytes, renderPolicyBytes } from '../support/engine-abi.mjs';
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
