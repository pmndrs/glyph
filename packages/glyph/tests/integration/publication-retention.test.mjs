import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import test from 'node:test';

import { GlyphHandleState } from '../../dist/internal/handle-state.js';
import { RenderPlanView } from '../../dist/internal/plan-view.js';
import { id } from '../../dist/config/codec.js';
import { assertOwnedPlanPublication, PlanPublicationExpiredError } from '../../dist/internal/retention.js';
import { compilePlannerFrameUpdate } from '../../dist/internal/frame-wire.js';
import { createRuntimeShaper } from '../../dist/shaper.js';
import { threeCodecBytes } from '../../dist/three/codec.js';
import { textShaperAbi } from '../../dist/text-shaper-abi.js';

const wasmUrl = new URL('../../dist/text-shaper.wasm', import.meta.url);
const CODEC_HANDLE = id.codec('publication-retention/codec');

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
function frameRequest(transport, latest, accepted) {
  return compilePlannerFrameUpdate({
    plannerId: transport.handle,
    codecHandle: CODEC_HANDLE,
    expectedEngineRevision: latest.engineRevision,
    consumedPlanRevision: accepted.planRevision,
    acknowledgedPublicationGeneration: accepted.publicationGeneration,
    limits: LIMITS,
  });
}

async function drivenTransport() {
  const wasm = await readFile(wasmUrl);
  const shaper = await createRuntimeShaper({ wasm });
  const handleState = new GlyphHandleState(shaper);
  handleState.registerCodec(CODEC_HANDLE, threeCodecBytes());
  const transport = handleState._createPlanTransport({
    handle: id.planner('publication-retention/transport'),
    requestCapacity: 4096,
    resultCapacity: 128 * 1024,
  });
  let latest = { engineRevision: 0, planRevision: 0 };
  let accepted = { planRevision: 0, publicationGeneration: 0 };
  return {
    handleState,
    transport,
    publish() {
      latest = transport.update(frameRequest(transport, latest, accepted));
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
  const { transport, publish, accept } = await drivenTransport();

  const first = publish();
  assert.equal(first.publicationGeneration, 1);
  assert.equal(transport.isExpired(first), false, 'a fresh borrow is live');

  // Copying establishes JavaScript ownership but does not claim renderer acceptance.
  const owned = transport.copyPublication(first);
  assert.doesNotThrow(() => assertOwnedPlanPublication(owned));
  assert.equal(transport.isExpired(owned), false, 'a transport-owned copy never expires');
  assert.equal(owned.bytes.byteLength, first.bytes.byteLength);
  assert.notEqual(owned.bytes.buffer, first.memoryBuffer, 'the copy never aliases Wasm memory');
  const transferred = structuredClone(owned);
  assert.throws(
    () => assertOwnedPlanPublication(transferred),
    /was not copied/u,
    'structured cloning cannot transfer same-realm runtime provenance',
  );
  const transferredView = new RenderPlanView();
  assert.doesNotThrow(
    () => transferredView.bindBytes(transferred.bytes),
    'the receiving realm can validate and read the transferred self-owned bytes',
  );
  assert.throws(
    () => transferredView.bindBytes(new Uint16Array(8)),
    /must be a Uint8Array/u,
    'the boundary rejects a different typed-array element width',
  );
  assert.throws(
    () => new RenderPlanView().bindBytes(transferred.bytes.subarray(0, 8)),
    /complete standalone ArrayBuffer/u,
    'cross-realm bytes are validated at the worker-facing call',
  );
  const abiMismatch = transferred.bytes.slice();
  new DataView(abiMismatch.buffer).setUint32(textShaperAbi.layouts.engineResult.abiVersion, 1, true);
  assert.throws(() => transferredView.bindBytes(abiMismatch), /unsupported ABI version/u);
  assert.deepEqual(
    transferredView.table('draws'),
    new RenderPlanView().bindBytes(transferred.bytes).table('draws'),
    'a rejected bind must leave the reader on its prior valid publication',
  );
  const failedResult = transferred.bytes.slice();
  new DataView(failedResult.buffer).setUint32(
    textShaperAbi.layouts.engineResult.status,
    textShaperAbi.status.invalidRequest,
    true,
  );
  assert.throws(() => transferredView.bindBytes(failedResult), /does not contain a successful result/u);
  const malformedSemanticTable = transferred.bytes.slice();
  new DataView(malformedSemanticTable.buffer).setUint32(
    textShaperAbi.layouts.engineResult.semanticViewsOffset,
    textShaperAbi.layouts.engineResult.size,
    true,
  );
  assert.throws(() => transferredView.bindBytes(malformedSemanticTable), /empty text-engine semantic views table/u);
  if (typeof SharedArrayBuffer !== 'undefined') {
    const sharedBytes = new Uint8Array(new SharedArrayBuffer(transferred.bytes.byteLength));
    sharedBytes.set(transferred.bytes);
    assert.doesNotThrow(() => transferredView.bindBytes(sharedBytes), 'shared Wasm memory remains readable');
  }
  const forged = Object.freeze({ ...owned, bytes: first.bytes, memoryBuffer: first.memoryBuffer });
  assert.throws(
    () => assertOwnedPlanPublication(forged),
    /was not copied/u,
    'copying the visible fields cannot forge owned provenance',
  );

  // The borrow dies at the next call even though the A/B slot keeps its bytes readable.
  accept(first);
  const second = publish();
  assert.equal(second.publicationGeneration, 2);
  assert.notEqual(second.outputSlot, first.outputSlot, 'publications alternate slots');
  assert.equal(transport.isExpired(first), true);

  accept(second);
  publish();
  assert.throws(
    () => transport.copyPublication(first),
    (error) =>
      error instanceof PlanPublicationExpiredError && error.consumedGeneration === 1 && error.latestGeneration === 3,
    'a stale borrow must be loud, not silently re-read',
  );
  assert.equal(owned.bytes.byteLength > 0 && owned.bytes[0] !== undefined, true, 'the owned copy outlives every slot');

  transport.dispose();
  assert.equal(transport.isExpired(owned), false, 'transport disposal does not expire owned bytes');
});

test('expiry covers capacity growth and disposal, and foreign publications are rejected', async () => {
  const { handleState, transport, publish } = await drivenTransport();
  const published = publish();
  transport.reserve(4096, 8 * 1024 * 1024);
  assert.equal(transport.isExpired(published), true, 'reserving moves the arenas the borrow points into');
  handleState.dispose();

  // A publication this transport never issued cannot be reasoned about, so even a
  // live-looking one is rejected instead of silently accepted.
  const other = await drivenTransport();
  assert.throws(() => other.transport.isExpired(published), TypeError);
  const owned = other.transport.copyPublication(other.publish());
  const foreign = await drivenTransport();
  assert.throws(
    () => foreign.transport.isExpired(owned),
    TypeError,
    'owned copies remain associated with their transport',
  );
  foreign.transport.dispose();
  other.transport.dispose();
});

test('the engine verifies acceptance: a generation that goes backwards is a conflict', async () => {
  const { transport, publish, accept } = await drivenTransport();
  const first = publish();
  accept(first);

  // The engine records renderer acceptance when this frame lands...
  const second = publish();
  assert.equal(second.publicationGeneration, 2);
  // ...so replaying an older one is a revision conflict, proving the wire field is load-bearing.
  const replayed = compilePlannerFrameUpdate({
    plannerId: transport.handle,
    codecHandle: CODEC_HANDLE,
    expectedEngineRevision: second.engineRevision,
    consumedPlanRevision: second.planRevision,
    acknowledgedPublicationGeneration: 0,
    limits: LIMITS,
  });
  assert.throws(
    () => transport.update(replayed),
    (error) => error.code === 'revision-conflict',
  );
  transport.dispose();
});
