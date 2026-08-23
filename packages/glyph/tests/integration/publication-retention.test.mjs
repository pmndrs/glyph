import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import test from 'node:test';

import {
  compileTextEngineFrameUpdate,
  createRuntimeShaper,
  TextEngineHost,
  TextEnginePublicationExpiredError,
  retainedPublicationBrand,
} from '../../dist/core.js';
import { threeRenderPolicyBytes } from '../../dist/three/render-policy.js';

const wasmUrl = new URL('../../dist/text-shaper.wasm', import.meta.url);

const LIMITS = {
  maxParagraphs: 8,
  maxClusters: 64,
  maxLines: 16,
  maxRegions: 4,
  maxExclusions: 4,
  maxInlineObjects: 4,
  maxSlotsPerBand: 4,
  maxOutputBytes: 128 * 1024,
};

/** One real engine frame: an empty plan publication, acknowledged at `acknowledgedGeneration`. */
function frameRequest(session, latest) {
  return compileTextEngineFrameUpdate({
    sessionId: session.handle,
    policyHandle: 23,
    capabilitySet: 1,
    expectedEngineRevision: latest.engineRevision,
    consumedPlanRevision: latest.planRevision,
    acknowledgedPublicationGeneration: session.acknowledgedGeneration,
    limits: LIMITS,
  });
}

async function drivenSession() {
  const wasm = await readFile(wasmUrl);
  const shaper = await createRuntimeShaper({ wasm });
  const host = new TextEngineHost(shaper);
  host.registerPolicy(23, threeRenderPolicyBytes());
  const session = host.createSession({ handle: 29, requestCapacity: 4096, resultCapacity: 128 * 1024 });
  let latest = { engineRevision: 0, planRevision: 0 };
  return {
    host,
    session,
    publish() {
      latest = session.update(frameRequest(session, latest));
      return latest;
    },
  };
}

test('a borrowed publication expires loudly at the next call, and retain() survives everything', async () => {
  const { session, publish } = await drivenSession();

  const first = publish();
  assert.equal(first.publicationGeneration, 1);
  assert.equal(session.isExpired(first), false, 'a fresh borrow is live');

  // Retaining is taking what you need: one contiguous copy plus the acknowledgement.
  const owned = session.retain(first);
  assert.equal(owned[retainedPublicationBrand], true);
  assert.equal(owned.bytes.byteLength, first.bytes.byteLength);
  assert.notEqual(owned.bytes.buffer, first.memoryBuffer, 'the copy never aliases Wasm memory');
  assert.equal(session.acknowledgedGeneration, 1);

  // The borrow dies at the next call even though the A/B slot keeps its bytes readable.
  const second = publish();
  assert.equal(second.publicationGeneration, 2);
  assert.notEqual(second.outputSlot, first.outputSlot, 'publications alternate slots');
  assert.equal(session.isExpired(first), true);

  publish();
  assert.throws(
    () => session.assertLive(first),
    (error) =>
      error instanceof TextEnginePublicationExpiredError &&
      error.consumedGeneration === 1 &&
      error.latestGeneration === 3,
    'a stale borrow must be loud, not silently re-read',
  );
  assert.equal(owned.bytes.byteLength > 0 && owned.bytes[0] !== undefined, true, 'the retained copy outlives every slot');

  session.dispose();
});

test('expiry covers capacity growth and disposal, and foreign publications are rejected', async () => {
  const { host, session, publish } = await drivenSession();
  const published = publish();
  session.reserve(4096, 8 * 1024 * 1024);
  assert.equal(session.isExpired(published), true, 'reserving moves the arenas the borrow points into');
  host.dispose();

  // A publication this session never issued cannot be reasoned about, so even a
  // live-looking one is rejected instead of silently accepted.
  const other = await drivenSession();
  assert.throws(() => other.session.isExpired(published), TypeError);
  other.session.dispose();
});

test('the engine verifies consumption: an acknowledged generation that goes backwards is a conflict', async () => {
  const { session, publish } = await drivenSession();
  const first = publish();
  session.acknowledge(first);
  assert.equal(session.acknowledgedGeneration, first.publicationGeneration);

  // The engine records the acknowledgement when this frame lands...
  const second = publish();
  assert.equal(second.publicationGeneration, 2);
  // ...so replaying an older one is a revision conflict, proving the wire field is load-bearing.
  const replayed = compileTextEngineFrameUpdate({
    sessionId: session.handle,
    policyHandle: 23,
    capabilitySet: 1,
    expectedEngineRevision: second.engineRevision,
    consumedPlanRevision: second.planRevision,
    acknowledgedPublicationGeneration: 0,
    limits: LIMITS,
  });
  assert.throws(() => session.update(replayed), (error) => error.status === 12);
  session.dispose();
});
