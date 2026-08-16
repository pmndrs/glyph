import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createFrameTransferPool,
  isFrameTransferPublicationV0,
  returnFrameTransfer,
} from '../../dist/internal/frame-transfer-pool.js';

const limits = {
  minimumCapacity: 256,
  maximumBufferBytes: 1_024,
  maximumOutstandingTransfers: 1,
  maximumOutstandingBytes: 1_024,
  maximumPooledBuffers: 1,
  maximumPooledBytes: 1_024,
};

test('frame transfers copy opaque Wasm bytes once and return the same storage to the worker pool', () => {
  const pool = createFrameTransferPool(limits);
  const source = Uint8Array.from({ length: 129 }, (_, index) => (index * 17) & 0xff);
  let rootPublication;
  const first = pool.transfer(source, { sessionId: 7, planRevision: 11 }, (message, transfer) => {
    rootPublication = structuredClone(message, { transfer });
  });

  assert.equal(first.ok, true);
  assert.equal(first.publication.buffer.byteLength, 0);
  assert.equal(isFrameTransferPublicationV0(rootPublication), true);
  assert.equal(rootPublication.capacity, 256);
  assert.deepEqual(new Uint8Array(rootPublication.buffer, 0, rootPublication.byteLength), source);
  assert.deepEqual(pool.stats(), {
    allocations: 1,
    poolHits: 0,
    transfers: 1,
    returns: 0,
    rejectedReturns: 0,
    discardedReturns: 0,
    detachedTransferFailures: 0,
    backpressureEvents: 0,
    bytesCopied: 129,
    transferredBytes: 256,
    outstandingTransfers: 1,
    outstandingBytes: 256,
    pooledBuffers: 0,
    pooledBytes: 0,
  });

  const blocked = pool.transfer(source, { sessionId: 7, planRevision: 12 }, () => {
    assert.fail('backpressure must reject before sending');
  });
  assert.deepEqual(blocked, { ok: false, reason: 'backpressure' });

  let returned;
  returnFrameTransfer(rootPublication, (message, transfer) => {
    returned = structuredClone(message, { transfer });
  });
  assert.equal(rootPublication.buffer.byteLength, 0);
  assert.deepEqual(pool.acceptReturn(returned), { ok: true, pooled: true });

  let secondRootPublication;
  const second = pool.transfer(source.subarray(0, 64), { sessionId: 7, planRevision: 12 }, (message, transfer) => {
    secondRootPublication = structuredClone(message, { transfer });
  });
  assert.equal(second.ok, true);
  assert.equal(secondRootPublication.transferId, 2);
  assert.deepEqual(
    new Uint8Array(secondRootPublication.buffer, 0, secondRootPublication.byteLength),
    source.subarray(0, 64),
  );
  assert.deepEqual(pool.stats(), {
    allocations: 1,
    poolHits: 1,
    transfers: 2,
    returns: 1,
    rejectedReturns: 0,
    discardedReturns: 0,
    detachedTransferFailures: 0,
    backpressureEvents: 1,
    bytesCopied: 193,
    transferredBytes: 512,
    outstandingTransfers: 1,
    outstandingBytes: 256,
    pooledBuffers: 0,
    pooledBytes: 0,
  });
});

test('frame transfers reject detached misuse, forged returns, and oversized publications', () => {
  const pool = createFrameTransferPool(limits);
  const oversized = pool.transfer(new Uint8Array(1_025), { sessionId: 1, planRevision: 0 }, () => {
    assert.fail('oversized transfer must reject before sending');
  });
  assert.deepEqual(oversized, { ok: false, reason: 'oversized' });

  let rootPublication;
  const transferred = pool.transfer(new Uint8Array(1), { sessionId: 1, planRevision: 0 }, (message, transfer) => {
    rootPublication = structuredClone(message, { transfer });
  });
  assert.equal(transferred.ok, true);
  assert.deepEqual(
    pool.acceptReturn({
      type: 'pmndrs-glyph-frame-return-v0',
      protocolVersion: 0,
      transferId: 99,
      capacity: 256,
      buffer: new ArrayBuffer(256),
    }),
    { ok: false, reason: 'unknown-transfer' },
  );
  assert.deepEqual(
    pool.acceptReturn({
      type: 'pmndrs-glyph-frame-return-v0',
      protocolVersion: 0,
      transferId: rootPublication.transferId,
      capacity: 512,
      buffer: new ArrayBuffer(512),
    }),
    { ok: false, reason: 'capacity-mismatch' },
  );

  let returned;
  returnFrameTransfer(rootPublication, (message, transfer) => {
    returned = structuredClone(message, { transfer });
  });
  assert.throws(() => returnFrameTransfer(rootPublication, () => {}), /detached/);
  assert.deepEqual(pool.acceptReturn(returned), { ok: true, pooled: true });
  assert.deepEqual(pool.acceptReturn(returned), { ok: false, reason: 'unknown-transfer' });
});

test('failed send retains worker ownership and never consumes outstanding capacity', () => {
  const pool = createFrameTransferPool(limits);
  const source = new Uint8Array(16);
  const thrown = new Error('postMessage failed');
  const failure = pool.transfer(source, { sessionId: 1, planRevision: 1 }, () => {
    throw thrown;
  });
  assert.equal(failure.ok, false);
  assert.equal(failure.reason, 'transfer-failed');
  assert.equal(failure.error, thrown);

  const missingTransfer = pool.transfer(source, { sessionId: 1, planRevision: 1 }, () => {});
  assert.equal(missingTransfer.ok, false);
  assert.equal(missingTransfer.reason, 'transfer-failed');
  assert.match(String(missingTransfer.error), /without detaching/);
  assert.deepEqual(pool.stats(), {
    allocations: 1,
    poolHits: 1,
    transfers: 0,
    returns: 0,
    rejectedReturns: 0,
    discardedReturns: 0,
    detachedTransferFailures: 0,
    backpressureEvents: 0,
    bytesCopied: 32,
    transferredBytes: 0,
    outstandingTransfers: 0,
    outstandingBytes: 0,
    pooledBuffers: 1,
    pooledBytes: 256,
  });
});

test('returned buffers over the pool bound become collectible only after worker ownership resumes', () => {
  const pool = createFrameTransferPool({
    ...limits,
    maximumPooledBuffers: 0,
    maximumPooledBytes: 0,
  });
  let rootPublication;
  assert.equal(
    pool.transfer(new Uint8Array(32), { sessionId: 1, planRevision: 1 }, (message, transfer) => {
      rootPublication = structuredClone(message, { transfer });
    }).ok,
    true,
  );

  let returned;
  returnFrameTransfer(rootPublication, (message, transfer) => {
    returned = structuredClone(message, { transfer });
  });
  assert.deepEqual(pool.acceptReturn(returned), { ok: true, pooled: false });
  assert.deepEqual(pool.stats(), {
    allocations: 1,
    poolHits: 0,
    transfers: 1,
    returns: 1,
    rejectedReturns: 0,
    discardedReturns: 1,
    detachedTransferFailures: 0,
    backpressureEvents: 0,
    bytesCopied: 32,
    transferredBytes: 256,
    outstandingTransfers: 0,
    outstandingBytes: 0,
    pooledBuffers: 0,
    pooledBytes: 0,
  });
});
