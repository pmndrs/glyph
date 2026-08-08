import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { TextEngineHost } from '../../dist/internal/text-engine-host.js';
import { createRuntimeShaper } from '../../dist/shaper.js';
import { engineUpdateBytes, renderPolicyBytes } from '../support/engine-abi.mjs';

const wasmUrl = new URL('../../dist/text_shaper.wasm', import.meta.url);
const abiUrl = new URL('../../dist/text-shaper-abi-v0.json', import.meta.url);

test('production text-engine host publishes borrowed A/B plans through the runtime shaper instance', async () => {
  const [wasm, abi] = await Promise.all([readFile(wasmUrl), readFile(abiUrl, 'utf8').then(JSON.parse)]);
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
