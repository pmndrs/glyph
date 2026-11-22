import { DEV } from './internal/dev.js';

import type { Font, RegisteredFont } from './font.js';
import {
  acquireImmutableFontResources,
  immutableFontResources,
  immutableFontVariantIdentity,
  type ImmutableFontResourceLease,
} from './loaded-font.js';
import type { RasterDataOf, RasterFormatMetadata } from './config/raster-format.js';
import type { RasterKindOf, RegisteredRaster } from './raster.js';
import { createRuntimeShaper, runtimeShaperEngineExports, type RuntimeShaper } from './shaper.js';
import { GlyphEngineStatusError } from './engine-error.js';
import { GlyphHandleState, type GlyphHandleStateOptions } from './internal/handle-state.js';
import type { FontHandle } from './identity.js';
import type {
  PlanAcceptance,
  StagedPlannerPreparation,
  StagedPlannerRequest,
  StagedRenderPlanner,
} from './internal/render-planner.js';
import { textShaperAbi } from './generated/text-shaper-abi.js';

/** Options for constructing one independent Wasm shaping engine. */
export interface GlyphEngineOptions {
  readonly wasm?: BufferSource | WebAssembly.Module;
}

/** Owns one Wasm shaping domain and every configured handle attached to it. */
export interface GlyphEngine {
  readonly disposed: boolean;
  /** Disposes every owned handle state and releases this engine's Wasm shaping domain. */
  dispose(): void;
}

/** @internal One renderer-neutral root participating in the next engine-wide shape transaction. */
export interface GlyphShapeParticipant {
  /**
   * Reconciles the root and stages its dirty paragraphs for the batch preparation. `measureAll` asks for every
   * prepared paragraph's summary, which an explicit `glyph.prepare()` wants and a frame does not.
   */
  prepare(measureAll: boolean, holdObserved: boolean): StagedPlannerPreparation | undefined;
  /** Runs once this root's paragraphs are all prepared, before anything is staged for publication. */
  prepared(): void;
  /**
   * Runs the root's layout callbacks, after every root is prepared and before any is published. While any root's
   * callbacks run, a write to a layout input of any text throws.
   */
  layout?(): void;
  stage(): StagedRenderPlanner | undefined;
  accepted(): void;
  rejected(error: unknown): void;
}

/** @internal Stable invalidation and teardown channel for one registered shape participant. */
export interface GlyphShapeRegistration {
  readonly queued: boolean;
  invalidate(): void;
  dispose(): void;
}

interface EngineFontRegistration {
  readonly font: RegisteredFont;
  readonly resources: Set<{ dispose(): void }>;
  leases: number;
  disposed: boolean;
}

/** @internal An independent claim on one engine-local shaping registration. */
export interface EngineFontBindingLease<Format extends RasterFormatMetadata> {
  readonly disposed: boolean;
  readonly raster: Format;
  readonly handle: FontHandle;
  readonly identity: object;
  dispose(): void;
}

/** @internal The retained portable resources associated with one engine binding lease. */
export interface EngineFontBindingResources<Format extends RasterFormatMetadata> {
  readonly font: RegisteredFont;
  readonly raster: RegisteredRaster<RasterKindOf<Format>>;
  readonly data: RasterDataOf<Format>;
}

interface EngineFontRegistryLike {
  getByHandle(handle: FontHandle): RegisteredFont | undefined;
  _onFontDispose(listener: (font: RegisteredFont) => void): () => void;
}

class EngineFontRegistry implements EngineFontRegistryLike {
  readonly #fonts = new Map<FontHandle, RegisteredFont>();
  readonly #disposeListeners = new Set<(font: RegisteredFont) => void>();

  getByHandle(handle: FontHandle): RegisteredFont | undefined {
    return this.#fonts.get(handle);
  }

  add(font: RegisteredFont): void {
    const existing = this.#fonts.get(font.handle);
    if (existing !== undefined && existing !== font) {
      throw new Error('glyph engine shaping font handle conflict');
    }
    this.#fonts.set(font.handle, font);
  }

  delete(font: RegisteredFont): void {
    if (this.#fonts.get(font.handle) !== font) return;
    this.#fonts.delete(font.handle);
    for (const listener of this.#disposeListeners) listener(font);
  }

  _onFontDispose(listener: (font: RegisteredFont) => void): () => void {
    this.#disposeListeners.add(listener);
    return () => this.#disposeListeners.delete(listener);
  }
}

/** Creates an independent Wasm shaping engine. */
export async function createGlyphEngine(options: GlyphEngineOptions = {}): Promise<GlyphEngine> {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('glyph engine options must be an object');
  }
  const fontRegistry = new EngineFontRegistry();
  const shaper = await createRuntimeShaper({
    registry: fontRegistry,
    ...(options.wasm === undefined ? {} : { wasm: options.wasm }),
  });
  try {
    return new GlyphEngineImpl(fontRegistry, shaper);
  } catch (error) {
    shaper.dispose();
    throw error;
  }
}

/** @internal Direct shaper access for package diagnostics and migration tests. */
export function glyphEngineShaperForTests(glyphEngine: GlyphEngine): RuntimeShaper {
  if (!(glyphEngine instanceof GlyphEngineImpl)) throw new TypeError('glyph engine was not created by this package');
  return glyphEngine._shaper();
}

/** @internal Observe renderer-owned teardown that must run before the engine releases its shaper. */
export function observeGlyphEngineDispose(glyphEngine: GlyphEngine, dispose: () => void): () => void {
  if (!(glyphEngine instanceof GlyphEngineImpl)) throw new TypeError('glyph engine was not created by this package');
  return glyphEngine._observeDispose(dispose);
}

/** @internal Creates the engine-local state owned by one configured Glyph handle. */
export function createGlyphHandleState(glyphEngine: GlyphEngine, options: GlyphHandleStateOptions): GlyphHandleState {
  if (!(glyphEngine instanceof GlyphEngineImpl)) throw new TypeError('glyph engine was not created by this package');
  return glyphEngine._createHandleState(options);
}

/** @internal Registers one anonymous or named root with the engine-wide shape coordinator. */
export function registerGlyphShapeParticipant(
  glyphEngine: GlyphEngine,
  participant: GlyphShapeParticipant,
): GlyphShapeRegistration {
  if (!(glyphEngine instanceof GlyphEngineImpl)) throw new TypeError('glyph engine was not created by this package');
  return glyphEngine._registerShapeParticipant(participant);
}

/** @internal Prepares every dirty paragraph of every dirty root in one engine call, without publishing. */
export function prepareGlyphEngine(glyphEngine: GlyphEngine, measureAll = true): void {
  if (!(glyphEngine instanceof GlyphEngineImpl)) throw new TypeError('glyph engine was not created by this package');
  glyphEngine._prepare(measureAll);
}

/**
 * @internal Flushes every dirty root registered with one Glyph engine. `prepared` says the caller already ran
 * `prepare()` for this frame, so its layout phase is over: what became dirty since is prepared and published,
 * except a text with a layout callback whose layout changed, which waits for the next frame's phase.
 */
export function shapeGlyphEngine(glyphEngine: GlyphEngine, prepared = false): void {
  if (!(glyphEngine instanceof GlyphEngineImpl)) throw new TypeError('glyph engine was not created by this package');
  glyphEngine._shape(prepared);
}

/** @internal Acquire one counted engine-local Wasm shaping registration. */
export function acquireEngineFontBinding<Format extends RasterFormatMetadata>(
  glyphEngine: GlyphEngine,
  font: Font<Format>,
): EngineFontBindingLease<Format> {
  if (!(glyphEngine instanceof GlyphEngineImpl)) throw new TypeError('glyph engine was not created by this package');
  return glyphEngine._acquireFont(font);
}

/** @internal Read the hidden shaping handle while the binding lease is live. */
export function engineFontBindingHandle<Format extends RasterFormatMetadata>(
  binding: EngineFontBindingLease<Format>,
): FontHandle {
  if (!(binding instanceof EngineFontBindingLeaseImpl)) {
    throw new TypeError('engine font binding was not created by this package');
  }
  return binding.handle;
}

/** @internal Read retained portable resources while the engine binding lease is live. */
export function engineFontBindingResources<Format extends RasterFormatMetadata>(
  binding: EngineFontBindingLease<Format>,
): EngineFontBindingResources<Format> {
  if (!(binding instanceof EngineFontBindingLeaseImpl)) {
    throw new TypeError('engine font binding was not created by this package');
  }
  return binding._resources();
}

class GlyphEngineImpl implements GlyphEngine {
  readonly #fontRegistry: EngineFontRegistry;
  readonly #shaper: RuntimeShaper;
  readonly #disposeObservers = new Set<() => void>();
  readonly #handleStates = new Set<GlyphHandleState>();
  readonly #fontRegistrations = new WeakMap<RegisteredFont, EngineFontRegistration>();
  readonly #liveFontRegistrations = new Set<EngineFontRegistration>();
  readonly #shapeRegistrations = new Set<GlyphShapeRegistrationImpl>();
  readonly #dirtyShapeRegistrations = new Set<GlyphShapeRegistrationImpl>();
  readonly #shapeRegistrationScratch: GlyphShapeRegistrationImpl[] = [];
  readonly #stagedPlannerScratch: StagedRenderPlanner[] = [];
  readonly #stagedRegistrationIndexScratch: number[] = [];
  readonly #shapeOutcomeScratch: ShapeOutcome[] = [];
  #disposed = false;
  #disposing = false;
  #borrowedPlanActive = false;
  #shapeSettlementActive = false;
  #shapeActive = false;
  #layoutPhaseActive = false;
  /** A layout callback wrote something a root must publish: colour, opacity, material or a transform. */
  #writtenInLayoutPhase = false;
  /** Roots whose frame preparation failed: the same frame's publication leaves them for the next frame. */
  readonly #failedFramePreparations = new Set<GlyphShapeRegistrationImpl>();
  #nextHandleOrdinal = 1;

  constructor(fontRegistry: EngineFontRegistry, shaper: RuntimeShaper) {
    this.#fontRegistry = fontRegistry;
    this.#shaper = shaper;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  /** @internal */
  _createHandleState(options: GlyphHandleStateOptions): GlyphHandleState {
    this.#assertActive();
    const ordinal = this.#nextHandleOrdinal;
    const nextOrdinal = ordinal + 1;
    if (!Number.isSafeInteger(nextOrdinal)) throw new RangeError('glyph handle identities are exhausted');
    let state!: GlyphHandleState;
    state = new GlyphHandleState(
      this.#shaper,
      options,
      () => this.#handleStates.delete(state),
      (font) => this._acquireFont(font),
      () => this.#assertHandleStateAvailable(),
      () => this.#enterBorrowedPlan(),
      `${options.integration}/handle/${ordinal}`,
      () => this.#assertHandleLifecycleMutationAllowed(),
      () => this.#layoutPhaseActive,
    );
    this.#handleStates.add(state);
    this.#nextHandleOrdinal = nextOrdinal;
    return state;
  }

  /** Teardown is total — every stage runs even if an earlier one fails, so one bad font can't strand the Wasm memory. Failures are reported, not thrown, since this often runs while already unwinding. */
  dispose(): void {
    if (this.#disposed || this.#disposing) return;
    this.#assertHandleLifecycleMutationAllowed();
    if (this.#borrowedPlanActive) {
      throw new Error('glyph engine cannot be disposed while a borrowed render plan is active');
    }
    this.#disposing = true;
    const report = (stage: string, error: unknown): void => {
      if (DEV && process.env.NODE_ENV !== 'production')
        console.warn(`glyph engine teardown continued after ${stage} failed: ${String(error)}`);
    };
    for (const dispose of [...this.#disposeObservers]) {
      try {
        dispose();
      } catch (error) {
        report('disposing a renderer integration', error);
      }
    }
    this.#disposeObservers.clear();
    for (const registration of [...this.#shapeRegistrations]) registration.dispose();
    this.#shapeRegistrations.clear();
    this.#dirtyShapeRegistrations.clear();
    for (const state of [...this.#handleStates]) {
      try {
        state.dispose();
      } catch (error) {
        report('disposing Glyph handle state', error);
      }
    }
    this.#handleStates.clear();
    for (const registration of [...this.#liveFontRegistrations]) {
      try {
        this.#disposeFontRegistration(registration);
      } catch (error) {
        report('disposing an engine font binding', error);
      }
    }
    try {
      this.#shaper.dispose();
    } catch (error) {
      report('disposing the shaper', error);
    } finally {
      this.#disposed = true;
      this.#disposing = false;
    }
  }

  /** @internal */
  _acquireFont<Format extends RasterFormatMetadata>(font: Font<Format>): EngineFontBindingLease<Format> {
    this.#assertActive();
    const registered = immutableFontResources(font).font;
    const variantIdentity = immutableFontVariantIdentity(font);
    let registration = this.#fontRegistrations.get(registered);
    const resources = acquireImmutableFontResources(font);
    if (registration === undefined || registration.disposed) {
      const created: EngineFontRegistration = {
        font: registered,
        resources: new Set(),
        leases: 0,
        disposed: false,
      };
      let registryAdded = false;
      try {
        this.#fontRegistry.add(registered);
        registryAdded = true;
        this.#shaper.registerFont(registered);
      } catch (error) {
        try {
          if (registryAdded) this.#fontRegistry.delete(registered);
        } finally {
          resources.dispose();
        }
        throw error;
      }
      registration = created;
      this.#fontRegistrations.set(registered, created);
      this.#liveFontRegistrations.add(created);
    }
    registration.leases += 1;
    registration.resources.add(resources);
    return new EngineFontBindingLeaseImpl(this, registration, variantIdentity, font.raster, resources);
  }

  _releaseFont<Format extends RasterFormatMetadata>(
    registration: EngineFontRegistration,
    resources: ImmutableFontResourceLease<Format>,
  ): void {
    registration.resources.delete(resources);
    resources.dispose();
    if (registration.disposed) return;
    if (registration.leases <= 0) throw new Error('engine font binding lease underflow');
    registration.leases -= 1;
    if (registration.leases === 0) this.#disposeFontRegistration(registration);
  }

  /** @internal */
  _registerShapeParticipant(participant: GlyphShapeParticipant): GlyphShapeRegistration {
    this.#assertActive();
    if (typeof participant !== 'object' || participant === null) {
      throw new TypeError('Glyph shape participant must be an object');
    }
    if (
      typeof participant.stage !== 'function' ||
      typeof participant.accepted !== 'function' ||
      typeof participant.rejected !== 'function'
    ) {
      throw new TypeError('Glyph shape participant must implement stage(), accepted(), and rejected()');
    }
    const registration = new GlyphShapeRegistrationImpl(this, participant);
    this.#shapeRegistrations.add(registration);
    return registration;
  }

  /** @internal */
  _isShapeParticipantQueued(registration: GlyphShapeRegistrationImpl): boolean {
    return this.#dirtyShapeRegistrations.has(registration);
  }

  /** @internal */
  _invalidateShapeParticipant(registration: GlyphShapeRegistrationImpl): void {
    this.#assertActive();
    if (!this.#shapeRegistrations.has(registration)) {
      throw new Error('Glyph shape participant is not registered with this engine');
    }
    this.#dirtyShapeRegistrations.add(registration);
    if (this.#layoutPhaseActive) this.#writtenInLayoutPhase = true;
  }

  /** @internal */
  _disposeShapeParticipant(registration: GlyphShapeRegistrationImpl): void {
    if (!this.#disposing) {
      this.#assertHandleStateAvailable();
      this.#assertHandleLifecycleMutationAllowed();
    }
    this.#dirtyShapeRegistrations.delete(registration);
    this.#shapeRegistrations.delete(registration);
  }

  /**
   * @internal Batch-prepares every dirty root and leaves each queued for the next `shape()`. A root whose
   * preparation fails is told so and the failure is thrown after every other root was prepared.
   */
  _prepare(measureAll = true): void {
    this.#assertActive();
    if (this.#shapeActive) throw new Error('glyph.prepare() cannot run inside glyph.shape() or glyph.prepare()');
    if (this.#dirtyShapeRegistrations.size === 0) return;
    this.#shapeActive = true;
    // A frame may prepare more than once before it publishes (a scheduler job, then the scene's own preparation
    // object). A root that already failed this frame is not prepared again until the frame has published.
    const failed = this.#failedFramePreparations;
    const registrations = [...this.#dirtyShapeRegistrations].filter(
      (registration) => measureAll || !failed.has(registration),
    );
    const outcomes: ShapeOutcome[] = [];
    const errors = new Set<unknown>();
    try {
      this.#prepareShapeParticipants(registrations, outcomes, measureAll, false);
      for (let index = 0; index < registrations.length; index += 1) {
        const outcome = outcomes[index];
        if (!isShapeFailure(outcome)) continue;
        errors.add(outcome.error);
        if (!measureAll) failed.add(registrations[index]!);
        try {
          registrations[index]!.rejected(outcome.error);
        } catch (error) {
          errors.add(error);
        }
      }
    } finally {
      this.#shapeActive = false;
    }
    if (errors.size === 1) throw errors.values().next().value;
    if (errors.size > 1) throw new AggregateError(errors, 'multiple Glyph roots rejected prepare()');
  }

  /** @internal Prepares whatever is still dirty, then publishes: a paragraph is never laid out twice for one value. */
  _shape(prepared = false): void {
    this.#assertActive();
    if (this.#shapeActive) throw new Error('glyph.shape() cannot be reentered');
    if (this.#dirtyShapeRegistrations.size === 0) return;
    this.#shapeActive = true;
    const registrations = this.#shapeRegistrationScratch;
    const staged = this.#stagedPlannerScratch;
    const stagedRegistrationIndices = this.#stagedRegistrationIndexScratch;
    const outcomes = this.#shapeOutcomeScratch;
    registrations.length = 0;
    staged.length = 0;
    stagedRegistrationIndices.length = 0;
    outcomes.length = 0;
    let failure: ShapeFailure | undefined;
    try {
      // A root that failed this frame's preparation was already told: it stays dirty, and the next frame
      // prepares it again. Preparing it twice in one frame would repeat a failure that restarts the engine.
      const failed = this.#failedFramePreparations;
      for (const registration of this.#dirtyShapeRegistrations) {
        if (prepared && failed.has(registration)) continue;
        registrations.push(registration);
        this.#dirtyShapeRegistrations.delete(registration);
      }
      failed.clear();
      // A frame whose layout phase already ran still reconciles and prepares what the traversal changed since,
      // so ordinary text is never a frame late. Only a text with a layout callback is held: it is published at a
      // revision whose callback has run, which is the next frame's.
      this.#writtenInLayoutPhase = false;
      this.#prepareShapeParticipants(registrations, outcomes, false, prepared);
      // What this call's layout callbacks painted is published by this call, not a frame later.
      if (this.#writtenInLayoutPhase) {
        this.#writtenInLayoutPhase = false;
        this.#prepareShapeParticipants(registrations, outcomes, false, true);
      }
      this.#stageShapeParticipants(registrations, staged, stagedRegistrationIndices, outcomes);
      if (staged.length !== 0) {
        try {
          this.#updateShapeBatch(staged, stagedRegistrationIndices, outcomes);
        } catch (error) {
          const batchError = shapeFailure(error);
          for (let index = 0; index < outcomes.length; index += 1) {
            if (outcomes[index] === undefined) outcomes[index] = batchError;
          }
        }
      }
      this.#settleShapeParticipants(registrations, outcomes);
    } catch (error) {
      failure = shapeFailure(error);
    } finally {
      for (const planner of staged) {
        try {
          planner.discard();
        } catch (error) {
          failure ??= shapeFailure(error);
        }
      }
      registrations.length = 0;
      staged.length = 0;
      stagedRegistrationIndices.length = 0;
      outcomes.length = 0;
      this.#shapeActive = false;
    }
    if (failure !== undefined) throw failure.error;
  }

  /** Reconciles each root, prepares all their dirty paragraphs in one engine call, then tells each root. */
  #prepareShapeParticipants(
    registrations: readonly GlyphShapeRegistrationImpl[],
    outcomes: ShapeOutcome[],
    measureAll: boolean,
    holdObserved: boolean,
  ): void {
    const staged: StagedPlannerPreparation[] = [];
    const stagedRegistrationIndices: number[] = [];
    try {
      for (let index = 0; index < registrations.length; index += 1) {
        const registration = registrations[index]!;
        if (registration.disposed || isShapeFailure(outcomes[index])) continue;
        try {
          const preparation = registration.prepare(measureAll, holdObserved);
          if (preparation === undefined) continue;
          staged.push(preparation);
          stagedRegistrationIndices.push(index);
        } catch (error) {
          outcomes[index] = shapeFailure(error);
        }
      }
      if (staged.length !== 0) this.#adoptPreparationBatch(staged, stagedRegistrationIndices, outcomes);
    } finally {
      for (const preparation of staged) {
        try {
          preparation.discardPreparation();
        } catch {
          // The root already recorded that its derived state must be rebuilt.
        }
      }
    }
    for (let index = 0; index < registrations.length; index += 1) {
      const registration = registrations[index]!;
      if (registration.disposed || isShapeFailure(outcomes[index])) continue;
      try {
        registration.prepared();
      } catch (error) {
        outcomes[index] = shapeFailure(error);
      }
    }
    if (!holdObserved) this.#runLayoutPhase(registrations, outcomes);
  }

  /**
   * The layout phase is engine-wide: every root is prepared before any callback runs, so a callback may read any
   * text, and no callback may write a layout input of any text. It runs once per frame.
   */
  #runLayoutPhase(registrations: readonly GlyphShapeRegistrationImpl[], outcomes: ShapeOutcome[]): void {
    this.#layoutPhaseActive = true;
    try {
      for (let index = 0; index < registrations.length; index += 1) {
        const registration = registrations[index]!;
        if (registration.disposed || isShapeFailure(outcomes[index])) continue;
        try {
          registration.layout();
        } catch (error) {
          outcomes[index] = shapeFailure(error);
        }
      }
    } finally {
      this.#layoutPhaseActive = false;
    }
  }

  /** Makes the one batch-preparation call and hands each root its own answer; a root's failure stays its own. */
  #adoptPreparationBatch(
    staged: readonly StagedPlannerPreparation[],
    stagedRegistrationIndices: readonly number[],
    outcomes: ShapeOutcome[],
  ): void {
    try {
      const exports = runtimeShaperEngineExports(this.#shaper);
      const results = this.#callBatch(staged, exports.prepareBatch, 'prepare Glyph batch');
      const layout = textShaperAbi.layouts.engineUpdateBatchEntry;
      for (let stagedIndex = 0; stagedIndex < staged.length; stagedIndex += 1) {
        const offset = stagedIndex * layout.size;
        const status = results.view.getUint32(offset + layout.status, true);
        const resultPointer = results.view.getUint32(offset + layout.resultPointer, true);
        try {
          if (resultPointer === 0) requireEngineStatus(status, 'prepare Glyph root');
          staged[stagedIndex]!.adoptPreparation(resultPointer, results.memory);
        } catch (error) {
          outcomes[stagedRegistrationIndices[stagedIndex]!] = shapeFailure(error);
        }
      }
    } catch (error) {
      const batchError = shapeFailure(error);
      for (const index of stagedRegistrationIndices) outcomes[index] ??= batchError;
    }
  }

  /** Writes one entry per staged root into the shared batch arena and makes the single engine call. */
  #callBatch(
    staged: readonly StagedPlannerRequest[],
    call: (entriesPointer: number, count: number) => number,
    operation: string,
  ): { readonly view: DataView; readonly memory: ArrayBuffer } {
    const exports = runtimeShaperEngineExports(this.#shaper);
    const count = staged.length;
    if (count > exports.updateBatchCapacity()) {
      requireEngineStatus(exports.reserveUpdateBatch(count), 'reserve Glyph batch');
    }
    const pointer = exports.updateBatchPointer();
    if (pointer === 0) throw new GlyphEngineStatusError('resolve Glyph batch', textShaperAbi.status.resultTooLarge);
    const layout = textShaperAbi.layouts.engineUpdateBatchEntry;
    const byteLength = count * layout.size;
    if (pointer + byteLength > exports.memory.buffer.byteLength) {
      throw new RangeError('Glyph batch descriptor arena is out of bounds');
    }
    const view = new DataView(exports.memory.buffer, pointer, byteLength);
    for (let index = 0; index < count; index += 1) {
      const request = staged[index]!;
      const offset = index * layout.size;
      view.setUint32(offset + layout.rootId, request.rootId, true);
      view.setUint32(offset + layout.requestLength, request.requestLength, true);
      view.setUint32(offset + layout.resultPointer, 0, true);
      view.setUint32(offset + layout.status, 0, true);
    }
    requireEngineStatus(call(pointer, count), operation);
    const memory = exports.memory.buffer as ArrayBuffer;
    return { view: new DataView(memory, pointer, byteLength), memory };
  }

  #stageShapeParticipants(
    registrations: GlyphShapeRegistrationImpl[],
    staged: StagedRenderPlanner[],
    stagedRegistrationIndices: number[],
    outcomes: ShapeOutcome[],
  ): void {
    for (let index = 0; index < registrations.length; index += 1) {
      const registration = registrations[index]!;
      if (registration.disposed || isShapeFailure(outcomes[index])) continue;
      try {
        const planner = registration.stage();
        this.#dirtyShapeRegistrations.delete(registration);
        if (planner !== undefined) {
          staged.push(planner);
          stagedRegistrationIndices.push(index);
          outcomes[index] = undefined;
        } else {
          outcomes[index] = SKIPPED;
        }
      } catch (error) {
        this.#dirtyShapeRegistrations.delete(registration);
        outcomes[index] = shapeFailure(error);
      }
    }
  }

  #updateShapeBatch(
    staged: StagedRenderPlanner[],
    stagedRegistrationIndices: number[],
    outcomes: ShapeOutcome[],
  ): void {
    const exports = runtimeShaperEngineExports(this.#shaper);
    const { view, memory: finalMemory } = this.#callBatch(staged, exports.textUpdateBatch, 'publish Glyph shape batch');
    const layout = textShaperAbi.layouts.engineUpdateBatchEntry;
    for (let stagedIndex = 0; stagedIndex < staged.length; stagedIndex += 1) {
      const registrationIndex = stagedRegistrationIndices[stagedIndex]!;
      const planner = staged[stagedIndex]!;
      const offset = stagedIndex * layout.size;
      const status = view.getUint32(offset + layout.status, true);
      const resultPointer = view.getUint32(offset + layout.resultPointer, true);
      try {
        if (resultPointer === 0) requireEngineStatus(status, 'publish Glyph root');
        planner.adopt(resultPointer, finalMemory);
      } catch (error) {
        outcomes[registrationIndex] = shapeFailure(error);
      }
    }
    const leaveBorrow = this.#enterBorrowedPlan();
    try {
      for (let stagedIndex = 0; stagedIndex < staged.length; stagedIndex += 1) {
        const registrationIndex = stagedRegistrationIndices[stagedIndex]!;
        if (isShapeFailure(outcomes[registrationIndex])) continue;
        const planner = staged[stagedIndex]!;
        try {
          outcomes[registrationIndex] = planner.consume();
        } catch (error) {
          outcomes[registrationIndex] = shapeFailure(error);
        }
      }
    } finally {
      leaveBorrow();
    }
    for (let stagedIndex = 0; stagedIndex < staged.length; stagedIndex += 1) {
      const registrationIndex = stagedRegistrationIndices[stagedIndex]!;
      const outcome = outcomes[registrationIndex];
      if (outcome === undefined || outcome === SKIPPED || isShapeFailure(outcome) || !outcome.accepted) continue;
      try {
        staged[stagedIndex]!.settle();
      } catch (error) {
        outcomes[registrationIndex] = shapeFailure(error);
      }
    }
  }

  #settleShapeParticipants(registrations: GlyphShapeRegistrationImpl[], outcomes: ShapeOutcome[]): void {
    const errors = new Set<unknown>();
    this.#shapeSettlementActive = true;
    try {
      for (let index = 0; index < registrations.length; index += 1) {
        const registration = registrations[index]!;
        if (registration.disposed) continue;
        const outcome = outcomes[index];
        try {
          if (outcome === SKIPPED) continue;
          if (outcome === undefined || isShapeFailure(outcome)) {
            const error =
              outcome === undefined ? new Error('Glyph root did not produce a shape outcome') : outcome.error;
            registration.rejected(error);
            errors.add(error);
          } else if (outcome.accepted) {
            registration.accepted();
          } else {
            const error = outcome.error;
            registration.rejected(error);
            errors.add(error);
          }
        } catch (error) {
          errors.add(error);
        }
      }
    } finally {
      this.#shapeSettlementActive = false;
    }
    if (errors.size === 1) throw errors.values().next().value;
    if (errors.size > 1) throw new AggregateError(errors, 'multiple Glyph roots rejected shape()');
  }

  #disposeFontRegistration(registration: EngineFontRegistration): void {
    if (registration.disposed) return;
    registration.disposed = true;
    registration.leases = 0;
    this.#liveFontRegistrations.delete(registration);
    this.#fontRegistrations.delete(registration.font);
    try {
      this.#fontRegistry.delete(registration.font);
    } finally {
      for (const resources of registration.resources) resources.dispose();
      registration.resources.clear();
      registration.leases = 0;
    }
  }

  #assertActive(): void {
    if (this.#disposed || this.#disposing) throw new Error('glyph engine has been disposed');
    this.#assertHandleStateAvailable();
  }

  #assertHandleStateAvailable(): void {
    if (this.#disposed) throw new Error('glyph engine has been disposed');
    if (this.#borrowedPlanActive) {
      throw new Error('glyph engine cannot be reentered while a borrowed render plan is active');
    }
  }

  #assertHandleLifecycleMutationAllowed(): void {
    if (this.#shapeSettlementActive) {
      throw new Error('glyph engine cannot mutate handles while shape participants are settling');
    }
  }

  #enterBorrowedPlan(): () => void {
    this.#assertActive();
    this.#borrowedPlanActive = true;
    let active = true;
    return () => {
      if (!active) throw new Error('borrowed render-plan gate was released twice');
      active = false;
      this.#borrowedPlanActive = false;
    };
  }

  /** @internal */
  _shaper(): RuntimeShaper {
    this.#assertActive();
    return this.#shaper;
  }

  _observeDispose(dispose: () => void): () => void {
    this.#assertActive();
    if (typeof dispose !== 'function') throw new TypeError('glyph engine dispose observer must be a function');
    this.#disposeObservers.add(dispose);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.#disposeObservers.delete(dispose);
    };
  }
}

const SKIPPED: unique symbol = Symbol('pmndrs.glyph.shape.skipped');
const SHAPE_FAILURE: unique symbol = Symbol('pmndrs.glyph.shape.failure');
type ShapeFailure = Readonly<{ [SHAPE_FAILURE]: true; error: unknown }>;
type ShapeOutcome = PlanAcceptance | ShapeFailure | typeof SKIPPED | undefined;

function shapeFailure(error: unknown): ShapeFailure {
  return { [SHAPE_FAILURE]: true, error };
}

function isShapeFailure(outcome: ShapeOutcome): outcome is ShapeFailure {
  return typeof outcome === 'object' && outcome !== null && SHAPE_FAILURE in outcome;
}

class GlyphShapeRegistrationImpl implements GlyphShapeRegistration {
  readonly #engine: GlyphEngineImpl;
  readonly #participant: GlyphShapeParticipant;
  #disposed = false;

  constructor(engine: GlyphEngineImpl, participant: GlyphShapeParticipant) {
    this.#engine = engine;
    this.#participant = participant;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  get queued(): boolean {
    return this.#engine._isShapeParticipantQueued(this);
  }

  invalidate(): void {
    if (this.#disposed) throw new Error('Glyph shape registration has been disposed');
    this.#engine._invalidateShapeParticipant(this);
  }

  prepare(measureAll: boolean, holdObserved: boolean): StagedPlannerPreparation | undefined {
    return this.#participant.prepare(measureAll, holdObserved);
  }

  prepared(): void {
    this.#participant.prepared();
  }

  layout(): void {
    this.#participant.layout?.();
  }

  stage(): StagedRenderPlanner | undefined {
    return this.#participant.stage();
  }

  accepted(): void {
    this.#participant.accepted();
  }

  rejected(error: unknown): void {
    this.#participant.rejected(error);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#engine._disposeShapeParticipant(this);
    this.#disposed = true;
  }
}

function requireEngineStatus(status: number, operation: string): void {
  if (status !== textShaperAbi.status.ok) throw new GlyphEngineStatusError(operation, status);
}

class EngineFontBindingLeaseImpl<Format extends RasterFormatMetadata> implements EngineFontBindingLease<Format> {
  readonly #glyphEngine: GlyphEngineImpl;
  readonly #registration: EngineFontRegistration;
  readonly #identity: object;
  readonly #raster: Format;
  readonly #resources: ImmutableFontResourceLease<Format>;
  #disposed = false;

  constructor(
    glyphEngine: GlyphEngineImpl,
    registration: EngineFontRegistration,
    identity: object,
    raster: Format,
    resources: ImmutableFontResourceLease<Format>,
  ) {
    this.#glyphEngine = glyphEngine;
    this.#registration = registration;
    this.#identity = identity;
    this.#raster = raster;
    this.#resources = resources;
  }

  get disposed(): boolean {
    return this.#disposed || this.#registration.disposed;
  }

  get raster(): Format {
    return this.#raster;
  }

  get handle(): FontHandle {
    if (this.disposed) throw new Error('engine font binding has been disposed');
    return this.#registration.font.handle;
  }

  get identity(): object {
    if (this.disposed) throw new Error('engine font binding has been disposed');
    return this.#identity;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#glyphEngine._releaseFont(this.#registration, this.#resources);
  }

  /** @internal */
  _handle(): FontHandle {
    return this.handle;
  }

  /** @internal */
  _resources(): EngineFontBindingResources<Format> {
    if (this.disposed) throw new Error('engine font binding has been disposed');
    return {
      font: this.#resources.font,
      raster: this.#resources.raster,
      data: this.#resources.data,
    };
  }
}
