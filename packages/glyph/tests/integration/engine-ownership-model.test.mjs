import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { GlyphHandleState } from '../../dist/internal/handle-state.js';
import { assertGlyphId, id } from '../../dist/core/render-policy.js';
import { createRuntimeShaper } from '../../dist/shaper.js';
import { textShaperAbi } from '../../dist/text-shaper-abi.js';
import { engineUpdateBytes, renderPolicyBytes } from '../support/engine-abi.mjs';

const wasmUrl = new URL('../../dist/text-shaper.wasm', import.meta.url);

test('one Wasm engine rejects double ownership and cross-handle codec resolution', async () => {
  const shaper = await createRuntimeShaper({ wasm: await readFile(wasmUrl) });
  const first = new GlyphHandleState(shaper);
  const second = new GlyphHandleState(shaper);
  const sharedPolicy = id.policy('engine-ownership/shared-policy');
  const firstPolicy = first.id('policy', 'engine-ownership/first-policy');
  const secondPolicy = second.id('policy', 'engine-ownership/second-policy');
  const plannerHandle = first.id('planner', 'engine-ownership/first-transport');
  try {
    first.registerCodec(sharedPolicy, renderPolicyBytes(textShaperAbi));
    assert.throws(
      () => second.registerCodec(sharedPolicy, renderPolicyBytes(textShaperAbi)),
      /already owned by another Glyph handle state/u,
    );
    first.registerCodec(firstPolicy, renderPolicyBytes(textShaperAbi));
    second.registerCodec(secondPolicy, renderPolicyBytes(textShaperAbi));
    const transport = first._createPlanTransport({
      handle: plannerHandle,
      requestCapacity: 4096,
      resultCapacity: 4096,
    });
    const accepted = transport.update(
      engineUpdateBytes(textShaperAbi, {
        plannerId: plannerHandle,
        policyHandle: firstPolicy,
        expectedEngineRevision: 0,
        consumedPlanRevision: 0,
      }),
    );
    const foreign = engineUpdateBytes(textShaperAbi, {
      plannerId: plannerHandle,
      policyHandle: secondPolicy,
      expectedEngineRevision: accepted.engineRevision,
      consumedPlanRevision: accepted.planRevision,
    });
    assert.throws(() => transport.update(foreign), /not owned by this Glyph handle state/u);
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
  const minter = new GlyphHandleState(shaper);
  const owner = new GlyphHandleState(shaper);
  const policyHandle = minter.id('policy', 'engine-ownership/adopted-policy');
  const plannerHandle = owner.id('planner', 'engine-ownership/adopted-transport');
  try {
    owner.registerCodec(policyHandle, renderPolicyBytes(textShaperAbi));
    minter.dispose();
    assert.equal(assertGlyphId(policyHandle, 'policy', 'policy handle'), policyHandle);
    const request = engineUpdateBytes(textShaperAbi, {
      plannerId: plannerHandle,
      policyHandle,
      expectedEngineRevision: 0,
      consumedPlanRevision: 0,
    });
    const transport = owner._createPlanTransport({
      handle: plannerHandle,
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
  const handleState = new GlyphHandleState(shaper);
  const policyHandle = handleState.id('policy', 'engine-ownership/disposed-policy');
  try {
    handleState.registerCodec(policyHandle, renderPolicyBytes(textShaperAbi));
    handleState.disposeCodec(policyHandle);
    assert.throws(() => assertGlyphId(policyHandle, 'policy', 'policy handle'), /must come from id/u);
  } finally {
    handleState.dispose();
    shaper.dispose();
  }
});
