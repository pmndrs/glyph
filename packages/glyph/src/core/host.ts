import { textShaperAbi } from '../generated/text-shaper-abi.js';
import type { FontHandle } from '../identity.js';
import { runtimeShaperEngineExports, type RuntimeShaper } from '../shaper.js';
import {
  markOwnedTextEnginePublication,
  TextEnginePublicationExpiredError,
  type OwnedTextEnginePublication,
} from './retention.js';
import {
  assertGlyphId,
  GlyphIdScope,
  RenderWireIdentityRegistry,
  type FontBindingHandle,
  type FontStackHandle,
  type GlyphId,
  type GlyphIdKind,
  type ParagraphId,
  type PolicyHandle,
  type StyleId,
  type TextEngineSessionHandle,
} from './render-policy.js';

const MAX_U32 = 0xffff_ffff;

export interface TextEngineSessionOptions {
  readonly handle: TextEngineSessionHandle;
  readonly requestCapacity: number;
  readonly resultCapacity: number;
  readonly textCapacity?: number;
}

/**
 * One borrowed A/B render-plan publication. Its bytes point into Wasm memory and expire when
 * this session answers any later call; see `core/retention.ts` for the protocol.
 * `copyPublication` validates and owns bytes that must survive the borrow.
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
  readonly policyHandle: PolicyHandle | 0;
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
  readonly paragraphId: ParagraphId | 0;
  readonly styleId: StyleId | 0;
}

const NO_FAULT: TextEngineFault = Object.freeze({ paragraphId: 0, styleId: 0 });

interface EngineRegistrationOwners {
  readonly policies: Map<number, TextEngineHost>;
  readonly fontBindings: Map<number, TextEngineHost>;
  readonly fontStacks: Map<number, TextEngineHost>;
  readonly sessions: Map<number, TextEngineHost>;
}

const registrationOwners = new WeakMap<object, EngineRegistrationOwners>();

function ownersFor(exports: object): EngineRegistrationOwners {
  let owners = registrationOwners.get(exports);
  if (owners === undefined) {
    owners = {
      policies: new Map(),
      fontBindings: new Map(),
      fontStacks: new Map(),
      sessions: new Map(),
    };
    registrationOwners.set(exports, owners);
  }
  return owners;
}

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
  return paragraphId === 0 && styleId === 0
    ? NO_FAULT
    : Object.freeze({ paragraphId: paragraphId as ParagraphId | 0, styleId: styleId as StyleId | 0 });
}

/** Lifecycle owner for retained policies, font bindings, font stacks, and sessions in one RuntimeShaper. */
export class TextEngineHost {
  readonly wireIdentities: RenderWireIdentityRegistry = new RenderWireIdentityRegistry();
  readonly #ids = new GlyphIdScope();
  readonly #exports;
  readonly #owners: EngineRegistrationOwners;
  readonly #sessions = new Set<TextEngineSession>();
  readonly #policies = new Set<PolicyHandle>();
  readonly #fontStacks = new Map<FontStackHandle, readonly FontBindingHandle[]>();
  readonly #fontBindings = new Set<FontBindingHandle>();
  #disposed = false;

  constructor(shaper: RuntimeShaper) {
    this.#exports = runtimeShaperEngineExports(shaper);
    this.#owners = ownersFor(this.#exports);
  }

  /** Derive one branded ID whose provenance lives exactly as long as this host. */
  readonly id = <const Kind extends GlyphIdKind>(kind: Kind, name: string): GlyphId<Kind> => {
    this.#assertActive();
    return this.#ids.id(kind, name);
  };

  registerFontBinding(bindingHandle: FontBindingHandle, shapingFontHandle: FontHandle, bytes: Uint8Array): void {
    this.#assertActive();
    bindingHandle = assertGlyphId(bindingHandle, 'font-binding', 'font binding handle');
    uint32Handle(shapingFontHandle, 'shaping font handle');
    const adopted = this.#ids.retain(bindingHandle, 'font-binding', 'font binding handle');
    let claimed = false;
    try {
      claimed = this.#claim(this.#owners.fontBindings, bindingHandle, 'font binding');
      this.#withBytes(bytes, (pointer, length) =>
        requireStatus(
          this.#exports.registerFontBinding(bindingHandle, shapingFontHandle, pointer, length),
          'register font binding',
        ),
      );
      this.#fontBindings.add(bindingHandle);
    } catch (error) {
      this.#rollbackClaim(this.#owners.fontBindings, bindingHandle, claimed);
      if (adopted) this.#ids.release(bindingHandle, 'font-binding');
      throw error;
    }
  }

  disposeFontBinding(bindingHandle: FontBindingHandle): void {
    this.#assertActive();
    assertGlyphId(bindingHandle, 'font-binding', 'font binding handle');
    if (!this.#fontBindings.has(bindingHandle)) {
      throw new Error(`font binding ${bindingHandle} is not owned by this text engine host`);
    }
    for (const [stackHandle, fontHandles] of this.#fontStacks) {
      if (fontHandles.includes(bindingHandle)) {
        throw new Error(`font binding ${bindingHandle} is still used by font stack ${stackHandle}`);
      }
    }
    requireStatus(this.#exports.disposeFontBinding(bindingHandle), 'dispose font binding');
    this.#fontBindings.delete(bindingHandle);
    this.#releaseClaim(this.#owners.fontBindings, bindingHandle);
    this.#ids.release(bindingHandle, 'font-binding');
  }

  registerFontStack(handle: FontStackHandle, fontHandles: readonly FontBindingHandle[]): void {
    this.#assertActive();
    handle = assertGlyphId(handle, 'font-stack', 'font stack handle');
    if (fontHandles.length === 0) throw new RangeError('font stack must contain at least one font');
    const bytes = new Uint8Array(checkedProduct(fontHandles.length, 4, 'font stack bytes'));
    const view = new DataView(bytes.buffer);
    for (const [index, fontHandle] of fontHandles.entries()) {
      const checkedHandle = assertGlyphId(fontHandle, 'font-binding', 'font binding handle');
      if (!this.#fontBindings.has(checkedHandle)) {
        throw new Error(`font binding ${checkedHandle} is not owned by this text engine host`);
      }
      view.setUint32(index * 4, checkedHandle, true);
    }
    const adopted = this.#ids.retain(handle, 'font-stack', 'font stack handle');
    let claimed = false;
    try {
      claimed = this.#claim(this.#owners.fontStacks, handle, 'font stack');
      this.#withBytes(bytes, (pointer) =>
        requireStatus(this.#exports.registerFontStack(handle, pointer, fontHandles.length), 'register font stack'),
      );
      this.#fontStacks.set(handle, Object.freeze([...fontHandles]));
    } catch (error) {
      this.#rollbackClaim(this.#owners.fontStacks, handle, claimed);
      if (adopted) this.#ids.release(handle, 'font-stack');
      throw error;
    }
  }

  disposeFontStack(handle: FontStackHandle): void {
    this.#assertActive();
    assertGlyphId(handle, 'font-stack', 'font stack handle');
    if (!this.#fontStacks.has(handle)) throw new Error(`font stack ${handle} is not owned by this text engine host`);
    requireStatus(this.#exports.disposeFontStack(handle), 'dispose font stack');
    this.#fontStacks.delete(handle);
    this.#releaseClaim(this.#owners.fontStacks, handle);
    this.#ids.release(handle, 'font-stack');
  }

  registerPolicy(handle: PolicyHandle, bytes: Uint8Array): void {
    this.#assertActive();
    handle = assertGlyphId(handle, 'policy', 'policy handle');
    const adopted = this.#ids.retain(handle, 'policy', 'policy handle');
    let claimed = false;
    try {
      claimed = this.#claim(this.#owners.policies, handle, 'render policy');
      this.#withBytes(bytes, (pointer, length) =>
        requireStatus(this.#exports.registerPolicy(handle, pointer, length), 'register render policy'),
      );
      this.#policies.add(handle);
    } catch (error) {
      this.#rollbackClaim(this.#owners.policies, handle, claimed);
      if (adopted) this.#ids.release(handle, 'policy');
      throw error;
    }
  }

  disposePolicy(handle: PolicyHandle): void {
    this.#assertActive();
    handle = assertGlyphId(handle, 'policy', 'policy handle');
    if (!this.#policies.has(handle)) throw new Error(`render policy ${handle} is not owned by this text engine host`);
    requireStatus(this.#exports.disposePolicy(handle), 'dispose render policy');
    this.#policies.delete(handle);
    this.#releaseClaim(this.#owners.policies, handle);
    this.#ids.release(handle, 'policy');
  }

  createSession(options: TextEngineSessionOptions): TextEngineSession {
    this.#assertActive();
    const handle = assertGlyphId(options.handle, 'session', 'session handle');
    const requestCapacity = uint32(options.requestCapacity, 'request capacity');
    const resultCapacity = uint32(options.resultCapacity, 'result capacity');
    const textCapacity = uint32(options.textCapacity ?? 0, 'text capacity');
    const adopted = this.#ids.retain(handle, 'session', 'session handle');
    let claimed = false;
    try {
      claimed = this.#claim(this.#owners.sessions, handle, 'text session');
      requireStatus(
        this.#exports.createSession(handle, requestCapacity, resultCapacity, textCapacity),
        'create text session',
      );
      const session = new TextEngineSession(
        this.#exports,
        handle,
        requestCapacity,
        resultCapacity,
        textCapacity,
        (request) => this.#assertFrameOwnership(handle, request),
        () => {
          this.#sessions.delete(session);
          this.#releaseClaim(this.#owners.sessions, handle);
          this.#ids.release(handle, 'session');
        },
      );
      this.#sessions.add(session);
      return session;
    } catch (error) {
      this.#rollbackClaim(this.#owners.sessions, handle, claimed);
      if (adopted) this.#ids.release(handle, 'session');
      throw error;
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    let failure: unknown;
    const attempt = (dispose: () => void): void => {
      try {
        dispose();
      } catch (error) {
        failure ??= error;
      }
    };
    for (const session of [...this.#sessions]) attempt(() => session.dispose());
    for (const handle of [...this.#fontStacks.keys()]) attempt(() => this.disposeFontStack(handle));
    for (const handle of [...this.#fontBindings]) attempt(() => this.disposeFontBinding(handle));
    for (const handle of [...this.#policies]) attempt(() => this.disposePolicy(handle));
    if (
      this.#sessions.size !== 0 ||
      this.#fontStacks.size !== 0 ||
      this.#fontBindings.size !== 0 ||
      this.#policies.size !== 0
    ) {
      failure ??= new Error('text engine host disposal left live registrations');
    } else {
      try {
        this.#ids.dispose();
      } catch (error) {
        failure ??= error;
      } finally {
        this.#disposed = true;
      }
    }
    if (failure !== undefined) throw failure;
  }

  #assertFrameOwnership(sessionHandle: TextEngineSessionHandle, request: Uint8Array): void {
    const references = frameRegistrationReferences(request);
    if (references.sessionHandle !== sessionHandle) {
      throw new TypeError(`text update belongs to session ${references.sessionHandle}, not ${sessionHandle}`);
    }
    if (this.#owners.policies.get(references.policyHandle) !== this) {
      throw new TypeError(`render policy ${references.policyHandle} is not owned by this text engine host`);
    }
    for (const handle of references.fontStackHandles) {
      if (this.#owners.fontStacks.get(handle) !== this) {
        throw new TypeError(`font stack ${handle} is not owned by this text engine host`);
      }
    }
  }

  #claim(owners: Map<number, TextEngineHost>, handle: number, label: string): boolean {
    const owner = owners.get(handle);
    if (owner === this) return false;
    if (owner !== undefined) throw new Error(`${label} ${handle} is already owned by another text engine host`);
    owners.set(handle, this);
    return true;
  }

  #rollbackClaim(owners: Map<number, TextEngineHost>, handle: number, claimed: boolean): void {
    if (claimed && owners.get(handle) === this) owners.delete(handle);
  }

  #releaseClaim(owners: Map<number, TextEngineHost>, handle: number): void {
    if (owners.get(handle) !== this) throw new Error(`text engine host lost registration ${handle}`);
    owners.delete(handle);
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
  readonly #handle: TextEngineSessionHandle;
  readonly #onDispose: () => void;
  readonly #assertRequestOwnership: (request: Uint8Array) => void;
  #requestCapacity: number;
  #resultCapacity: number;
  #textCapacity: number;
  #disposed = false;
  /** Bumped before every call that can answer with new bytes; borrows from older epochs are dead. */
  #epoch = 0;
  /** The epoch each issued borrow was published under, keyed by publication identity. */
  readonly #issued = new WeakMap<TextEnginePublication, number>();
  #latestGeneration = 0;

  /** @internal Sessions are created through {@link TextEngineHost.createSession}. */
  constructor(
    exports: ReturnType<typeof runtimeShaperEngineExports>,
    handle: TextEngineSessionHandle,
    requestCapacity: number,
    resultCapacity: number,
    textCapacity: number,
    assertRequestOwnership: (request: Uint8Array) => void,
    onDispose: () => void,
  ) {
    this.#exports = exports;
    this.#handle = handle;
    this.#requestCapacity = requestCapacity;
    this.#resultCapacity = resultCapacity;
    this.#textCapacity = textCapacity;
    this.#assertRequestOwnership = assertRequestOwnership;
    this.#onDispose = onDispose;
  }

  get handle(): TextEngineSessionHandle {
    return this.#handle;
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
   * Takes ownership with one contiguous copy of the whole encoded result — header,
   * every plan table, and every patch payload. Never expires; safe to hold across
   * asynchronous work, later engine calls, and worker transfers.
   */
  copyPublication(publication: TextEnginePublication): OwnedTextEnginePublication {
    this.#assertPublicationCurrent(publication);
    const bytes = publication.bytes.slice();
    return markOwnedTextEnginePublication(
      Object.freeze({
        ...publication,
        bytes,
        memoryBuffer: bytes.buffer,
        memoryGrew: false,
      }),
    );
  }

  #assertPublicationCurrent(publication: TextEnginePublication): void {
    if (this.isExpired(publication)) {
      throw new TextEnginePublicationExpiredError(publication.publicationGeneration, this.#latestGeneration);
    }
  }

  #invalidate(): void {
    this.#epoch += 1;
  }

  reserve(requestCapacity: number, resultCapacity: number, textCapacity: number = this.#textCapacity): void {
    this.#assertActive();
    requestCapacity = uint32(requestCapacity, 'request capacity');
    resultCapacity = uint32(resultCapacity, 'result capacity');
    textCapacity = uint32(textCapacity, 'text capacity');
    this.#invalidate();
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
    this.#assertRequestOwnership(request);
    this.#invalidate();
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
  measureParagraph(request: Uint8Array, paragraphId: ParagraphId): TextEnginePublication {
    this.#assertActive();
    if (!(request instanceof Uint8Array) || request.byteLength === 0) {
      throw new TypeError('paragraph measure request must be a nonempty Uint8Array');
    }
    this.#assertRequestOwnership(request);
    assertGlyphId(paragraphId, 'paragraph', 'paragraph id');
    this.#invalidate();
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
      policyHandle: uint32(header.getUint32(layout.policyHandle, true), 'result policy handle') as PolicyHandle | 0,
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
    requireStatus(this.#exports.disposeSession(this.#handle), 'dispose text session');
    this.#invalidate();
    this.#disposed = true;
    this.#onDispose();
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('text engine session is disposed');
  }
}

interface FrameRegistrationReferences {
  readonly sessionHandle: number;
  readonly policyHandle: number;
  readonly fontStackHandles: ReadonlySet<number>;
}

function frameRegistrationReferences(bytes: Uint8Array): FrameRegistrationReferences {
  const request = textShaperAbi.layouts.engineUpdateRequest;
  if (bytes.byteLength < request.size) throw new RangeError('text update request is smaller than its header');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(request.abiVersion, true) !== textShaperAbi.version) {
    throw new TypeError('text update request ABI version is unsupported');
  }
  if (view.getUint32(request.byteLength, true) !== bytes.byteLength) {
    throw new RangeError('text update request byte length contradicts its buffer');
  }
  const style = textShaperAbi.layouts.engineStyleMutation;
  const count = view.getUint32(request.styleMutationCount, true);
  const offset = view.getUint32(request.styleMutationsOffset, true);
  const end = checkedTableEnd(offset, count, style.size, bytes.byteLength, 'style mutation table');
  if (count !== 0 && (offset < request.size || offset % style.alignment !== 0 || end <= offset)) {
    throw new RangeError('text update style mutation table is invalid');
  }
  const fontStackHandles = new Set<number>();
  for (let index = 0; index < count; index += 1) {
    const record = offset + index * style.size;
    if (view.getUint8(record + style.opcode) !== textShaperAbi.engine.styleMutationOpcodes.upsert) continue;
    const fields = view.getUint32(record + style.fieldMask, true);
    if (fields & textShaperAbi.engine.styleFields.fontStack) {
      fontStackHandles.add(uint32Handle(view.getUint32(record + style.fontStackHandle, true), 'style font stack'));
    }
  }
  return {
    sessionHandle: uint32Handle(view.getUint32(request.sessionId, true), 'frame session handle'),
    policyHandle: uint32Handle(view.getUint32(request.policyHandle, true), 'frame policy handle'),
    fontStackHandles,
  };
}

function checkedTableEnd(offset: number, count: number, stride: number, capacity: number, label: string): number {
  if (count === 0) {
    if (offset !== 0) throw new RangeError(`${label} offset must be zero when empty`);
    return 0;
  }
  const byteLength = checkedProduct(count, stride, `${label} bytes`);
  const end = offset + byteLength;
  if (!Number.isSafeInteger(end) || end > capacity) throw new RangeError(`${label} exceeds the request`);
  return end;
}

function requireStatus(status: number, operation: string): void {
  if (status !== textShaperAbi.status.ok) throw new TextEngineStatusError(operation, status);
}

function uint32(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_U32) throw new RangeError(`${label} must be a u32`);
  return value;
}

function uint32Handle<const Value extends number>(value: Value, label: string): Value {
  const validated = uint32(value, label);
  if (validated === 0) throw new RangeError(`${label} must be nonzero`);
  return validated as Value;
}

function checkedProduct(left: number, right: number, label: string): number {
  const value = left * right;
  if (!Number.isSafeInteger(value) || value > MAX_U32) throw new RangeError(`${label} exceeds u32`);
  return value;
}
