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
import { TextEngineHost, type TextEngineHostOptions } from './core/host.js';
import type { FontHandle } from './identity.js';

/** Options for constructing one independent Wasm shaping runtime. */
export interface TextRuntimeOptions {
  readonly wasm?: BufferSource | WebAssembly.Module;
}

/** Owns one Wasm shaping domain and every text-engine host created from it. */
export interface TextRuntime {
  readonly disposed: boolean;

  /** Creates a renderer integration host owned by this runtime. */
  createTextEngineHost(options: TextEngineHostOptions): TextEngineHost;

  /** Disposes every owned host and releases this runtime's Wasm shaping domain. */
  dispose(): void;
}

interface RuntimeFontRegistration {
  readonly font: RegisteredFont;
  readonly variants: Map<object, RuntimeFontVariantRegistration>;
  leases: number;
  disposed: boolean;
}

interface RuntimeFontVariantRegistration<Technique extends AnyRasterTechnique = AnyRasterTechnique> {
  readonly identity: object;
  readonly technique: Technique;
  readonly resources: ImmutableFontResourceLease<Technique>;
  leases: number;
}

/** @internal An independent claim on one runtime-local shaping registration. */
export interface RuntimeFontBindingLease<Technique extends AnyRasterTechnique = AnyRasterTechnique> {
  readonly disposed: boolean;
  readonly technique: Technique;
  readonly handle: FontHandle;
  readonly identity: object;
  dispose(): void;
}

/** @internal The retained portable resources associated with one runtime binding lease. */
export interface RuntimeFontBindingResources<Technique extends AnyRasterTechnique = AnyRasterTechnique> {
  readonly font: RegisteredFont;
  readonly raster: RegisteredRaster<RasterKindOf<Technique>>;
  readonly data: RasterDataOf<Technique>;
}

interface RuntimeFontRegistryLike {
  getByHandle(handle: FontHandle): RegisteredFont | undefined;
  _onFontDispose(listener: (font: RegisteredFont) => void): () => void;
}

class RuntimeFontRegistry implements RuntimeFontRegistryLike {
  readonly #fonts = new Map<FontHandle, RegisteredFont>();
  readonly #disposeListeners = new Set<(font: RegisteredFont) => void>();

  getByHandle(handle: FontHandle): RegisteredFont | undefined {
    return this.#fonts.get(handle);
  }

  add(font: RegisteredFont): void {
    const existing = this.#fonts.get(font.handle);
    if (existing !== undefined && existing !== font) {
      throw new Error('runtime shaping font handle conflict');
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

/** Creates an independent Wasm shaping runtime. */
export async function createTextRuntime(options: TextRuntimeOptions = {}): Promise<TextRuntime> {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('text runtime options must be an object');
  }
  const runtimeRegistry = new RuntimeFontRegistry();
  const shaper = await createRuntimeShaper({
    registry: runtimeRegistry,
    ...(options.wasm === undefined ? {} : { wasm: options.wasm }),
  });
  try {
    return new TextRuntimeImpl(runtimeRegistry, shaper);
  } catch (error) {
    shaper.dispose();
    throw error;
  }
}

/** @internal Direct shaper access for package diagnostics and migration tests. */
export function textRuntimeShaperForTests(runtime: TextRuntime): RuntimeShaper {
  if (!(runtime instanceof TextRuntimeImpl)) throw new TypeError('text runtime was not created by this package');
  return runtime._shaper();
}

/** @internal Observe renderer-owned teardown that must run before the runtime releases its shaper. */
export function observeTextRuntimeDispose(runtime: TextRuntime, dispose: () => void): () => void {
  if (!(runtime instanceof TextRuntimeImpl)) throw new TypeError('text runtime was not created by this package');
  return runtime._observeDispose(dispose);
}

/** @internal Acquire one counted runtime-local Wasm shaping registration. */
export function acquireRuntimeFontBinding<Technique extends AnyRasterTechnique>(
  runtime: TextRuntime,
  font: Font<Technique>,
): RuntimeFontBindingLease<Technique> {
  if (!(runtime instanceof TextRuntimeImpl)) throw new TypeError('text runtime was not created by this package');
  return runtime._acquireFont(font);
}

/** @internal Read the hidden shaping handle while the binding lease is live. */
export function runtimeFontBindingHandle(binding: RuntimeFontBindingLease<AnyRasterTechnique>): FontHandle {
  if (!(binding instanceof RuntimeFontBindingLeaseImpl)) {
    throw new TypeError('runtime font binding was not created by this package');
  }
  return binding.handle;
}

/** @internal Read retained portable resources while the runtime binding lease is live. */
export function runtimeFontBindingResources<Technique extends AnyRasterTechnique>(
  binding: RuntimeFontBindingLease<Technique>,
): RuntimeFontBindingResources<Technique> {
  if (!(binding instanceof RuntimeFontBindingLeaseImpl)) {
    throw new TypeError('runtime font binding was not created by this package');
  }
  return binding._resources();
}

class TextRuntimeImpl implements TextRuntime {
  readonly #runtimeRegistry: RuntimeFontRegistry;
  readonly #shaper: RuntimeShaper;
  readonly #disposeObservers = new Set<() => void>();
  readonly #hosts = new Set<TextEngineHost>();
  readonly #fontRegistrations = new WeakMap<RegisteredFont, RuntimeFontRegistration>();
  readonly #liveFontRegistrations = new Set<RuntimeFontRegistration>();
  #disposed = false;
  #disposing = false;
  #borrowedPlanActive = false;
  #nextHostOrdinal = 1;

  constructor(runtimeRegistry: RuntimeFontRegistry, shaper: RuntimeShaper) {
    this.#runtimeRegistry = runtimeRegistry;
    this.#shaper = shaper;
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  /** Creates a renderer integration host owned by this runtime. */
  createTextEngineHost(options: TextEngineHostOptions): TextEngineHost {
    this.#assertActive();
    const ordinal = this.#nextHostOrdinal;
    const nextOrdinal = ordinal + 1;
    if (!Number.isSafeInteger(nextOrdinal)) throw new RangeError('text runtime host identities are exhausted');
    let host!: TextEngineHost;
    host = new TextEngineHost(
      this.#shaper,
      options,
      () => this.#hosts.delete(host),
      (font) => this._acquireFont(font),
      () => this.#assertHostAvailable(),
      () => this.#enterBorrowedPlan(),
      `${options.integration}/host/${ordinal}`,
    );
    this.#hosts.add(host);
    this.#nextHostOrdinal = nextOrdinal;
    return host;
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
      throw new Error('text runtime cannot be disposed while a borrowed render plan is active');
    }
    this.#disposing = true;
    const report = (stage: string, error: unknown): void => {
      if (DEV) console.warn(`text runtime teardown continued after ${stage} failed: ${String(error)}`);
    };
    for (const dispose of [...this.#disposeObservers]) {
      try {
        dispose();
      } catch (error) {
        report('disposing a renderer integration', error);
      }
    }
    this.#disposeObservers.clear();
    for (const host of [...this.#hosts]) {
      try {
        host.dispose();
      } catch (error) {
        report('disposing a text engine host', error);
      }
    }
    this.#hosts.clear();
    for (const registration of [...this.#liveFontRegistrations]) {
      try {
        this.#disposeFontRegistration(registration);
      } catch (error) {
        report('disposing a runtime font binding', error);
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
  _acquireFont<Technique extends AnyRasterTechnique>(font: Font<Technique>): RuntimeFontBindingLease<Technique> {
    this.#assertActive();
    const registered = immutableFontResources(font).font;
    const variantIdentity = immutableFontVariantIdentity(font);
    let registration = this.#fontRegistrations.get(registered);
    let variant = registration?.variants.get(variantIdentity) as RuntimeFontVariantRegistration<Technique> | undefined;
    if (registration === undefined || registration.disposed) {
      const resources = acquireImmutableFontResources(font);
      const createdVariant: RuntimeFontVariantRegistration<Technique> = {
        identity: variantIdentity,
        technique: font.technique,
        resources,
        leases: 0,
      };
      const created: RuntimeFontRegistration = {
        font: registered,
        variants: new Map([[variantIdentity, createdVariant]]),
        leases: 0,
        disposed: false,
      };
      let registryAdded = false;
      try {
        this.#runtimeRegistry.add(registered);
        registryAdded = true;
        this.#shaper.registerFont(registered);
      } catch (error) {
        try {
          if (registryAdded) this.#runtimeRegistry.delete(registered);
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
    return new RuntimeFontBindingLeaseImpl(this, registration, variant);
  }

  _releaseFont(registration: RuntimeFontRegistration, variant: RuntimeFontVariantRegistration): void {
    if (registration.disposed) return;
    if (registration.leases <= 0) throw new Error('runtime font binding lease underflow');
    if (variant.leases <= 0) throw new Error('runtime font variant lease underflow');
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

  #disposeFontRegistration(registration: RuntimeFontRegistration): void {
    if (registration.disposed) return;
    registration.disposed = true;
    registration.leases = 0;
    this.#liveFontRegistrations.delete(registration);
    this.#fontRegistrations.delete(registration.font);
    try {
      this.#runtimeRegistry.delete(registration.font);
    } finally {
      for (const variant of registration.variants.values()) {
        variant.leases = 0;
        variant.resources.dispose();
      }
      registration.variants.clear();
    }
  }

  #assertActive(): void {
    if (this.#disposed || this.#disposing) throw new Error('text runtime has been disposed');
    this.#assertHostAvailable();
  }

  #assertHostAvailable(): void {
    if (this.#disposed) throw new Error('text runtime has been disposed');
    if (this.#borrowedPlanActive) {
      throw new Error('text runtime cannot be reentered while a borrowed render plan is active');
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
    if (typeof dispose !== 'function') throw new TypeError('text runtime dispose observer must be a function');
    this.#disposeObservers.add(dispose);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.#disposeObservers.delete(dispose);
    };
  }
}

class RuntimeFontBindingLeaseImpl<Technique extends AnyRasterTechnique> implements RuntimeFontBindingLease<Technique> {
  readonly #runtime: TextRuntimeImpl;
  readonly #registration: RuntimeFontRegistration;
  readonly #variant: RuntimeFontVariantRegistration<Technique>;
  #disposed = false;

  constructor(
    runtime: TextRuntimeImpl,
    registration: RuntimeFontRegistration,
    variant: RuntimeFontVariantRegistration<Technique>,
  ) {
    this.#runtime = runtime;
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
    if (this.disposed) throw new Error('runtime font binding has been disposed');
    return this.#registration.font.handle;
  }

  get identity(): object {
    if (this.disposed) throw new Error('runtime font binding has been disposed');
    return this.#variant.identity;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#runtime._releaseFont(this.#registration, this.#variant);
  }

  /** @internal */
  _handle(): FontHandle {
    return this.handle;
  }

  /** @internal */
  _resources(): RuntimeFontBindingResources<Technique> {
    if (this.disposed) throw new Error('runtime font binding has been disposed');
    return {
      font: this.#variant.resources.font,
      raster: this.#variant.resources.raster,
      data: this.#variant.resources.data,
    };
  }
}
