import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { GlyphBackend } from '../../dist/core.js';
import { assertGlyphId, id } from '../../dist/core/render-policy.js';
import { createRuntimeShaper } from '../../dist/shaper.js';
import { textShaperAbi } from '../../dist/text-shaper-abi.js';
import { engineUpdateBytes, renderPolicyBytes } from '../support/engine-abi.mjs';

const wasmUrl = new URL('../../dist/text-shaper.wasm', import.meta.url);

test('one Wasm engine rejects double ownership and cross-backend policy resolution', async () => {
  const shaper = await createRuntimeShaper({ wasm: await readFile(wasmUrl) });
  const first = new GlyphBackend(shaper);
  const second = new GlyphBackend(shaper);
  const sharedPolicy = id.policy('engine-ownership/shared-policy');
  const firstPolicy = first.id('policy', 'engine-ownership/first-policy');
  const secondPolicy = second.id('policy', 'engine-ownership/second-policy');
  const retainedPlanHandle = first.id('retained-plan', 'engine-ownership/first-transport');
  try {
    first.registerPolicy(sharedPolicy, renderPolicyBytes(textShaperAbi));
    assert.throws(
      () => second.registerPolicy(sharedPolicy, renderPolicyBytes(textShaperAbi)),
      /already owned by another glyph backend/u,
    );
    first.registerPolicy(firstPolicy, renderPolicyBytes(textShaperAbi));
    second.registerPolicy(secondPolicy, renderPolicyBytes(textShaperAbi));
    const transport = first._createPlanTransport({
      handle: retainedPlanHandle,
      requestCapacity: 4096,
      resultCapacity: 4096,
    });
    const accepted = transport.update(
      engineUpdateBytes(textShaperAbi, {
        retainedPlanId: retainedPlanHandle,
        policyHandle: firstPolicy,
        expectedEngineRevision: 0,
        consumedPlanRevision: 0,
      }),
    );
    const foreign = engineUpdateBytes(textShaperAbi, {
      retainedPlanId: retainedPlanHandle,
      policyHandle: secondPolicy,
      expectedEngineRevision: accepted.engineRevision,
      consumedPlanRevision: accepted.planRevision,
    });
    assert.throws(() => transport.update(foreign), /not owned by this glyph backend/u);
    assert.equal(
      transport.isExpired(accepted),
      false,
      'ownership rejection must preserve the last accepted publication',
    );
  } finally {
    first.dispose();
    second.dispose();
    shaper.dispose();
  }
});

test('registration retains a scoped ID independently of the scope that minted it', async () => {
  const shaper = await createRuntimeShaper({ wasm: await readFile(wasmUrl) });
  const minter = new GlyphBackend(shaper);
  const owner = new GlyphBackend(shaper);
  const policyHandle = minter.id('policy', 'engine-ownership/adopted-policy');
  const retainedPlanHandle = owner.id('retained-plan', 'engine-ownership/adopted-transport');
  try {
    owner.registerPolicy(policyHandle, renderPolicyBytes(textShaperAbi));
    minter.dispose();
    assert.equal(assertGlyphId(policyHandle, 'policy', 'policy handle'), policyHandle);
    const request = engineUpdateBytes(textShaperAbi, {
      retainedPlanId: retainedPlanHandle,
      policyHandle,
      expectedEngineRevision: 0,
      consumedPlanRevision: 0,
    });
    const transport = owner._createPlanTransport({
      handle: retainedPlanHandle,
      requestCapacity: request.byteLength,
      resultCapacity: textShaperAbi.layouts.engineResult.size,
    });
    assert.equal(transport.update(request).policyHandle, policyHandle);
  } finally {
    owner.dispose();
    minter.dispose();
    shaper.dispose();
  }
  assert.throws(() => assertGlyphId(policyHandle, 'policy', 'policy handle'), /must come from id/u);
});

test('successful individual disposal releases registration ID provenance', async () => {
  const shaper = await createRuntimeShaper({ wasm: await readFile(wasmUrl) });
  const backend = new GlyphBackend(shaper);
  const policyHandle = backend.id('policy', 'engine-ownership/disposed-policy');
  try {
    backend.registerPolicy(policyHandle, renderPolicyBytes(textShaperAbi));
    backend.disposePolicy(policyHandle);
    assert.throws(() => assertGlyphId(policyHandle, 'policy', 'policy handle'), /must come from id/u);
  } finally {
    backend.dispose();
    shaper.dispose();
  }
});
