export const FRAME_TRANSFER_PROTOCOL_VERSION = 0 as const;

const FRAME_PUBLICATION_TYPE = 'pmndrs-glyph-frame-v0' as const;
const FRAME_RETURN_TYPE = 'pmndrs-glyph-frame-return-v0' as const;

export interface FrameTransferPoolLimits {
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
  readonly plannerId: number;
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
    publication: Readonly<{ plannerId: number; planRevision: number }>,
    send: (message: FrameTransferPublication, transfer: readonly Transferable[]) => void,
  ): FrameTransferResult;
  acceptReturn(message: unknown): FrameReturnResult;
  stats(): FrameTransferPoolStats;
}

export interface ExactFrameBufferPoolLimits {
  readonly maximumBufferBytes: number;
  readonly maximumPooledBuffers: number;
  readonly maximumPooledBytes: number;
}

export interface ExactFrameBufferPoolStats {
  readonly allocations: number;
  readonly poolHits: number;
  readonly returns: number;
  readonly discardedReturns: number;
  readonly pooledBuffers: number;
  readonly pooledBytes: number;
}

export interface ExactFrameBufferPool {
  acquire(byteLength: number): ArrayBuffer;
  release(buffer: ArrayBuffer): boolean;
  clear(): void;
  stats(): ExactFrameBufferPoolStats;
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
 * Owns the asynchronous copy boundary for raw frame bytes. The pool never decodes the compiler-defined Wasm measure.
 * A successful `send` must transfer (and therefore detach) the supplied buffer before it returns.
 */
export function createFrameTransferPool(limits: FrameTransferPoolLimits): FrameTransferPool {
  const validatedLimits = validateLimits(limits);
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
      assertTransferBytes(bytes);
      assertPublicationMetadata(publication);
      assertFunction('send', send);
      const byteLength = bytes.byteLength;
      if (byteLength > validatedLimits.maximumBufferBytes) return { ok: false, reason: 'oversized' };
      const availableOutstandingBytes = validatedLimits.maximumOutstandingBytes - outstandingBytes;
      if (outstanding.size >= validatedLimits.maximumOutstandingTransfers || byteLength > availableOutstandingBytes) {
        stats.backpressureEvents += 1;
        return { ok: false, reason: 'backpressure' };
      }

      const pooledIndex = exactLengthIndex(pooled, byteLength);
      const buffer = pooledIndex < 0 ? new ArrayBuffer(byteLength) : pooled.splice(pooledIndex, 1)[0]!;
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
        plannerId: publication.plannerId,
        planRevision: publication.planRevision,
        byteLength: bytes.byteLength,
        capacity: buffer.byteLength,
        buffer,
      };

      try {
        send(message, [buffer]);
      } catch (error) {
        if (!buffer.detached) {
          pooledBytes = retainWorkerBuffer(pooled, pooledBytes, buffer, validatedLimits, stats, false).pooledBytes;
        } else {
          outstanding.set(transferId, message.capacity);
          outstandingBytes += message.capacity;
          stats.detachedTransferFailures += 1;
        }
        return { ok: false, reason: 'transfer-failed', error };
      }
      if (!buffer.detached) {
        pooledBytes = retainWorkerBuffer(pooled, pooledBytes, buffer, validatedLimits, stats, false).pooledBytes;
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
      if (!outstanding.has(message.transferId)) {
        stats.rejectedReturns += 1;
        return { ok: false, reason: 'unknown-transfer' };
      }
      // `has` proves the value exists independently of its stored byte length.
      if (expectedCapacity === undefined) throw new TypeError('frame transfer pool lost an outstanding byte length');
      if (message.capacity !== expectedCapacity || message.buffer.byteLength !== expectedCapacity) {
        stats.rejectedReturns += 1;
        return { ok: false, reason: 'capacity-mismatch' };
      }

      outstanding.delete(message.transferId);
      outstandingBytes -= expectedCapacity;
      stats.returns += 1;
      const retained = retainWorkerBuffer(pooled, pooledBytes, message.buffer, validatedLimits, stats, true);
      pooledBytes = retained.pooledBytes;
      return { ok: true, pooled: retained.retained };
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

/** Bounded exact-size allocation reuse shared by owned plan delivery. */
export function createExactFrameBufferPool(limits: ExactFrameBufferPoolLimits): ExactFrameBufferPool {
  if (!isNonArrayObject(limits)) throw new TypeError('exact frame buffer pool limits must be an object');
  assertPositiveU32('maximumBufferBytes', limits.maximumBufferBytes);
  assertU32('maximumPooledBuffers', limits.maximumPooledBuffers);
  assertU32('maximumPooledBytes', limits.maximumPooledBytes);
  const maximumBufferBytes = limits.maximumBufferBytes;
  const maximumPooledBuffers = limits.maximumPooledBuffers;
  const maximumPooledBytes = limits.maximumPooledBytes;
  const pooled: ArrayBuffer[] = [];
  const returned = new WeakSet<ArrayBuffer>();
  let pooledBytes = 0;
  let allocations = 0;
  let poolHits = 0;
  let returns = 0;
  let discardedReturns = 0;

  return {
    acquire(byteLength) {
      assertPositiveU32('exact frame buffer byteLength', byteLength);
      if (byteLength > maximumBufferBytes) throw new RangeError('exact frame buffer exceeds maximumBufferBytes');
      const index = exactLengthIndex(pooled, byteLength);
      if (index < 0) {
        allocations += 1;
        return new ArrayBuffer(byteLength);
      }
      const buffer = pooled.splice(index, 1)[0]!;
      returned.delete(buffer);
      pooledBytes -= buffer.byteLength;
      poolHits += 1;
      return buffer;
    },

    release(buffer) {
      if (!(buffer instanceof ArrayBuffer) || buffer.detached) {
        throw new TypeError('returned exact frame buffer must be an attached ArrayBuffer');
      }
      if (buffer.byteLength === 0 || buffer.byteLength > maximumBufferBytes) {
        throw new RangeError('returned exact frame buffer has an invalid byte length');
      }
      if (returned.has(buffer)) throw new TypeError('exact frame buffer was returned twice');
      returned.add(buffer);
      returns += 1;
      pooled.push(buffer);
      pooledBytes += buffer.byteLength;
      while (pooled.length > maximumPooledBuffers || pooledBytes > maximumPooledBytes) {
        const discarded = pooled.shift();
        if (discarded === undefined) throw new TypeError('exact frame buffer pool accounting is inconsistent');
        pooledBytes -= discarded.byteLength;
        discardedReturns += 1;
      }
      return pooled.includes(buffer);
    },

    clear() {
      pooled.length = 0;
      pooledBytes = 0;
    },

    stats() {
      return {
        allocations,
        poolHits,
        returns,
        discardedReturns,
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
  assertFunction('send', send);
  const message: FrameTransferReturn = {
    type: FRAME_RETURN_TYPE,
    protocolVersion: FRAME_TRANSFER_PROTOCOL_VERSION,
    transferId: publication.transferId,
    capacity: publication.capacity,
    buffer: publication.buffer,
  };
  send(message, [publication.buffer]);
  if (!publication.buffer.detached) {
    throw new TypeError('frame return sender returned without detaching its buffer');
  }
}

export function isFrameTransferPublication(value: unknown): value is FrameTransferPublication {
  if (!isNonArrayObject(value) || value.type !== FRAME_PUBLICATION_TYPE || value.protocolVersion !== 0) return false;
  return (
    positiveU32(value.transferId) &&
    positiveU32(value.plannerId) &&
    nonnegativeU32(value.planRevision) &&
    positiveU32(value.byteLength) &&
    positiveU32(value.capacity) &&
    value.byteLength === value.capacity &&
    value.buffer instanceof ArrayBuffer &&
    !value.buffer.detached &&
    value.buffer.byteLength === value.byteLength
  );
}

export function isFrameTransferReturn(value: unknown): value is FrameTransferReturn {
  if (!isNonArrayObject(value) || value.type !== FRAME_RETURN_TYPE || value.protocolVersion !== 0) return false;
  return (
    positiveU32(value.transferId) &&
    nonnegativeU32(value.capacity) &&
    value.buffer instanceof ArrayBuffer &&
    !value.buffer.detached
  );
}

function validateLimits(value: unknown): FrameTransferPoolLimits {
  if (!isNonArrayObject(value)) throw new TypeError('frame transfer pool limits must be an object');
  assertPositiveU32('maximumBufferBytes', value.maximumBufferBytes);
  assertPositiveU32('maximumOutstandingTransfers', value.maximumOutstandingTransfers);
  assertPositiveU32('maximumOutstandingBytes', value.maximumOutstandingBytes);
  assertU32('maximumPooledBuffers', value.maximumPooledBuffers);
  assertU32('maximumPooledBytes', value.maximumPooledBytes);
  if (value.maximumBufferBytes > value.maximumOutstandingBytes) {
    throw new RangeError('maximumBufferBytes cannot exceed maximumOutstandingBytes');
  }
  return {
    maximumBufferBytes: value.maximumBufferBytes,
    maximumOutstandingTransfers: value.maximumOutstandingTransfers,
    maximumOutstandingBytes: value.maximumOutstandingBytes,
    maximumPooledBuffers: value.maximumPooledBuffers,
    maximumPooledBytes: value.maximumPooledBytes,
  };
}

function assertTransferBytes(value: unknown): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array)) throw new TypeError('bytes must be an attached Uint8Array');
  if (value.buffer instanceof ArrayBuffer && value.buffer.detached) {
    throw new TypeError('bytes must be an attached Uint8Array');
  }
  if (value.byteLength === 0) throw new RangeError('bytes must not be empty');
}

function assertPublicationMetadata(
  value: unknown,
): asserts value is Readonly<{ plannerId: number; planRevision: number }> {
  if (!isNonArrayObject(value)) throw new TypeError('publication metadata must be an object');
  if (!positiveU32(value.plannerId)) throw new RangeError('plannerId must be a positive u32');
  if (!nonnegativeU32(value.planRevision)) throw new RangeError('planRevision must be a u32');
}

function exactLengthIndex(buffers: readonly ArrayBuffer[], byteLength: number): number {
  return buffers.findIndex((buffer) => buffer.byteLength === byteLength);
}

function retainWorkerBuffer(
  buffers: ArrayBuffer[],
  pooledBytes: number,
  buffer: ArrayBuffer,
  limits: FrameTransferPoolLimits,
  stats: MutableStats,
  countDiscardedReturns: boolean,
): Readonly<{ pooledBytes: number; retained: boolean }> {
  if (
    !countDiscardedReturns &&
    (buffers.length >= limits.maximumPooledBuffers || pooledBytes + buffer.byteLength > limits.maximumPooledBytes)
  ) {
    return { pooledBytes, retained: false };
  }
  buffers.push(buffer);
  pooledBytes += buffer.byteLength;
  while (buffers.length > limits.maximumPooledBuffers || pooledBytes > limits.maximumPooledBytes) {
    const discarded = buffers.shift();
    if (discarded === undefined) throw new TypeError('frame transfer pool byte accounting is inconsistent');
    pooledBytes -= discarded.byteLength;
    if (countDiscardedReturns) stats.discardedReturns += 1;
  }
  return { pooledBytes, retained: buffers.includes(buffer) };
}

function nextAvailableTransferId(start: number, outstanding: ReadonlyMap<number, number>): number {
  let candidate = start;
  do {
    if (!outstanding.has(candidate)) return candidate;
    candidate = candidate === 0xffff_ffff ? 1 : candidate + 1;
  } while (candidate !== start);
  throw new RangeError('frame transfer identifiers are exhausted');
}

function isNonArrayObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function positiveU32(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0 && Number(value) <= 0xffff_ffff;
}

function nonnegativeU32(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 0xffff_ffff;
}

function assertFunction(name: string, value: unknown): asserts value is (...arguments_: never[]) => unknown {
  if (typeof value !== 'function') throw new TypeError(`${name} must be a function`);
}

function assertPositiveU32(name: string, value: unknown): asserts value is number {
  if (!positiveU32(value)) throw new RangeError(`${name} must be a positive u32`);
}

function assertU32(name: string, value: unknown): asserts value is number {
  if (!nonnegativeU32(value)) throw new RangeError(`${name} must be a u32`);
}
