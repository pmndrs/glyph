import { textShaperAbi } from '../generated/text-shaper-abi.js';
import { runtimeShaperEngineExports, type RuntimeShaper } from '../shaper.js';
import {
  retainedPublicationBrand,
  TextEnginePublicationExpiredError,
  type RetainedTextEnginePublication,
} from './retention.js';
import { RenderWireIdentityRegistry } from './render-policy.js';

const MAX_U32 = 0xffff_ffff;

export interface TextEngineSessionOptions {
  readonly handle: number;
  readonly requestCapacity: number;
  readonly resultCapacity: number;
  readonly textCapacity?: number;
}

/**
 * One borrowed A/B render-plan publication. Its bytes point into Wasm memory and expire when
 * this session answers any later call; see `core/retention.ts` for the protocol —
 * `assertLive` makes a stale borrow loud and `retain` copies what must survive.
 */
export interface TextEnginePublication {
  readonly bytes: Uint8Array;
  readonly memoryBuffer: ArrayBuffer;
  readonly memoryGrew: boolean;
  readonly engineRevision: number;
  readonly planRevision: number;
  readonly requiredBaseRevision: number;
  readonly publicationGeneration: number;
  readonly outputSlot: number;
  readonly flags: number;
  readonly policyHandle: number;
  readonly capabilitySet: number;
  readonly semanticViewCount: number;
  readonly primitiveCount: number;
  readonly patchCount: number;
  readonly drawCount: number;
}

/**
 * The paragraph and style a rejected frame names, read out of the result header.
 *
 * Both are the identifiers the REQUEST used, so a host maps them straight back to what it authored.
 * Zero means the status names none: an engine-internal invariant, a capacity watermark, or a
 * session-level conflict attributes nothing.
 */
export interface TextEngineFault {
  readonly paragraphId: number;
  readonly styleId: number;
}

const NO_FAULT: TextEngineFault = Object.freeze({ paragraphId: 0, styleId: 0 });

export class TextEngineStatusError extends Error {
  readonly status: number;
  readonly requiredRequestCapacity: number;
  readonly requiredResultCapacity: number;
  readonly fault: TextEngineFault;

  constructor(
    operation: string,
    status: number,
    requiredRequestCapacity = 0,
    requiredResultCapacity = 0,
    fault: TextEngineFault = NO_FAULT,
  ) {
    super(
      `${operation} failed with text-engine status ${status}` +
        (fault.paragraphId === 0 ? '' : ` (paragraph ${fault.paragraphId}`) +
        (fault.paragraphId === 0 ? '' : fault.styleId === 0 ? ')' : `, style ${fault.styleId})`) +
        (requiredRequestCapacity === 0 && requiredResultCapacity === 0
          ? ''
          : ` (required request=${requiredRequestCapacity}, result=${requiredResultCapacity})`),
    );
    this.name = 'TextEngineStatusError';
    this.status = status;
    this.requiredRequestCapacity = requiredRequestCapacity;
    this.requiredResultCapacity = requiredResultCapacity;
    this.fault = fault;
  }
}

function headerFault(header: DataView): TextEngineFault {
  const layout = textShaperAbi.layouts.engineResult;
  const paragraphId = header.getUint32(layout.faultParagraphId, true);
  const styleId = header.getUint32(layout.faultStyleId, true);
  return paragraphId === 0 && styleId === 0 ? NO_FAULT : Object.freeze({ paragraphId, styleId });
}

/** Lifecycle owner for retained policy, font-stack, and session state in a RuntimeShaper's Wasm instance. */
export class TextEngineHost {
  readonly wireIdentities: RenderWireIdentityRegistry = new RenderWireIdentityRegistry();
  readonly #exports;
  readonly #sessions = new Set<TextEngineSession>();
  readonly #policies = new Set<number>();
  readonly #fontStacks = new Set<number>();
  #disposed = false;

  constructor(shaper: RuntimeShaper) {
    this.#exports = runtimeShaperEngineExports(shaper);
  }

  registerFontBinding(bindingHandle: number, shapingFontHandle: number, bytes: Uint8Array): void {
    this.#assertActive();
    uint32Handle(bindingHandle, 'font binding handle');
    uint32Handle(shapingFontHandle, 'shaping font handle');
    this.#withBytes(bytes, (pointer, length) =>
      requireStatus(
        this.#exports.registerFontBinding(bindingHandle, shapingFontHandle, pointer, length),
        'register font binding',
      ),
    );
  }

  registerFontStack(handle: number, fontHandles: readonly number[]): void {
    this.#assertActive();
    uint32Handle(handle, 'font stack handle');
    if (fontHandles.length === 0) throw new RangeError('font stack must contain at least one font');
    const bytes = new Uint8Array(checkedProduct(fontHandles.length, 4, 'font stack bytes'));
    const view = new DataView(bytes.buffer);
    for (const [index, fontHandle] of fontHandles.entries()) {
      view.setUint32(index * 4, uint32Handle(fontHandle, 'font handle'), true);
    }
    this.#withBytes(bytes, (pointer) =>
      requireStatus(this.#exports.registerFontStack(handle, pointer, fontHandles.length), 'register font stack'),
    );
    this.#fontStacks.add(handle);
  }

  disposeFontStack(handle: number): void {
    this.#assertActive();
    uint32Handle(handle, 'font stack handle');
    if (!this.#fontStacks.has(handle)) throw new Error(`font stack ${handle} is not owned by this text engine host`);
    requireStatus(this.#exports.disposeFontStack(handle), 'dispose font stack');
    this.#fontStacks.delete(handle);
  }

  registerPolicy(handle: number, bytes: Uint8Array): void {
    this.#assertActive();
    uint32Handle(handle, 'policy handle');
    this.#withBytes(bytes, (pointer, length) =>
      requireStatus(this.#exports.registerPolicy(handle, pointer, length), 'register render policy'),
    );
    this.#policies.add(handle);
  }

  createSession(options: TextEngineSessionOptions): TextEngineSession {
    this.#assertActive();
    const handle = uint32Handle(options.handle, 'session handle');
    const requestCapacity = uint32(options.requestCapacity, 'request capacity');
    const resultCapacity = uint32(options.resultCapacity, 'result capacity');
    const textCapacity = uint32(options.textCapacity ?? 0, 'text capacity');
    requireStatus(
      this.#exports.createSession(handle, requestCapacity, resultCapacity, textCapacity),
      'create text session',
    );
    const session = new TextEngineSession(this.#exports, handle, requestCapacity, resultCapacity, textCapacity, () =>
      this.#sessions.delete(session),
    );
    this.#sessions.add(session);
    return session;
  }

  dispose(): void {
    if (this.#disposed) return;
    for (const session of [...this.#sessions]) session.dispose();
    for (const handle of this.#fontStacks) requireStatus(this.#exports.disposeFontStack(handle), 'dispose font stack');
    for (const handle of this.#policies) requireStatus(this.#exports.disposePolicy(handle), 'dispose render policy');
    this.#fontStacks.clear();
    this.#policies.clear();
    this.#disposed = true;
  }

  #withBytes(bytes: Uint8Array, call: (pointer: number, length: number) => void): void {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
      throw new TypeError('text-engine registration bytes must be a nonempty Uint8Array');
    }
    const length = uint32(bytes.byteLength, 'registration byte length');
    const pointer = this.#exports.allocate(length);
    if (pointer === 0)
      throw new TextEngineStatusError('allocate registration bytes', textShaperAbi.status.resultTooLarge);
    try {
      new Uint8Array(this.#exports.memory.buffer, pointer, length).set(bytes);
      call(pointer, length);
    } finally {
      this.#exports.deallocate(pointer, length);
    }
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('text engine host is disposed');
  }
}

export class TextEngineSession {
  readonly #exports;
  readonly #handle: number;
  readonly #onDispose: () => void;
  #requestCapacity: number;
  #resultCapacity: number;
  #textCapacity: number;
  #disposed = false;
  /** Bumped before every call that can answer with new bytes; borrows from older epochs are dead. */
  #epoch = 0;
  /** The epoch each issued borrow was published under, keyed by publication identity. */
  readonly #issued = new WeakMap<TextEnginePublication, number>();
  #acknowledgedGeneration = 0;
  #latestGeneration = 0;

  /** @internal Sessions are created through {@link TextEngineHost.createSession}. */
  constructor(
    exports: ReturnType<typeof runtimeShaperEngineExports>,
    handle: number,
    requestCapacity: number,
    resultCapacity: number,
    textCapacity: number,
    onDispose: () => void,
  ) {
    this.#exports = exports;
    this.#handle = handle;
    this.#requestCapacity = requestCapacity;
    this.#resultCapacity = resultCapacity;
    this.#textCapacity = textCapacity;
    this.#onDispose = onDispose;
  }

  get handle(): number {
    return this.#handle;
  }

  /** The newest publication generation this host has acknowledged consuming. */
  get acknowledgedGeneration(): number {
    return this.#acknowledgedGeneration;
  }

  /**
   * Whether a borrowed publication's bytes are gone. Two integer compares: the borrow
   * expires when the session answers any later call (including failed attempts that
   * reserve capacity), when Wasm memory has grown past its buffer, or on disposal.
   */
  isExpired(publication: TextEnginePublication): boolean {
    if (this.#issued.get(publication) === undefined) {
      throw new TypeError('publication was not issued by this text engine session');
    }
    return (
      this.#disposed ||
      this.#issued.get(publication) !== this.#epoch ||
      publication.memoryBuffer !== this.#exports.memory.buffer
    );
  }

  /**
   * Throws {@link TextEnginePublicationExpiredError} instead of letting a stale borrow
   * feed freed bytes to the host. Call it before decoding anything held across calls.
   */
  assertLive(publication: TextEnginePublication): void {
    if (this.isExpired(publication)) {
      throw new TextEnginePublicationExpiredError(publication.publicationGeneration, this.#latestGeneration);
    }
  }

  /**
   * Takes ownership with one contiguous copy of the whole encoded result — header,
   * every plan table, and every patch payload — and acknowledges consumption, since
   * taking the copy is taking what you need. Never expires; safe to hold across frames.
   */
  retain(publication: TextEnginePublication): RetainedTextEnginePublication {
    this.assertLive(publication);
    const bytes = publication.bytes.slice();
    this.#acknowledge(publication.publicationGeneration);
    return Object.freeze({
      ...publication,
      bytes,
      memoryBuffer: bytes.buffer,
      memoryGrew: false,
      [retainedPublicationBrand]: true,
    }) as RetainedTextEnginePublication;
  }

  /**
   * Records that a borrowed publication has been consumed in place. The engine holds
   * resource retirements until the acknowledged generation passes, so skipping this
   * keeps retired GPU memory alive; going backwards at the wire is a revision conflict.
   */
  acknowledge(publication: TextEnginePublication): void {
    this.assertLive(publication);
    this.#acknowledge(publication.publicationGeneration);
  }

  #acknowledge(generation: number): void {
    this.#acknowledgedGeneration = Math.max(this.#acknowledgedGeneration, generation);
  }

  #invalidate(): void {
    this.#epoch += 1;
  }

  reserve(requestCapacity: number, resultCapacity: number, textCapacity: number = this.#textCapacity): void {
    this.#assertActive();
    this.#invalidate();
    requestCapacity = uint32(requestCapacity, 'request capacity');
    resultCapacity = uint32(resultCapacity, 'result capacity');
    textCapacity = uint32(textCapacity, 'text capacity');
    requireStatus(
      this.#exports.reserveSession(this.#handle, requestCapacity, resultCapacity, textCapacity),
      'reserve text session',
    );
    this.#requestCapacity = Math.max(this.#requestCapacity, requestCapacity);
    this.#resultCapacity = Math.max(this.#resultCapacity, resultCapacity);
    this.#textCapacity = Math.max(this.#textCapacity, textCapacity);
  }

  update(request: Uint8Array): TextEnginePublication {
    this.#assertActive();
    this.#invalidate();
    if (!(request instanceof Uint8Array) || request.byteLength === 0) {
      throw new TypeError('text update request must be a nonempty Uint8Array');
    }
    const requestLength = uint32(request.byteLength, 'text update byte length');
    const initialMemoryBuffer = this.#exports.memory.buffer;
    if (requestLength > this.#requestCapacity || requestLength > this.#exports.requestCapacity(this.#handle)) {
      this.reserve(requestLength, this.#resultCapacity);
    }
    let retriedResultGrowth = false;
    for (;;) {
      const requestPointer = this.#exports.requestPointer(this.#handle);
      if (requestPointer === 0)
        throw new TextEngineStatusError('resolve text request arena', textShaperAbi.status.sessionMissing);
      const pinnedMemoryBuffer = this.#exports.memory.buffer;
      new Uint8Array(pinnedMemoryBuffer, requestPointer, requestLength).set(request);
      const resultPointer = this.#exports.textUpdate(this.#handle, requestPointer, requestLength);
      const memoryBuffer = this.#exports.memory.buffer;
      if (resultPointer === 0)
        throw new TextEngineStatusError('publish text update', textShaperAbi.status.resultTooLarge);
      const layout = textShaperAbi.layouts.engineResult;
      if (resultPointer + layout.size > memoryBuffer.byteLength) {
        throw new RangeError('text engine returned an out-of-bounds result header');
      }
      const header = new DataView(memoryBuffer, resultPointer, layout.size);
      const status = header.getUint32(layout.status, true);
      const requiredRequestCapacity = header.getUint32(layout.requiredRequestCapacity, true);
      const requiredResultCapacity = header.getUint32(layout.requiredResultCapacity, true);
      if (
        status === textShaperAbi.status.resultTooLarge &&
        !retriedResultGrowth &&
        requiredResultCapacity > this.#resultCapacity
      ) {
        retriedResultGrowth = true;
        this.reserve(Math.max(requestLength, requiredRequestCapacity), requiredResultCapacity);
        continue;
      }
      if (status !== textShaperAbi.status.ok) {
        throw new TextEngineStatusError(
          'publish text update',
          status,
          requiredRequestCapacity,
          requiredResultCapacity,
          headerFault(header),
        );
      }
      return this.#decodeResult(header, resultPointer, memoryBuffer, initialMemoryBuffer);
    }
  }

  /**
   * Answers one paragraph-scoped synchronous measurement without publishing. The
   * result rides the inactive output slot under a host lease: its bytes stay readable
   * only until the next call into the same Wasm module. Engine revisions, the
   * publication generation, and the renderer fence are untouched, so the following
   * ordinary frame proceeds from pre-measure state.
   */
  measureParagraph(request: Uint8Array, paragraphId: number): TextEnginePublication {
    this.#assertActive();
    this.#invalidate();
    if (!(request instanceof Uint8Array) || request.byteLength === 0) {
      throw new TypeError('paragraph measure request must be a nonempty Uint8Array');
    }
    uint32Handle(paragraphId, 'paragraph id');
    const requestLength = uint32(request.byteLength, 'paragraph measure byte length');
    const initialMemoryBuffer = this.#exports.memory.buffer;
    if (requestLength > this.#requestCapacity || requestLength > this.#exports.requestCapacity(this.#handle)) {
      this.reserve(requestLength, this.#resultCapacity);
    }
    let retriedResultGrowth = false;
    for (;;) {
      const requestPointer = this.#exports.requestPointer(this.#handle);
      if (requestPointer === 0)
        throw new TextEngineStatusError('resolve text request arena', textShaperAbi.status.sessionMissing);
      new Uint8Array(this.#exports.memory.buffer, requestPointer, requestLength).set(request);
      const resultPointer = this.#exports.measureParagraph(this.#handle, requestPointer, requestLength, paragraphId);
      const memoryBuffer = this.#exports.memory.buffer;
      if (resultPointer === 0)
        throw new TextEngineStatusError('measure paragraph', textShaperAbi.status.resultTooLarge);
      const layout = textShaperAbi.layouts.engineResult;
      if (resultPointer + layout.size > memoryBuffer.byteLength) {
        throw new RangeError('text engine returned an out-of-bounds result header');
      }
      const header = new DataView(memoryBuffer, resultPointer, layout.size);
      const status = header.getUint32(layout.status, true);
      const requiredResultCapacity = header.getUint32(layout.requiredResultCapacity, true);
      if (
        status === textShaperAbi.status.resultTooLarge &&
        !retriedResultGrowth &&
        requiredResultCapacity > this.#resultCapacity
      ) {
        retriedResultGrowth = true;
        this.reserve(requestLength, requiredResultCapacity);
        continue;
      }
      if (status !== textShaperAbi.status.ok) {
        throw new TextEngineStatusError(
          'measure paragraph',
          status,
          header.getUint32(layout.requiredRequestCapacity, true),
          requiredResultCapacity,
          headerFault(header),
        );
      }
      return this.#decodeResult(header, resultPointer, memoryBuffer, initialMemoryBuffer);
    }
  }

  #decodeResult(
    header: DataView,
    resultPointer: number,
    memoryBuffer: ArrayBuffer,
    initialMemoryBuffer: ArrayBuffer,
  ): TextEnginePublication {
    const layout = textShaperAbi.layouts.engineResult;
    const byteLength = header.getUint32(layout.byteLength, true);
    if (byteLength < layout.size || resultPointer + byteLength > memoryBuffer.byteLength) {
      throw new RangeError('text engine returned an out-of-bounds publication');
    }
    this.#requestCapacity = header.getUint32(layout.requestCapacity, true);
    this.#resultCapacity = header.getUint32(layout.resultCapacity, true);
    const publication: TextEnginePublication = {
      bytes: new Uint8Array(memoryBuffer, resultPointer, byteLength),
      memoryBuffer,
      memoryGrew: memoryBuffer !== initialMemoryBuffer,
      engineRevision: header.getUint32(layout.engineRevision, true),
      planRevision: header.getUint32(layout.planRevision, true),
      requiredBaseRevision: header.getUint32(layout.requiredBaseRevision, true),
      publicationGeneration: header.getUint32(layout.publicationGeneration, true),
      outputSlot: header.getUint32(layout.outputSlot, true),
      flags: header.getUint32(layout.flags, true),
      policyHandle: header.getUint32(layout.policyHandle, true),
      capabilitySet: header.getUint32(layout.capabilitySet, true),
      semanticViewCount: header.getUint32(layout.semanticViewCount, true),
      primitiveCount: header.getUint32(layout.primitiveCount, true),
      patchCount: header.getUint32(layout.patchCount, true),
      drawCount: header.getUint32(layout.drawCount, true),
    };
    this.#issued.set(publication, this.#epoch);
    this.#latestGeneration = Math.max(this.#latestGeneration, publication.publicationGeneration);
    return publication;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#invalidate();
    requireStatus(this.#exports.disposeSession(this.#handle), 'dispose text session');
    this.#disposed = true;
    this.#onDispose();
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('text engine session is disposed');
  }
}

function requireStatus(status: number, operation: string): void {
  if (status !== textShaperAbi.status.ok) throw new TextEngineStatusError(operation, status);
}

function uint32(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_U32) throw new RangeError(`${label} must be a u32`);
  return value;
}

function uint32Handle(value: number, label: string): number {
  value = uint32(value, label);
  if (value === 0) throw new RangeError(`${label} must be nonzero`);
  return value;
}

function checkedProduct(left: number, right: number, label: string): number {
  const value = left * right;
  if (!Number.isSafeInteger(value) || value > MAX_U32) throw new RangeError(`${label} exceeds u32`);
  return value;
}
