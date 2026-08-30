import { DEV } from './internal/dev.js';

import type { Font, RegisteredFont } from './font.js';
import {
  acquireImmutableFontResources,
  immutableFontResources,
  immutableFontVariantIdentity,
  type ImmutableFontResourceLease,
} from './loaded-font.js';
import type { AnyRasterTechnique, RasterDataOf } from './raster-technique.js';
import type { RasterKindOf, RegisteredRaster } from './raster.js';
import { createRuntimeShaper, type RuntimeShaper } from './shaper.js';
import { GlyphBackend, type GlyphBackendOptions } from './core/backend.js';
import type { FontHandle } from './identity.js';

/** Options for constructing one independent Wasm shaping engine. */
export interface GlyphEngineOptions {
  readonly wasm?: BufferSource | WebAssembly.Module;
}

/** Owns one Wasm shaping domain and every backend created from it. */
export interface GlyphEngine {
  readonly disposed: boolean;

  /** Creates a renderer integration backend owned by this engine. */
  createBackend(options: GlyphBackendOptions): GlyphBackend;

  /** Disposes every owned backend and releases this engine's Wasm shaping domain. */
  dispose(): void;
}

interface EngineFontRegistration {
  readonly font: RegisteredFont;
  readonly variants: Map<object, EngineFontVariantRegistration>;
  leases: number;
  disposed: boolean;
}

interface EngineFontVariantRegistration<Technique extends AnyRasterTechnique = AnyRasterTechnique> {
  readonly identity: object;
  readonly technique: Technique;
  readonly resources: ImmutableFontResourceLease<Technique>;
  leases: number;
}

/** @internal An independent claim on one engine-local shaping registration. */
export interface EngineFontBindingLease<Technique extends AnyRasterTechnique = AnyRasterTechnique> {
  readonly disposed: boolean;
  readonly technique: Technique;
  readonly handle: FontHandle;
  readonly identity: object;
  dispose(): void;
}

/** @internal The retained portable resources associated with one engine binding lease. */
export interface EngineFontBindingResources<Technique extends AnyRasterTechnique = AnyRasterTechnique> {
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

/** @internal Acquire one counted engine-local Wasm shaping registration. */
export function acquireEngineFontBinding<Technique extends AnyRasterTechnique>(
  glyphEngine: GlyphEngine,
  font: Font<Technique>,
): EngineFontBindingLease<Technique> {
  if (!(glyphEngine instanceof GlyphEngineImpl)) throw new TypeError('glyph engine was not created by this package');
  return glyphEngine._acquireFont(font);
}

/** @internal Read the hidden shaping handle while the binding lease is live. */
export function engineFontBindingHandle(binding: EngineFontBindingLease<AnyRasterTechnique>): FontHandle {
  if (!(binding instanceof EngineFontBindingLeaseImpl)) {
    throw new TypeError('engine font binding was not created by this package');
  }
  return binding.handle;
}

/** @internal Read retained portable resources while the engine binding lease is live. */
export function engineFontBindingResources<Technique extends AnyRasterTechnique>(
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
  readonly #backends = new Set<GlyphBackend>();
  readonly #fontRegistrations = new WeakMap<RegisteredFont, EngineFontRegistration>();
  readonly #liveFontRegistrations = new Set<EngineFontRegistration>();
  #disposed = false;
  #disposing = false;
  #borrowedPlanActive = false;
  #nextBackendOrdinal = 1;

  constructor(fontRegistry: EngineFontRegistry, shaper: RuntimeShaper) {
    this.#fontRegistry = fontRegistry;
    this.#shaper = shaper;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  /** Creates a renderer integration backend owned by this engine. */
  createBackend(options: GlyphBackendOptions): GlyphBackend {
    this.#assertActive();
    const ordinal = this.#nextBackendOrdinal;
    const nextOrdinal = ordinal + 1;
    if (!Number.isSafeInteger(nextOrdinal)) throw new RangeError('glyph backend identities are exhausted');
    let backend!: GlyphBackend;
    backend = new GlyphBackend(
      this.#shaper,
      options,
      () => this.#backends.delete(backend),
      (font) => this._acquireFont(font),
      () => this.#assertBackendAvailable(),
      () => this.#enterBorrowedPlan(),
      `${options.integration}/backend/${ordinal}`,
    );
    this.#backends.add(backend);
    this.#nextBackendOrdinal = nextOrdinal;
    return backend;
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
    for (const backend of [...this.#backends]) {
      try {
        backend.dispose();
      } catch (error) {
        report('disposing a glyph backend', error);
      }
    }
    this.#backends.clear();
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
  _acquireFont<Technique extends AnyRasterTechnique>(font: Font<Technique>): EngineFontBindingLease<Technique> {
    this.#assertActive();
    const registered = immutableFontResources(font).font;
    const variantIdentity = immutableFontVariantIdentity(font);
    let registration = this.#fontRegistrations.get(registered);
    let variant = registration?.variants.get(variantIdentity) as EngineFontVariantRegistration<Technique> | undefined;
    if (registration === undefined || registration.disposed) {
      const resources = acquireImmutableFontResources(font);
      const createdVariant: EngineFontVariantRegistration<Technique> = {
        identity: variantIdentity,
        technique: font.technique,
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
        technique: font.technique,
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
    this.#assertBackendAvailable();
  }

  #assertBackendAvailable(): void {
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

class EngineFontBindingLeaseImpl<Technique extends AnyRasterTechnique> implements EngineFontBindingLease<Technique> {
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

  get technique(): Technique {
    return this.#variant.technique;
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
