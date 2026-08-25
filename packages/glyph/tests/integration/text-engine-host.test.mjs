import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { TextEngineHost } from '../../dist/core/host.js';
import { programId, techniqueWireIds } from '../../dist/core/render-policy.js';
import { threeRenderPolicyBytes } from '../../dist/three/render-policy.js';
import { createRuntimeShaper } from '../../dist/shaper.js';
import { engineUpdateBytes, renderPolicyBytes } from '../support/engine-abi.mjs';
import { textShaperAbi } from '../../dist/text-shaper-abi.js';

const wasmUrl = new URL('../../dist/text-shaper.wasm', import.meta.url);

test('production text-engine host publishes borrowed A/B plans through the runtime shaper instance', async () => {
  const wasm = await readFile(wasmUrl);
  const abi = textShaperAbi;
  const shaper = await createRuntimeShaper({ wasm });
  const host = new TextEngineHost(shaper);
  const policyHandle = 11;
  const sessionId = 5;
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

test('one deterministic Three policy registers Bitmap, MSDF, and Slug with material-directed draws', async () => {
  const wasm = await readFile(wasmUrl);
  const abi = textShaperAbi;
  assert.deepEqual(techniqueWireIds, {
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
  const expectedTechniques = [
    techniqueWireIds.bitmap,
    techniqueWireIds.msdf,
    techniqueWireIds.slug,
    techniqueWireIds.decoration,
  ];
  const expectedPrograms = [
    programId('pmndrs.bitmap', 'three'),
    programId('pmndrs.msdf', 'three'),
    programId('pmndrs.slug', 'three'),
    programId('pmndrs.decoration', 'three'),
  ];
  for (const [index, techniqueId] of expectedTechniques.entries()) {
    const offset = programsOffset + index * program.size;
    assert.equal(view.getUint32(offset + program.techniqueId, true), techniqueId);
    assert.equal(view.getUint32(offset + program.programId, true), expectedPrograms[index]);
    assert.ok(view.getUint32(offset + program.drawKeyMask, true) & abi.policy.batchFields.material);
    assert.equal(view.getUint32(offset + program.storageKeyMask, true) & abi.policy.batchFields.material, 0);
    const expectedKind =
      techniqueId === techniqueWireIds.decoration
        ? abi.engine.primitiveKinds.decoration
        : abi.engine.primitiveKinds.glyph;
    assert.equal(view.getUint16(offset + program.primitiveKind, true), expectedKind);
  }

  const shaper = await createRuntimeShaper({ wasm });
  const host = new TextEngineHost(shaper);
  host.registerPolicy(12, bytes);
  host.dispose();
  shaper.dispose();
});
