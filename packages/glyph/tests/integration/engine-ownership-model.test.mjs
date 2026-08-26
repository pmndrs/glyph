import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { id, TextEngineHost } from '../../dist/core.js';
import { assertGlyphId } from '../../dist/core/render-policy.js';
import { createRuntimeShaper } from '../../dist/shaper.js';
import { textShaperAbi } from '../../dist/text-shaper-abi.js';
import { engineUpdateBytes, renderPolicyBytes } from '../support/engine-abi.mjs';

const wasmUrl = new URL('../../dist/text-shaper.wasm', import.meta.url);

test('one Wasm engine rejects double ownership and cross-host policy resolution', async () => {
  const shaper = await createRuntimeShaper({ wasm: await readFile(wasmUrl) });
  const first = new TextEngineHost(shaper);
  const second = new TextEngineHost(shaper);
  const sharedPolicy = id('policy', 'engine-ownership/shared-policy');
  const firstPolicy = first.id('policy', 'engine-ownership/first-policy');
  const secondPolicy = second.id('policy', 'engine-ownership/second-policy');
  const sessionHandle = first.id('session', 'engine-ownership/first-session');
  try {
    first.registerPolicy(sharedPolicy, renderPolicyBytes(textShaperAbi));
    assert.throws(
      () => second.registerPolicy(sharedPolicy, renderPolicyBytes(textShaperAbi)),
      /already owned by another text engine host/u,
    );
    first.registerPolicy(firstPolicy, renderPolicyBytes(textShaperAbi));
    second.registerPolicy(secondPolicy, renderPolicyBytes(textShaperAbi));
    const session = first.createSession({
      handle: sessionHandle,
      requestCapacity: 4096,
      resultCapacity: 4096,
    });
    const accepted = session.update(
      engineUpdateBytes(textShaperAbi, {
        sessionId: sessionHandle,
        policyHandle: firstPolicy,
        expectedEngineRevision: 0,
        consumedPlanRevision: 0,
      }),
    );
    const foreign = engineUpdateBytes(textShaperAbi, {
      sessionId: sessionHandle,
      policyHandle: secondPolicy,
      expectedEngineRevision: accepted.engineRevision,
      consumedPlanRevision: accepted.planRevision,
    });
    assert.throws(() => session.update(foreign), /not owned by this text engine host/u);
    assert.equal(session.isExpired(accepted), false, 'ownership rejection must preserve the last accepted publication');
  } finally {
    first.dispose();
    second.dispose();
    shaper.dispose();
  }
});

test('registration retains a scoped ID independently of the scope that minted it', async () => {
  const shaper = await createRuntimeShaper({ wasm: await readFile(wasmUrl) });
  const minter = new TextEngineHost(shaper);
  const owner = new TextEngineHost(shaper);
  const policyHandle = minter.id('policy', 'engine-ownership/adopted-policy');
  const sessionHandle = owner.id('session', 'engine-ownership/adopted-session');
  try {
    owner.registerPolicy(policyHandle, renderPolicyBytes(textShaperAbi));
    minter.dispose();
    assert.equal(assertGlyphId(policyHandle, 'policy', 'policy handle'), policyHandle);
    const request = engineUpdateBytes(textShaperAbi, {
      sessionId: sessionHandle,
      policyHandle,
      expectedEngineRevision: 0,
      consumedPlanRevision: 0,
    });
    const session = owner.createSession({
      handle: sessionHandle,
      requestCapacity: request.byteLength,
      resultCapacity: textShaperAbi.layouts.engineResult.size,
    });
    assert.equal(session.update(request).policyHandle, policyHandle);
  } finally {
    owner.dispose();
    minter.dispose();
    shaper.dispose();
  }
  assert.throws(() => assertGlyphId(policyHandle, 'policy', 'policy handle'), /must come from id/u);
});

test('successful individual disposal releases registration ID provenance', async () => {
  const shaper = await createRuntimeShaper({ wasm: await readFile(wasmUrl) });
  const host = new TextEngineHost(shaper);
  const policyHandle = host.id('policy', 'engine-ownership/disposed-policy');
  try {
    host.registerPolicy(policyHandle, renderPolicyBytes(textShaperAbi));
    host.disposePolicy(policyHandle);
    assert.throws(() => assertGlyphId(policyHandle, 'policy', 'policy handle'), /must come from id/u);
  } finally {
    host.dispose();
    shaper.dispose();
  }
});
