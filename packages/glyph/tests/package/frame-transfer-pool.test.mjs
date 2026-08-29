import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createExactFrameBufferPool,
  createFrameTransferPool,
  isFrameTransferPublication,
  returnFrameTransfer,
} from '../../dist/internal/frame-transfer-pool.js';

test('owned plan buffers reuse exact sizes within deterministic count and byte bounds', () => {
  const pool = createExactFrameBufferPool({
    maximumBufferBytes: 64,
    maximumPooledBuffers: 2,
    maximumPooledBytes: 72,
  });

  const first24 = pool.acquire(24);
  assert.equal(pool.release(first24), true);
  const first40 = pool.acquire(40);
  assert.equal(pool.release(first40), true);
  const reused24 = pool.acquire(24);
  assert.equal(reused24, first24);
  assert.equal(pool.release(reused24), true);
  const first48 = pool.acquire(48);
  assert.equal(pool.release(first48), true);

  assert.deepEqual(pool.stats(), {
    allocations: 3,
    poolHits: 1,
    returns: 4,
    discardedReturns: 1,
    pooledBuffers: 2,
    pooledBytes: 72,
  });

  const replacement40 = pool.acquire(40);
  assert.notEqual(replacement40, first40);
  assert.equal(pool.acquire(24), first24);
  assert.deepEqual(pool.stats(), {
    allocations: 4,
    poolHits: 2,
    returns: 4,
    discardedReturns: 1,
    pooledBuffers: 1,
    pooledBytes: 48,
  });
  pool.clear();
  assert.equal(pool.stats().pooledBuffers, 0);
  assert.equal(pool.stats().pooledBytes, 0);
});

test('owned plan buffer pooling validates ownership and discards unusable returns', () => {
  assert.throws(() => createExactFrameBufferPool(null), /limits must be an object/);
  assert.throws(
    () =>
      createExactFrameBufferPool({
        maximumBufferBytes: 0,
        maximumPooledBuffers: 1,
        maximumPooledBytes: 1,
      }),
    /positive u32/,
  );
  const pool = createExactFrameBufferPool({
    maximumBufferBytes: 16,
    maximumPooledBuffers: 1,
    maximumPooledBytes: 16,
  });
  assert.throws(() => pool.acquire(0), /positive u32/);
  assert.throws(() => pool.acquire(17), /maximumBufferBytes/);
  assert.throws(() => pool.release(new Uint8Array(1)), /attached ArrayBuffer/);
  const detached = new ArrayBuffer(1);
  structuredClone(detached, { transfer: [detached] });
  assert.throws(() => pool.release(detached), /attached ArrayBuffer/);
  assert.throws(() => pool.release(new ArrayBuffer(17)), /invalid byte length/);
  const returned = new ArrayBuffer(8);
  assert.equal(pool.release(returned), true);
  assert.throws(() => pool.release(returned), /returned twice/);

  const discardPool = createExactFrameBufferPool({
    maximumBufferBytes: 16,
    maximumPooledBuffers: 0,
    maximumPooledBytes: 0,
  });
  const discarded = new ArrayBuffer(8);
  assert.equal(discardPool.release(discarded), false);
  assert.throws(() => discardPool.release(discarded), /returned twice/);
  assert.equal(discardPool.stats().discardedReturns, 1);
});

const limits = {
  maximumBufferBytes: 1_024,
  maximumOutstandingTransfers: 2,
  maximumOutstandingBytes: 2_048,
  maximumPooledBuffers: 2,
  maximumPooledBytes: 2_048,
};

function transferToRoot(pool, bytes, planRevision, expectedPooledBuffer) {
  let rootPublication;
  const result = pool.transfer(bytes, { plannerId: 7, planRevision }, (message, transfer) => {
    assert.deepEqual(transfer, [message.buffer]);
    if (expectedPooledBuffer !== undefined) assert.equal(message.buffer, expectedPooledBuffer);
    rootPublication = structuredClone(message, { transfer });
  });

  assert.equal(result.ok, true);
  assert.equal(result.publication.buffer.detached, true);
  assert.equal(isFrameTransferPublication(rootPublication), true);
  assert.equal(rootPublication.byteLength, bytes.byteLength);
  assert.equal(rootPublication.capacity, bytes.byteLength);
  assert.equal(rootPublication.buffer.byteLength, bytes.byteLength);
  assert.deepEqual(new Uint8Array(rootPublication.buffer), bytes);
  return rootPublication;
}

function returnToPool(pool, publication) {
  let returned;
  returnFrameTransfer(publication, (message, transfer) => {
    assert.deepEqual(transfer, [message.buffer]);
    assert.equal(message.transferId, publication.transferId);
    returned = structuredClone(message, { transfer });
  });
  assert.equal(publication.buffer.detached, true);
  const result = pool.acceptReturn(returned);
  return { result, buffer: returned.buffer };
}

test('stable-size transfers own a full-span exact allocation and reuse the returned identity', () => {
  const pool = createFrameTransferPool(limits);
  const sourceBacking = Uint8Array.from({ length: 137 }, (_, index) => (index * 17) & 0xff);
  const source = sourceBacking.subarray(4, 133);
  let expectedPooledBuffer;
  const freshExactSizeBaseline = 6;

  for (let revision = 0; revision < freshExactSizeBaseline; revision += 1) {
    const publication = transferToRoot(pool, source, revision, expectedPooledBuffer);
    assert.equal(source.buffer.detached, false);
    assert.equal(source.byteOffset, 4);
    const returned = returnToPool(pool, publication);
    assert.deepEqual(returned.result, { ok: true, pooled: true });
    expectedPooledBuffer = returned.buffer;
  }

  const stats = pool.stats();
  assert.deepEqual(stats, {
    allocations: 1,
    poolHits: 5,
    transfers: 6,
    returns: 6,
    rejectedReturns: 0,
    discardedReturns: 0,
    detachedTransferFailures: 0,
    backpressureEvents: 0,
    bytesCopied: 774,
    transferredBytes: 774,
    outstandingTransfers: 0,
    outstandingBytes: 0,
    pooledBuffers: 1,
    pooledBytes: 129,
  });
  assert.ok(stats.allocations <= freshExactSizeBaseline);
});

test('variable-size transfers use exact buckets and evict the least-recently-returned buffer', () => {
  const variableLimits = {
    maximumBufferBytes: 64,
    maximumOutstandingTransfers: 2,
    maximumOutstandingBytes: 128,
    maximumPooledBuffers: 2,
    maximumPooledBytes: 72,
  };
  const pool = createFrameTransferPool(variableLimits);
  const returnedByLength = new Map();

  const roundTrip = (byteLength, revision, expectedPooledBuffer) => {
    const backing = Uint8Array.from({ length: byteLength + 4 }, (_, index) => (index + revision) & 0xff);
    const publication = transferToRoot(pool, backing.subarray(2, byteLength + 2), revision, expectedPooledBuffer);
    const returned = returnToPool(pool, publication);
    assert.deepEqual(returned.result, { ok: true, pooled: true });
    returnedByLength.set(byteLength, returned.buffer);
    const stats = pool.stats();
    assert.ok(stats.pooledBuffers <= variableLimits.maximumPooledBuffers);
    assert.ok(stats.pooledBytes <= variableLimits.maximumPooledBytes);
  };

  roundTrip(24, 1);
  roundTrip(40, 2);
  roundTrip(24, 3, returnedByLength.get(24));
  roundTrip(48, 4);

  assert.deepEqual(pool.stats(), {
    allocations: 3,
    poolHits: 1,
    transfers: 4,
    returns: 4,
    rejectedReturns: 0,
    discardedReturns: 1,
    detachedTransferFailures: 0,
    backpressureEvents: 0,
    bytesCopied: 136,
    transferredBytes: 136,
    outstandingTransfers: 0,
    outstandingBytes: 0,
    pooledBuffers: 2,
    pooledBytes: 72,
  });

  let replacement40;
  const publication40 = pool.transfer(new Uint8Array(40), { plannerId: 7, planRevision: 5 }, (message, transfer) => {
    replacement40 = message.buffer;
    structuredClone(message, { transfer });
  });
  assert.equal(publication40.ok, true);
  assert.notEqual(replacement40, returnedByLength.get(40));

  transferToRoot(pool, new Uint8Array(24), 6, returnedByLength.get(24));
  const stats = pool.stats();
  assert.equal(stats.allocations, 4);
  assert.equal(stats.poolHits, 2);
  assert.equal(stats.discardedReturns, 1);
  assert.equal(stats.outstandingTransfers, 2);
  assert.equal(stats.outstandingBytes, 64);
  assert.equal(stats.pooledBuffers, 1);
  assert.equal(stats.pooledBytes, 48);
  assert.ok(stats.allocations <= 6, 'pooling must not allocate more than a fresh exact-size buffer per transfer');
});

test('buffer, outstanding, and pooled bounds produce call-bound results without sending rejected work', () => {
  const pool = createFrameTransferPool({
    maximumBufferBytes: 10,
    maximumOutstandingTransfers: 2,
    maximumOutstandingBytes: 10,
    maximumPooledBuffers: 0,
    maximumPooledBytes: 0,
  });
  const neverSend = () => assert.fail('rejected transfer must not call its sender');

  assert.deepEqual(pool.transfer(new Uint8Array(11), { plannerId: 1, planRevision: 0 }, neverSend), {
    ok: false,
    reason: 'oversized',
  });
  transferToRoot(pool, new Uint8Array(6), 1);
  assert.deepEqual(pool.transfer(new Uint8Array(5), { plannerId: 1, planRevision: 2 }, neverSend), {
    ok: false,
    reason: 'backpressure',
  });
  transferToRoot(pool, new Uint8Array(4), 3);
  assert.deepEqual(pool.transfer(new Uint8Array(1), { plannerId: 1, planRevision: 4 }, neverSend), {
    ok: false,
    reason: 'backpressure',
  });
  assert.equal(pool.stats().backpressureEvents, 2);

  const discardPool = createFrameTransferPool({ ...limits, maximumPooledBuffers: 0, maximumPooledBytes: 0 });
  const publication = transferToRoot(discardPool, new Uint8Array(32), 1);
  assert.deepEqual(returnToPool(discardPool, publication).result, { ok: true, pooled: false });
  assert.equal(discardPool.stats().discardedReturns, 1);
  assert.equal(discardPool.stats().pooledBuffers, 0);
  assert.equal(discardPool.stats().pooledBytes, 0);
});

test('public call inputs and worker returns are validated before ownership changes', () => {
  assert.throws(() => createFrameTransferPool(null), /limits must be an object/);
  assert.throws(() => createFrameTransferPool([]), /limits must be an object/);
  assert.throws(() => createFrameTransferPool({ ...limits, maximumBufferBytes: 0 }), /positive u32/);
  assert.throws(
    () => createFrameTransferPool({ ...limits, maximumOutstandingBytes: 1 }),
    /maximumBufferBytes cannot exceed maximumOutstandingBytes/,
  );

  const mutableLimits = { ...limits };
  const pool = createFrameTransferPool(mutableLimits);
  mutableLimits.maximumBufferBytes = 0;
  assert.throws(() => pool.transfer(null, { plannerId: 1, planRevision: 0 }, () => {}), /attached Uint8Array/);
  assert.throws(
    () => pool.transfer(new Uint8Array(), { plannerId: 1, planRevision: 0 }, () => {}),
    /must not be empty/,
  );
  assert.throws(() => pool.transfer(new Uint8Array(1), null, () => {}), /metadata must be an object/);
  assert.throws(
    () => pool.transfer(new Uint8Array(1), { plannerId: 0, planRevision: 0 }, () => {}),
    /plannerId must be a positive u32/,
  );
  assert.throws(
    () => pool.transfer(new Uint8Array(1), { plannerId: 1, planRevision: 0 }, null),
    /send must be a function/,
  );
  const detachedBytes = new Uint8Array(1);
  structuredClone(detachedBytes.buffer, { transfer: [detachedBytes.buffer] });
  assert.throws(() => pool.transfer(detachedBytes, { plannerId: 1, planRevision: 0 }, () => {}), /attached Uint8Array/);

  const publication = transferToRoot(pool, new Uint8Array(8), 1);
  assert.equal(isFrameTransferPublication({ ...publication, byteLength: 7 }), false);
  assert.deepEqual(pool.acceptReturn([]), { ok: false, reason: 'invalid-message' });
  assert.deepEqual(
    pool.acceptReturn({
      type: 'pmndrs-glyph-frame-return-v0',
      protocolVersion: 0,
      transferId: 99,
      capacity: 8,
      buffer: new ArrayBuffer(8),
    }),
    { ok: false, reason: 'unknown-transfer' },
  );
  assert.deepEqual(
    pool.acceptReturn({
      type: 'pmndrs-glyph-frame-return-v0',
      protocolVersion: 0,
      transferId: publication.transferId,
      capacity: 7,
      buffer: new ArrayBuffer(7),
    }),
    { ok: false, reason: 'capacity-mismatch' },
  );
  assert.throws(() => returnFrameTransfer(publication, null), /send must be a function/);
  const returned = returnToPool(pool, publication);
  assert.deepEqual(returned.result, { ok: true, pooled: true });
  assert.deepEqual(
    pool.acceptReturn({
      type: 'pmndrs-glyph-frame-return-v0',
      protocolVersion: 0,
      transferId: publication.transferId,
      capacity: 8,
      buffer: new ArrayBuffer(8),
    }),
    { ok: false, reason: 'unknown-transfer' },
  );
  assert.throws(() => returnFrameTransfer(publication, () => {}), /invalid frame transfer publication/);
});

test('sender failures preserve the one-copy result variants and account for detached ownership', () => {
  const pool = createFrameTransferPool(limits);
  const thrown = new Error('postMessage failed');
  const failure = pool.transfer(new Uint8Array(16), { plannerId: 1, planRevision: 1 }, () => {
    throw thrown;
  });
  assert.deepEqual(failure, { ok: false, reason: 'transfer-failed', error: thrown });

  const missingTransfer = pool.transfer(new Uint8Array(16), { plannerId: 1, planRevision: 2 }, () => {});
  assert.equal(missingTransfer.ok, false);
  assert.equal(missingTransfer.reason, 'transfer-failed');
  assert.match(String(missingTransfer.error), /without detaching/);

  let detachedPublication;
  const detachedFailure = pool.transfer(new Uint8Array(16), { plannerId: 1, planRevision: 3 }, (message, transfer) => {
    detachedPublication = structuredClone(message, { transfer });
    throw thrown;
  });
  assert.deepEqual(detachedFailure, { ok: false, reason: 'transfer-failed', error: thrown });
  assert.equal(pool.stats().detachedTransferFailures, 1);
  assert.equal(pool.stats().outstandingTransfers, 1);

  const returned = returnToPool(pool, detachedPublication);
  assert.deepEqual(returned.result, { ok: true, pooled: true });
  assert.deepEqual(pool.stats(), {
    allocations: 1,
    poolHits: 2,
    transfers: 0,
    returns: 1,
    rejectedReturns: 0,
    discardedReturns: 0,
    detachedTransferFailures: 1,
    backpressureEvents: 0,
    bytesCopied: 48,
    transferredBytes: 0,
    outstandingTransfers: 0,
    outstandingBytes: 0,
    pooledBuffers: 1,
    pooledBytes: 16,
  });
});
