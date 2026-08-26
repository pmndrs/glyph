import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import test from 'node:test';

import {
  assertOwnedTextEnginePublication,
  compileTextEngineFrameUpdate,
  createRuntimeShaper,
  id,
  TextEngineHost,
  TextEnginePublicationExpiredError,
} from '../../dist/core.js';
import { threeRenderPolicyBytes } from '../../dist/three/render-policy.js';

const wasmUrl = new URL('../../dist/text-shaper.wasm', import.meta.url);
const POLICY_HANDLE = id('policy', 'publication-retention/policy');

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

/** One real engine frame with renderer acceptance carried explicitly on the wire. */
function frameRequest(session, latest, accepted) {
  return compileTextEngineFrameUpdate({
    sessionId: session.handle,
    policyHandle: POLICY_HANDLE,
    expectedEngineRevision: latest.engineRevision,
    consumedPlanRevision: accepted.planRevision,
    acknowledgedPublicationGeneration: accepted.publicationGeneration,
    limits: LIMITS,
  });
}

async function drivenSession() {
  const wasm = await readFile(wasmUrl);
  const shaper = await createRuntimeShaper({ wasm });
  const host = new TextEngineHost(shaper);
  host.registerPolicy(POLICY_HANDLE, threeRenderPolicyBytes());
  const session = host.createSession({
    handle: id('session', 'publication-retention/session'),
    requestCapacity: 4096,
    resultCapacity: 128 * 1024,
  });
  let latest = { engineRevision: 0, planRevision: 0 };
  let accepted = { planRevision: 0, publicationGeneration: 0 };
  return {
    host,
    session,
    publish() {
      latest = session.update(frameRequest(session, latest, accepted));
      return latest;
    },
    accept(publication) {
      accepted = {
        planRevision: publication.planRevision,
        publicationGeneration: publication.publicationGeneration,
      };
    },
  };
}

test('a borrowed publication expires at the next call, and an owned copy survives everything', async () => {
  const { session, publish, accept } = await drivenSession();

  const first = publish();
  assert.equal(first.publicationGeneration, 1);
  assert.equal(session.isExpired(first), false, 'a fresh borrow is live');

  // Copying establishes JavaScript ownership but does not claim renderer acceptance.
  const owned = session.copyPublication(first);
  assert.doesNotThrow(() => assertOwnedTextEnginePublication(owned));
  assert.equal(owned.bytes.byteLength, first.bytes.byteLength);
  assert.notEqual(owned.bytes.buffer, first.memoryBuffer, 'the copy never aliases Wasm memory');
  const forged = Object.freeze({ ...owned, bytes: first.bytes, memoryBuffer: first.memoryBuffer });
  assert.throws(
    () => assertOwnedTextEnginePublication(forged),
    /was not copied/u,
    'copying the visible fields cannot forge owned provenance',
  );

  // The borrow dies at the next call even though the A/B slot keeps its bytes readable.
  accept(first);
  const second = publish();
  assert.equal(second.publicationGeneration, 2);
  assert.notEqual(second.outputSlot, first.outputSlot, 'publications alternate slots');
  assert.equal(session.isExpired(first), true);

  accept(second);
  publish();
  assert.throws(
    () => session.copyPublication(first),
    (error) =>
      error instanceof TextEnginePublicationExpiredError &&
      error.consumedGeneration === 1 &&
      error.latestGeneration === 3,
    'a stale borrow must be loud, not silently re-read',
  );
  assert.equal(owned.bytes.byteLength > 0 && owned.bytes[0] !== undefined, true, 'the owned copy outlives every slot');

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

test('the engine verifies acceptance: a generation that goes backwards is a conflict', async () => {
  const { session, publish, accept } = await drivenSession();
  const first = publish();
  accept(first);

  // The engine records renderer acceptance when this frame lands...
  const second = publish();
  assert.equal(second.publicationGeneration, 2);
  // ...so replaying an older one is a revision conflict, proving the wire field is load-bearing.
  const replayed = compileTextEngineFrameUpdate({
    sessionId: session.handle,
    policyHandle: POLICY_HANDLE,
    expectedEngineRevision: second.engineRevision,
    consumedPlanRevision: second.planRevision,
    acknowledgedPublicationGeneration: 0,
    limits: LIMITS,
  });
  assert.throws(
    () => session.update(replayed),
    (error) => error.status === 12,
  );
  session.dispose();
});
