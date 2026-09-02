import { DEV } from './internal/dev.js';

import type { Font, RegisteredFont } from './font.js';
import {
  acquireImmutableFontResources,
  immutableFontResources,
  immutableFontVariantIdentity,
  type ImmutableFontResourceLease,
} from './loaded-font.js';
import type { AnyRasterFormat, RasterDataOf } from './raster-format.js';
import type { RasterKindOf, RegisteredRaster } from './raster.js';
import { createRuntimeShaper, runtimeShaperEngineExports, type RuntimeShaper } from './shaper.js';
import { GlyphEngineStatusError, GlyphHandleState, type GlyphHandleStateOptions } from './internal/handle-state.js';
import type { FontHandle } from './identity.js';
import type { PlanAcceptance, StagedRenderPlanner } from './core/render-planner.js';
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
  stage(): StagedRenderPlanner | undefined;
  accepted(): void;
  rejected(error: unknown): void;
}

/** @internal Stable invalidation and teardown channel for one registered shape participant. */
export interface GlyphShapeRegistration {
  invalidate(): void;
  dispose(): void;
}

interface EngineFontRegistration {
  readonly font: RegisteredFont;
  readonly variants: Map<object, EngineFontVariantRegistration>;
  leases: number;
  disposed: boolean;
}

interface EngineFontVariantRegistration<Format extends AnyRasterFormat = AnyRasterFormat> {
  readonly identity: object;
  readonly raster: Format;
  readonly resources: ImmutableFontResourceLease<Format>;
  leases: number;
}

/** @internal An independent claim on one engine-local shaping registration. */
export interface EngineFontBindingLease<Format extends AnyRasterFormat = AnyRasterFormat> {
  readonly disposed: boolean;
  readonly raster: Format;
  readonly handle: FontHandle;
  readonly identity: object;
  dispose(): void;
}

/** @internal The retained portable resources associated with one engine binding lease. */
export interface EngineFontBindingResources<Technique extends AnyRasterFormat = AnyRasterFormat> {
  readonly font: RegisteredFont;
  readonly raster: RegisteredRaster<RasterKindOf<Technique>>;
  readonly data: RasterDataOf<Technique>;
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

/** @internal Flushes every dirty root registered with one Glyph engine. */
export function shapeGlyphEngine(glyphEngine: GlyphEngine): void {
  if (!(glyphEngine instanceof GlyphEngineImpl)) throw new TypeError('glyph engine was not created by this package');
  glyphEngine._shape();
}

/** @internal Acquire one counted engine-local Wasm shaping registration. */
export function acquireEngineFontBinding<Technique extends AnyRasterFormat>(
  glyphEngine: GlyphEngine,
  font: Font<Technique>,
): EngineFontBindingLease<Technique> {
  if (!(glyphEngine instanceof GlyphEngineImpl)) throw new TypeError('glyph engine was not created by this package');
  return glyphEngine._acquireFont(font);
}

/** @internal Read the hidden shaping handle while the binding lease is live. */
export function engineFontBindingHandle(binding: EngineFontBindingLease<AnyRasterFormat>): FontHandle {
  if (!(binding instanceof EngineFontBindingLeaseImpl)) {
    throw new TypeError('engine font binding was not created by this package');
  }
  return binding.handle;
}

/** @internal Read retained portable resources while the engine binding lease is live. */
export function engineFontBindingResources<Technique extends AnyRasterFormat>(
  binding: EngineFontBindingLease<Technique>,
): EngineFontBindingResources<Technique> {
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
  #shapeActive = false;
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
    );
    this.#handleStates.add(state);
    this.#nextHandleOrdinal = nextOrdinal;
    return state;
  }

  /**
   * Teardown is total: every stage runs even if an earlier one fails, so a single bad
   * font cannot strand the shaper instance and its Wasm memory. Failures are reported
   * rather than thrown, because this runs from `finally` blocks and unmount paths that
   * are frequently already unwinding an earlier error.
   */
  dispose(): void {
    if (this.#disposed || this.#disposing) return;
    if (this.#borrowedPlanActive) {
      throw new Error('glyph engine cannot be disposed while a borrowed render plan is active');
    }
    this.#disposing = true;
    const report = (stage: string, error: unknown): void => {
      if (DEV) console.warn(`glyph engine teardown continued after ${stage} failed: ${String(error)}`);
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
  _acquireFont<Technique extends AnyRasterFormat>(font: Font<Technique>): EngineFontBindingLease<Technique> {
    this.#assertActive();
    const registered = immutableFontResources(font).font;
    const variantIdentity = immutableFontVariantIdentity(font);
    let registration = this.#fontRegistrations.get(registered);
    let variant = registration?.variants.get(variantIdentity) as EngineFontVariantRegistration<Technique> | undefined;
    if (registration === undefined || registration.disposed) {
      const resources = acquireImmutableFontResources(font);
      const createdVariant: EngineFontVariantRegistration<Technique> = {
        identity: variantIdentity,
        raster: font.raster,
        resources,
        leases: 0,
      };
      const created: EngineFontRegistration = {
        font: registered,
        variants: new Map([[variantIdentity, createdVariant]]),
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
      variant = createdVariant;
      this.#fontRegistrations.set(registered, created);
      this.#liveFontRegistrations.add(created);
    } else if (variant === undefined) {
      variant = {
        identity: variantIdentity,
        raster: font.raster,
        resources: acquireImmutableFontResources(font),
        leases: 0,
      };
      registration.variants.set(variantIdentity, variant);
    }
    registration.leases += 1;
    variant.leases += 1;
    return new EngineFontBindingLeaseImpl(this, registration, variant);
  }

  _releaseFont(registration: EngineFontRegistration, variant: EngineFontVariantRegistration): void {
    if (registration.disposed) return;
    if (registration.leases <= 0) throw new Error('engine font binding lease underflow');
    if (variant.leases <= 0) throw new Error('engine font variant lease underflow');
    registration.leases -= 1;
    variant.leases -= 1;
    if (registration.leases === 0) {
      this.#disposeFontRegistration(registration);
      return;
    }
    if (variant.leases === 0) {
      registration.variants.delete(variant.identity);
      variant.resources.dispose();
    }
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
  _invalidateShapeParticipant(registration: GlyphShapeRegistrationImpl): void {
    this.#assertActive();
    if (!this.#shapeRegistrations.has(registration)) {
      throw new Error('Glyph shape participant is not registered with this engine');
    }
    this.#dirtyShapeRegistrations.add(registration);
  }

  /** @internal */
  _disposeShapeParticipant(registration: GlyphShapeRegistrationImpl): void {
    this.#dirtyShapeRegistrations.delete(registration);
    this.#shapeRegistrations.delete(registration);
  }

  /** @internal */
  _shape(): void {
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
    let failure: unknown;
    try {
      for (const registration of this.#dirtyShapeRegistrations) registrations.push(registration);
      this.#dirtyShapeRegistrations.clear();
      this.#stageShapeParticipants(registrations, staged, stagedRegistrationIndices, outcomes);
      if (staged.length !== 0) {
        try {
          this.#updateShapeBatch(staged, stagedRegistrationIndices, outcomes);
        } catch (error) {
          const batchError = asError(error);
          for (let index = 0; index < outcomes.length; index += 1) {
            if (outcomes[index] === undefined) outcomes[index] = batchError;
          }
        }
      }
      this.#settleShapeParticipants(registrations, outcomes);
    } catch (error) {
      failure = error;
    } finally {
      for (const planner of staged) {
        try {
          planner.discard();
        } catch (error) {
          failure ??= error;
        }
      }
      registrations.length = 0;
      staged.length = 0;
      stagedRegistrationIndices.length = 0;
      outcomes.length = 0;
      this.#shapeActive = false;
    }
    if (failure !== undefined) throw failure;
  }

  #stageShapeParticipants(
    registrations: GlyphShapeRegistrationImpl[],
    staged: StagedRenderPlanner[],
    stagedRegistrationIndices: number[],
    outcomes: ShapeOutcome[],
  ): void {
    for (let index = 0; index < registrations.length; index += 1) {
      const registration = registrations[index]!;
      if (registration.disposed) continue;
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
        outcomes[index] = asError(error);
      }
    }
  }

  #updateShapeBatch(
    staged: StagedRenderPlanner[],
    stagedRegistrationIndices: number[],
    outcomes: ShapeOutcome[],
  ): void {
    const exports = runtimeShaperEngineExports(this.#shaper);
    const count = staged.length;
    if (count > exports.updateBatchCapacity()) {
      requireEngineStatus(exports.reserveUpdateBatch(count), 'reserve Glyph shape batch');
    }
    const pointer = exports.updateBatchPointer();
    if (pointer === 0)
      throw new GlyphEngineStatusError('resolve Glyph shape batch', textShaperAbi.status.resultTooLarge);
    const layout = textShaperAbi.layouts.engineUpdateBatchEntry;
    const byteLength = count * layout.size;
    if (pointer + byteLength > exports.memory.buffer.byteLength) {
      throw new RangeError('Glyph shape batch descriptor arena is out of bounds');
    }
    let view = new DataView(exports.memory.buffer, pointer, byteLength);
    for (let index = 0; index < count; index += 1) {
      const planner = staged[index]!;
      const offset = index * layout.size;
      view.setUint32(offset + layout.plannerId, planner.plannerId, true);
      view.setUint32(offset + layout.requestLength, planner.requestLength, true);
      view.setUint32(offset + layout.resultPointer, 0, true);
      view.setUint32(offset + layout.status, 0, true);
    }
    requireEngineStatus(exports.textUpdateBatch(pointer, count), 'publish Glyph shape batch');
    const finalMemory = exports.memory.buffer as ArrayBuffer;
    view = new DataView(finalMemory, pointer, byteLength);
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
        outcomes[registrationIndex] = asError(error);
      }
    }
    const leaveBorrow = this.#enterBorrowedPlan();
    try {
      for (let stagedIndex = 0; stagedIndex < staged.length; stagedIndex += 1) {
        const registrationIndex = stagedRegistrationIndices[stagedIndex]!;
        if (outcomes[registrationIndex] instanceof Error) continue;
        const planner = staged[stagedIndex]!;
        try {
          outcomes[registrationIndex] = planner.consume();
        } catch (error) {
          outcomes[registrationIndex] = asError(error);
        }
      }
    } finally {
      leaveBorrow();
    }
    for (let stagedIndex = 0; stagedIndex < staged.length; stagedIndex += 1) {
      const registrationIndex = stagedRegistrationIndices[stagedIndex]!;
      const outcome = outcomes[registrationIndex];
      if (outcome === undefined || outcome === SKIPPED || outcome instanceof Error || !outcome.accepted) continue;
      try {
        staged[stagedIndex]!.settle();
      } catch (error) {
        outcomes[registrationIndex] = asError(error);
      }
    }
  }

  #settleShapeParticipants(registrations: GlyphShapeRegistrationImpl[], outcomes: ShapeOutcome[]): void {
    const errors = new Set<Error>();
    for (let index = 0; index < registrations.length; index += 1) {
      const registration = registrations[index]!;
      if (registration.disposed) continue;
      const outcome = outcomes[index];
      try {
        if (outcome === SKIPPED) continue;
        if (outcome === undefined || outcome instanceof Error) {
          const error = outcome ?? new Error('Glyph root did not produce a shape outcome');
          registration.rejected(error);
          errors.add(error);
        } else if (outcome.accepted) {
          registration.accepted();
        } else {
          const error = asError(outcome.error);
          registration.rejected(error);
          errors.add(error);
        }
      } catch (error) {
        errors.add(asError(error));
      }
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
      for (const variant of registration.variants.values()) {
        variant.leases = 0;
        variant.resources.dispose();
      }
      registration.variants.clear();
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
type ShapeOutcome = PlanAcceptance | Error | typeof SKIPPED | undefined;

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

  invalidate(): void {
    if (this.#disposed) throw new Error('Glyph shape registration has been disposed');
    this.#engine._invalidateShapeParticipant(this);
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
    this.#disposed = true;
    this.#engine._disposeShapeParticipant(this);
  }
}

function requireEngineStatus(status: number, operation: string): void {
  if (status !== textShaperAbi.status.ok) throw new GlyphEngineStatusError(operation, status);
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

class EngineFontBindingLeaseImpl<Technique extends AnyRasterFormat> implements EngineFontBindingLease<Technique> {
  readonly #glyphEngine: GlyphEngineImpl;
  readonly #registration: EngineFontRegistration;
  readonly #variant: EngineFontVariantRegistration<Technique>;
  #disposed = false;

  constructor(
    glyphEngine: GlyphEngineImpl,
    registration: EngineFontRegistration,
    variant: EngineFontVariantRegistration<Technique>,
  ) {
    this.#glyphEngine = glyphEngine;
    this.#registration = registration;
    this.#variant = variant;
  }

  get disposed(): boolean {
    return this.#disposed || this.#registration.disposed;
  }

  get raster(): Technique {
    return this.#variant.raster;
  }

  get handle(): FontHandle {
    if (this.disposed) throw new Error('engine font binding has been disposed');
    return this.#registration.font.handle;
  }

  get identity(): object {
    if (this.disposed) throw new Error('engine font binding has been disposed');
    return this.#variant.identity;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#glyphEngine._releaseFont(this.#registration, this.#variant);
  }

  /** @internal */
  _handle(): FontHandle {
    return this.handle;
  }

  /** @internal */
  _resources(): EngineFontBindingResources<Technique> {
    if (this.disposed) throw new Error('engine font binding has been disposed');
    return {
      font: this.#variant.resources.font,
      raster: this.#variant.resources.raster,
      data: this.#variant.resources.data,
    };
  }
}
