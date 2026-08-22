export const FRAME_TRANSFER_PROTOCOL_VERSION = 0 as const;

const FRAME_PUBLICATION_TYPE = 'pmndrs-glyph-frame-v0' as const;
const FRAME_RETURN_TYPE = 'pmndrs-glyph-frame-return-v0' as const;

export interface FrameTransferPoolLimits {
  readonly minimumCapacity: number;
  readonly maximumBufferBytes: number;
  readonly maximumOutstandingTransfers: number;
  readonly maximumOutstandingBytes: number;
  readonly maximumPooledBuffers: number;
  readonly maximumPooledBytes: number;
}

export interface FrameTransferPublication {
  readonly type: typeof FRAME_PUBLICATION_TYPE;
  readonly protocolVersion: typeof FRAME_TRANSFER_PROTOCOL_VERSION;
  readonly transferId: number;
  readonly sessionId: number;
  readonly planRevision: number;
  readonly byteLength: number;
  readonly capacity: number;
  readonly buffer: ArrayBuffer;
}

export interface FrameTransferReturn {
  readonly type: typeof FRAME_RETURN_TYPE;
  readonly protocolVersion: typeof FRAME_TRANSFER_PROTOCOL_VERSION;
  readonly transferId: number;
  readonly capacity: number;
  readonly buffer: ArrayBuffer;
}

export interface FrameTransferPoolStats {
  readonly allocations: number;
  readonly poolHits: number;
  readonly transfers: number;
  readonly returns: number;
  readonly rejectedReturns: number;
  readonly discardedReturns: number;
  readonly detachedTransferFailures: number;
  readonly backpressureEvents: number;
  readonly bytesCopied: number;
  readonly transferredBytes: number;
  readonly outstandingTransfers: number;
  readonly outstandingBytes: number;
  readonly pooledBuffers: number;
  readonly pooledBytes: number;
}

export type FrameTransferResult =
  | Readonly<{ ok: true; publication: FrameTransferPublication }>
  | Readonly<{ ok: false; reason: 'backpressure' | 'oversized' | 'transfer-failed'; error?: unknown }>;

export type FrameReturnResult =
  | Readonly<{ ok: true; pooled: boolean }>
  | Readonly<{ ok: false; reason: 'invalid-message' | 'unknown-transfer' | 'capacity-mismatch' }>;

export interface FrameTransferPool {
  transfer(
    bytes: Uint8Array,
    publication: Readonly<{ sessionId: number; planRevision: number }>,
    send: (message: FrameTransferPublication, transfer: readonly Transferable[]) => void,
  ): FrameTransferResult;
  acceptReturn(message: unknown): FrameReturnResult;
  stats(): FrameTransferPoolStats;
}

interface MutableStats {
  allocations: number;
  poolHits: number;
  transfers: number;
  returns: number;
  rejectedReturns: number;
  discardedReturns: number;
  detachedTransferFailures: number;
  backpressureEvents: number;
  bytesCopied: number;
  transferredBytes: number;
}

/**
 * Owns the asynchronous copy boundary for raw frame bytes. The pool never decodes the compiler-defined Wasm layout.
 * A successful `send` must transfer (and therefore detach) the supplied buffer before it returns.
 */
export function createFrameTransferPool(limits: FrameTransferPoolLimits): FrameTransferPool {
  validateLimits(limits);
  const pooled: ArrayBuffer[] = [];
  const outstanding = new Map<number, number>();
  const stats: MutableStats = {
    allocations: 0,
    poolHits: 0,
    transfers: 0,
    returns: 0,
    rejectedReturns: 0,
    discardedReturns: 0,
    detachedTransferFailures: 0,
    backpressureEvents: 0,
    bytesCopied: 0,
    transferredBytes: 0,
  };
  let pooledBytes = 0;
  let outstandingBytes = 0;
  let nextTransferId = 1;

  return {
    transfer(bytes, publication, send) {
      assertPublicationMetadata(publication);
      const minimumCapacity = transferCapacity(bytes.byteLength, limits);
      if (minimumCapacity === undefined) return { ok: false, reason: 'oversized' };
      const availableOutstandingBytes = limits.maximumOutstandingBytes - outstandingBytes;
      if (outstanding.size >= limits.maximumOutstandingTransfers || minimumCapacity > availableOutstandingBytes) {
        stats.backpressureEvents += 1;
        return { ok: false, reason: 'backpressure' };
      }

      const pooledIndex = bestFitIndex(pooled, minimumCapacity, availableOutstandingBytes);
      const buffer = pooledIndex < 0 ? new ArrayBuffer(minimumCapacity) : pooled.splice(pooledIndex, 1)[0]!;
      if (pooledIndex < 0) stats.allocations += 1;
      else {
        pooledBytes -= buffer.byteLength;
        stats.poolHits += 1;
      }
      new Uint8Array(buffer, 0, bytes.byteLength).set(bytes);
      stats.bytesCopied += bytes.byteLength;

      const transferId = nextAvailableTransferId(nextTransferId, outstanding);
      nextTransferId = transferId === 0xffff_ffff ? 1 : transferId + 1;
      const message: FrameTransferPublication = {
        type: FRAME_PUBLICATION_TYPE,
        protocolVersion: FRAME_TRANSFER_PROTOCOL_VERSION,
        transferId,
        sessionId: publication.sessionId,
        planRevision: publication.planRevision,
        byteLength: bytes.byteLength,
        capacity: buffer.byteLength,
        buffer,
      };

      try {
        send(message, [buffer]);
      } catch (error) {
        if (buffer.byteLength > 0) pooledBytes = retainWorkerBuffer(pooled, pooledBytes, buffer, limits);
        else {
          outstanding.set(transferId, message.capacity);
          outstandingBytes += message.capacity;
          stats.detachedTransferFailures += 1;
        }
        return { ok: false, reason: 'transfer-failed', error };
      }
      if (buffer.byteLength !== 0) {
        pooledBytes = retainWorkerBuffer(pooled, pooledBytes, buffer, limits);
        return {
          ok: false,
          reason: 'transfer-failed',
          error: new TypeError('frame transfer sender returned without detaching its buffer'),
        };
      }

      outstanding.set(transferId, message.capacity);
      outstandingBytes += message.capacity;
      stats.transfers += 1;
      stats.transferredBytes += message.capacity;
      return { ok: true, publication: message };
    },

    acceptReturn(message) {
      if (!isFrameTransferReturn(message)) {
        stats.rejectedReturns += 1;
        return { ok: false, reason: 'invalid-message' };
      }
      const expectedCapacity = outstanding.get(message.transferId);
      if (expectedCapacity === undefined) {
        stats.rejectedReturns += 1;
        return { ok: false, reason: 'unknown-transfer' };
      }
      if (message.capacity !== expectedCapacity || message.buffer.byteLength !== expectedCapacity) {
        stats.rejectedReturns += 1;
        return { ok: false, reason: 'capacity-mismatch' };
      }

      outstanding.delete(message.transferId);
      outstandingBytes -= expectedCapacity;
      stats.returns += 1;
      const canPool =
        pooled.length < limits.maximumPooledBuffers && pooledBytes + expectedCapacity <= limits.maximumPooledBytes;
      if (!canPool) {
        stats.discardedReturns += 1;
        return { ok: true, pooled: false };
      }
      pooled.push(message.buffer);
      pooledBytes += expectedCapacity;
      return { ok: true, pooled: true };
    },

    stats() {
      return {
        ...stats,
        outstandingTransfers: outstanding.size,
        outstandingBytes,
        pooledBuffers: pooled.length,
        pooledBytes,
      };
    },
  };
}

/** Transfer a retired root-owned publication back to its originating worker. */
export function returnFrameTransfer(
  publication: FrameTransferPublication,
  send: (message: FrameTransferReturn, transfer: readonly Transferable[]) => void,
): void {
  if (!isFrameTransferPublication(publication)) throw new TypeError('invalid frame transfer publication');
  if (publication.buffer.byteLength !== publication.capacity) {
    throw new TypeError('frame transfer is detached or has the wrong capacity');
  }
  const message: FrameTransferReturn = {
    type: FRAME_RETURN_TYPE,
    protocolVersion: FRAME_TRANSFER_PROTOCOL_VERSION,
    transferId: publication.transferId,
    capacity: publication.capacity,
    buffer: publication.buffer,
  };
  send(message, [publication.buffer]);
  if (publication.buffer.byteLength !== 0) {
    throw new TypeError('frame return sender returned without detaching its buffer');
  }
}

export function isFrameTransferPublication(value: unknown): value is FrameTransferPublication {
  if (!isRecord(value) || value.type !== FRAME_PUBLICATION_TYPE || value.protocolVersion !== 0) return false;
  return (
    positiveU32(value.transferId) &&
    positiveU32(value.sessionId) &&
    nonnegativeU32(value.planRevision) &&
    nonnegativeU32(value.byteLength) &&
    positiveU32(value.capacity) &&
    value.byteLength <= value.capacity &&
    value.buffer instanceof ArrayBuffer
  );
}

export function isFrameTransferReturn(value: unknown): value is FrameTransferReturn {
  if (!isRecord(value) || value.type !== FRAME_RETURN_TYPE || value.protocolVersion !== 0) return false;
  return positiveU32(value.transferId) && positiveU32(value.capacity) && value.buffer instanceof ArrayBuffer;
}

function validateLimits(limits: FrameTransferPoolLimits): void {
  assertPositiveU32('minimumCapacity', limits.minimumCapacity);
  assertPositiveU32('maximumBufferBytes', limits.maximumBufferBytes);
  assertPositiveU32('maximumOutstandingTransfers', limits.maximumOutstandingTransfers);
  assertPositiveU32('maximumOutstandingBytes', limits.maximumOutstandingBytes);
  assertU32('maximumPooledBuffers', limits.maximumPooledBuffers);
  assertU32('maximumPooledBytes', limits.maximumPooledBytes);
  if (limits.minimumCapacity > limits.maximumBufferBytes) {
    throw new RangeError('minimumCapacity cannot exceed maximumBufferBytes');
  }
  if (limits.maximumBufferBytes > limits.maximumOutstandingBytes) {
    throw new RangeError('maximumBufferBytes cannot exceed maximumOutstandingBytes');
  }
}

function assertPublicationMetadata(value: Readonly<{ sessionId: number; planRevision: number }>): void {
  if (!positiveU32(value.sessionId)) throw new RangeError('sessionId must be a positive u32');
  if (!nonnegativeU32(value.planRevision)) throw new RangeError('planRevision must be a u32');
}

function transferCapacity(byteLength: number, limits: FrameTransferPoolLimits): number | undefined {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > limits.maximumBufferBytes) return undefined;
  let capacity = limits.minimumCapacity;
  while (capacity < byteLength && capacity <= Math.floor(limits.maximumBufferBytes / 2)) capacity *= 2;
  return capacity < byteLength ? byteLength : capacity;
}

function bestFitIndex(buffers: readonly ArrayBuffer[], minimumCapacity: number, maximumCapacity: number): number {
  let found = -1;
  for (let index = 0; index < buffers.length; index += 1) {
    const candidate = buffers[index]!;
    if (candidate.byteLength < minimumCapacity || candidate.byteLength > maximumCapacity) continue;
    if (found < 0 || candidate.byteLength < buffers[found]!.byteLength) found = index;
  }
  return found;
}

function retainWorkerBuffer(
  buffers: ArrayBuffer[],
  pooledBytes: number,
  buffer: ArrayBuffer,
  limits: FrameTransferPoolLimits,
): number {
  if (buffers.length >= limits.maximumPooledBuffers || pooledBytes + buffer.byteLength > limits.maximumPooledBytes) {
    return pooledBytes;
  }
  buffers.push(buffer);
  return pooledBytes + buffer.byteLength;
}

function nextAvailableTransferId(start: number, outstanding: ReadonlyMap<number, number>): number {
  let candidate = start;
  do {
    if (!outstanding.has(candidate)) return candidate;
    candidate = candidate === 0xffff_ffff ? 1 : candidate + 1;
  } while (candidate !== start);
  throw new RangeError('frame transfer identifiers are exhausted');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function positiveU32(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0 && Number(value) <= 0xffff_ffff;
}

function nonnegativeU32(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 0xffff_ffff;
}

function assertPositiveU32(name: string, value: number): void {
  if (!positiveU32(value)) throw new RangeError(`${name} must be a positive u32`);
}

function assertU32(name: string, value: number): void {
  if (!nonnegativeU32(value)) throw new RangeError(`${name} must be a u32`);
}
