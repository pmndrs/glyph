import { textShaperAbi } from '../generated/text-shaper-abi.js';
import { runtimeShaperEngineExports, type RuntimeShaper } from '../shaper.js';
import { RenderWireIdentityRegistry } from './render-policy.js';

const MAX_U32 = 0xffff_ffff;

export interface TextEngineSessionOptions {
  readonly handle: number;
  readonly requestCapacity: number;
  readonly resultCapacity: number;
  readonly textCapacity?: number;
}

/**
 * One borrowed A/B render-plan publication. Its bytes remain readable until the next call into the same Wasm module;
 * synchronous renderers must consume them before updating, reserving, disposing, or otherwise calling the shaper.
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

export class TextEngineStatusError extends Error {
  readonly status: number;
  readonly requiredRequestCapacity: number;
  readonly requiredResultCapacity: number;

  constructor(operation: string, status: number, requiredRequestCapacity = 0, requiredResultCapacity = 0) {
    super(
      `${operation} failed with text-engine status ${status}` +
        (requiredRequestCapacity === 0 && requiredResultCapacity === 0
          ? ''
          : ` (required request=${requiredRequestCapacity}, result=${requiredResultCapacity})`),
    );
    this.name = 'TextEngineStatusError';
    this.status = status;
    this.requiredRequestCapacity = requiredRequestCapacity;
    this.requiredResultCapacity = requiredResultCapacity;
  }
}

/** Internal lifecycle owner for retained policy, font-stack, and session state in a RuntimeShaper's Wasm instance. */
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

  reserve(requestCapacity: number, resultCapacity: number, textCapacity: number = this.#textCapacity): void {
    this.#assertActive();
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
        throw new TextEngineStatusError('publish text update', status, requiredRequestCapacity, requiredResultCapacity);
      }
      const byteLength = header.getUint32(layout.byteLength, true);
      if (byteLength < layout.size || resultPointer + byteLength > memoryBuffer.byteLength) {
        throw new RangeError('text engine returned an out-of-bounds publication');
      }
      this.#requestCapacity = header.getUint32(layout.requestCapacity, true);
      this.#resultCapacity = header.getUint32(layout.resultCapacity, true);
      return {
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
    }
  }

  dispose(): void {
    if (this.#disposed) return;
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
