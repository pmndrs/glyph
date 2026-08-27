import { DEV } from './internal/dev.js';

import type { RasterBakeArtifact } from './bake.js';
import type { Font, RegisteredFont } from './font.js';
import {
  acquireImmutableFontResources,
  disposeLoadedFontFromRuntime,
  immutableFontResources,
  immutableFontVariantIdentity,
  LoadedFontImpl,
  type ImmutableFontResourceLease,
  type LoadedFont,
} from './loaded-font.js';
import {
  FontLoader,
  FontLoadError,
  FontRegistry,
  type RuntimeFontBake,
  type RuntimeFontBakeRequest,
} from './loader.js';
import { canonicalJson, deriveRasterKey } from './internal/raster-identity.js';
import { normalizeUnicodeRanges } from './internal/font-selection.js';
import {
  workerRasterKinds,
  type RuntimeBakeRaster,
  type RuntimeBakeUnicodeRange,
} from './internal/runtime-bake-protocol.js';
import { getRegisteredFontData } from './internal/registered-font.js';
import type {
  AnyRasterTechnique,
  RasterDataOf,
  RasterOptionsOf,
  RasterTechniqueRequest,
  RasterTechniqueTypesOf,
} from './raster-technique.js';
import type {
  RasterKindOf,
  RasterOptionsArgument,
  RegisteredRaster,
  RuntimeRasterBakeRequest as TechniqueRasterBakeRequest,
  RuntimeRasterBakerLoader,
  RuntimeRasterBakerModule,
} from './raster.js';
import { createRuntimeShaper, type RuntimeShaper } from './shaper.js';
import { TextEngineHost, type TextEngineHostOptions } from './core/host.js';
import type { FontHandle } from './identity.js';

export interface TextRuntimeOptions {
  /** @internal Compatibility for integrations that have not migrated to root `loadFont()`. */
  readonly registry?: FontRegistry;
  readonly wasm?: BufferSource | WebAssembly.Module;
}

export type LoadedFontInput =
  | { readonly baked: string | URL }
  | {
      readonly source: string | URL;
      readonly runtimeBake: RuntimeFontBake;
      readonly unicodeRanges?: readonly RuntimeBakeUnicodeRange[];
    };

export interface LoadedFontRequest<Technique extends AnyRasterTechnique> {
  readonly input: LoadedFontInput;
  readonly raster: RasterTechniqueRequest<Technique>;
}

export type LoadedFontTechniques = readonly [AnyRasterTechnique, ...AnyRasterTechnique[]];

export type LoadedFontRasterRequests<Techniques extends LoadedFontTechniques> = {
  readonly [Index in keyof Techniques]: RasterTechniqueRequest<Techniques[Index]>;
};

export interface LoadedFontsRequest<Techniques extends LoadedFontTechniques> {
  readonly input: LoadedFontInput;
  readonly rasters: LoadedFontRasterRequests<Techniques>;
}

export type LoadedFonts<Techniques extends LoadedFontTechniques> = {
  readonly [Index in keyof Techniques]: LoadedFont<Techniques[Index]>;
};

export interface TextRuntime {
  readonly disposed: boolean;

  createTextEngineHost(options: TextEngineHostOptions): TextEngineHost;

  /** @internal Compatibility for integrations that have not migrated to root `loadFont()`. */
  loadFont<Technique extends AnyRasterTechnique>(
    request: LoadedFontRequest<Technique>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<LoadedFont<Technique>>;

  /** @internal Compatibility for integrations that have not migrated to root `loadFont()`. */
  loadFont<const Techniques extends LoadedFontTechniques>(
    request: LoadedFontsRequest<Techniques>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<LoadedFonts<Techniques>>;

  dispose(): void;
}

interface PendingTechniqueLoad {
  readonly controller: AbortController;
  readonly promise: Promise<LoadedFont<AnyRasterTechnique>>;
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

export async function createTextRuntime(options: TextRuntimeOptions = {}): Promise<TextRuntime> {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw new TypeError('text runtime options must be an object');
  }
  const legacyRegistry = options.registry ?? new FontRegistry();
  const runtimeRegistry = new RuntimeFontRegistry();
  const shaper = await createRuntimeShaper({
    registry: runtimeRegistry as unknown as FontRegistry,
    ...(options.wasm === undefined ? {} : { wasm: options.wasm }),
  });
  try {
    return new TextRuntimeImpl(legacyRegistry, runtimeRegistry, shaper);
  } catch (error) {
    shaper.dispose();
    throw error;
  }
}

/**
 * Rust-engine access for renderer integrations: the bridge from a font-loading runtime to
 * the shaper instance a `TextEngineHost` drives. Public through `@pmndrs/glyph/core`.
 */
export function textRuntimeShaper(runtime: TextRuntime): RuntimeShaper {
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
  readonly #legacyRegistry: FontRegistry;
  readonly #runtimeRegistry: RuntimeFontRegistry;
  readonly #shaper: RuntimeShaper;
  readonly #defaultLoader: FontLoader;
  readonly #sourceLoaders = new Map<RuntimeFontBake, Map<string, FontLoader>>();
  readonly #loaded = new Map<RegisteredFont, Map<AnyRasterTechnique, Map<string, LoadedFont<AnyRasterTechnique>>>>();
  readonly #pending = new Map<RegisteredFont, Map<AnyRasterTechnique, Map<string, PendingTechniqueLoad>>>();
  readonly #disposeObservers = new Set<() => void>();
  readonly #hosts = new Set<TextEngineHost>();
  readonly #fontRegistrations = new WeakMap<RegisteredFont, RuntimeFontRegistration>();
  readonly #liveFontRegistrations = new Set<RuntimeFontRegistration>();
  readonly #legacyShaperFonts = new Set<RegisteredFont>();
  #disposed = false;

  constructor(legacyRegistry: FontRegistry, runtimeRegistry: RuntimeFontRegistry, shaper: RuntimeShaper) {
    this.#legacyRegistry = legacyRegistry;
    this.#runtimeRegistry = runtimeRegistry;
    this.#shaper = shaper;
    this.#defaultLoader = new FontLoader({ registry: legacyRegistry });
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  createTextEngineHost(options: TextEngineHostOptions): TextEngineHost {
    this.#assertActive();
    let host!: TextEngineHost;
    host = new TextEngineHost(
      this.#shaper,
      options,
      () => this.#hosts.delete(host),
      (font) => this._acquireFont(font),
    );
    this.#hosts.add(host);
    return host;
  }

  loadFont<Technique extends AnyRasterTechnique>(
    request: LoadedFontRequest<Technique>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<LoadedFont<Technique>>;
  loadFont<const Techniques extends LoadedFontTechniques>(
    request: LoadedFontsRequest<Techniques>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<LoadedFonts<Techniques>>;
  async loadFont(
    request: LoadedFontRequest<AnyRasterTechnique> | LoadedFontsRequest<LoadedFontTechniques>,
    options: { readonly signal?: AbortSignal } = {},
  ): Promise<unknown> {
    this.#assertActive();
    options.signal?.throwIfAborted();
    const rasterRequests = 'rasters' in request ? request.rasters : [request.raster];
    const font = await this.#loadRegisteredFont(request.input, rasterRequests, options.signal);
    this.#assertActive();
    options.signal?.throwIfAborted();
    this.#registerLegacyFont(font);
    if ('rasters' in request) {
      return Promise.all(
        request.rasters.map((raster) => this.#loadFontRaster(font, raster, options.signal)),
      ) as unknown as Promise<LoadedFonts<LoadedFontTechniques>>;
    }
    return this.#loadFontRaster(font, request.raster, options.signal);
  }

  async #loadFontRaster<Technique extends AnyRasterTechnique>(
    font: RegisteredFont,
    raster: RasterTechniqueRequest<Technique>,
    signal: AbortSignal | undefined,
  ): Promise<LoadedFont<Technique>> {
    const descriptor = techniqueOperations(raster.technique).descriptor(
      raster.options as RasterOptionsArgument<RasterOptionsOf<Technique>>,
    );
    const key = canonicalJson(descriptor);
    const loaded = this.#loaded.get(font)?.get(raster.technique)?.get(key);
    if (loaded !== undefined && !loaded.disposed) return loaded as LoadedFont<Technique>;
    const pending = this.#pending.get(font)?.get(raster.technique)?.get(key);
    if (pending !== undefined) return consumePending(pending.promise as Promise<LoadedFont<Technique>>, signal);

    const controller = new AbortController();
    const entry = {} as PendingTechniqueLoad;
    const promise = this.#loadTechnique(font, raster, descriptor, controller.signal).then(
      (value) => {
        this.#deletePending(font, raster.technique, key, entry);
        if (this.#disposed || controller.signal.aborted) {
          value.dispose();
          throw new FontLoadError('TEXT_RUNTIME_DISPOSED', 'text runtime was disposed during font loading');
        }
        this.#loadedMap(font, raster.technique).set(key, value as LoadedFont<AnyRasterTechnique>);
        return value;
      },
      (error: unknown) => {
        this.#deletePending(font, raster.technique, key, entry);
        throw error;
      },
    );
    Object.assign(entry, { controller, promise });
    this.#pendingMap(font, raster.technique).set(key, entry);
    return consumePending(promise, signal);
  }

  /**
   * Teardown is total: every stage runs even if an earlier one fails, so a single bad
   * font cannot strand the shaper instance and its Wasm memory. Failures are reported
   * rather than thrown, because this runs from `finally` blocks and unmount paths that
   * are frequently already unwinding an earlier error.
   */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
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
    for (const techniques of this.#pending.values()) {
      for (const loads of techniques.values()) {
        for (const pending of loads.values()) {
          try {
            pending.controller.abort();
          } catch (error) {
            report('aborting a pending font load', error);
          }
        }
      }
    }
    this.#pending.clear();
    for (const techniques of [...this.#loaded.values()]) {
      for (const fonts of [...techniques.values()]) {
        for (const font of [...fonts.values()]) {
          try {
            disposeLoadedFontFromRuntime(font);
          } catch (error) {
            report('disposing a loaded font', error);
          }
        }
      }
    }
    this.#loaded.clear();
    for (const font of [...this.#legacyShaperFonts]) {
      try {
        this.#runtimeRegistry.delete(font);
      } catch (error) {
        report('disposing a legacy shaping registration', error);
      }
    }
    this.#legacyShaperFonts.clear();
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
    }
  }

  async #loadRegisteredFont(
    input: LoadedFontInput,
    rasterRequests: readonly RasterTechniqueRequest<AnyRasterTechnique>[],
    signal: AbortSignal | undefined,
  ): Promise<RegisteredFont> {
    if ('baked' in input)
      return this.#defaultLoader.load({ baked: input.baked }, signal === undefined ? {} : { signal });
    const unicodeRanges = input.unicodeRanges === undefined ? undefined : normalizeUnicodeRanges(input.unicodeRanges);
    // Only Worker-embedded kinds ride the Worker font-bake plan. Every other
    // technique is left out of the plan on purpose: its raster misses in the
    // baked artifact and bakes host-side through the technique's own declared
    // runtime baker.
    const workerRequests = rasterRequests.filter((request) => workerRasterKinds.includes(request.technique.kind));
    const rasters = await Promise.all(workerRequests.map(runtimeBakeRaster));
    const planKey = canonicalJson({
      rasters,
      unicodeRanges: unicodeRanges ?? null,
    });
    let loaders = this.#sourceLoaders.get(input.runtimeBake);
    if (loaders === undefined) {
      loaders = new Map();
      this.#sourceLoaders.set(input.runtimeBake, loaders);
    }
    let loader = loaders.get(planKey);
    if (loader === undefined) {
      const runtimeBake: RuntimeFontBake = (request) =>
        input.runtimeBake({
          ...request,
          ...(unicodeRanges === undefined ? {} : { unicodeRanges }),
          rasters,
        });
      loader = new FontLoader({
        registry: this.#legacyRegistry,
        runtimeBake,
        ...(unicodeRanges === undefined ? {} : { runtimeSourceIdentity: 'transformed' }),
      });
      loaders.set(planKey, loader);
    }
    return loader.load({ source: input.source, baked: null }, signal === undefined ? {} : { signal });
  }

  async #loadTechnique<Technique extends AnyRasterTechnique>(
    font: RegisteredFont,
    request: RasterTechniqueRequest<Technique>,
    descriptor: RasterTechniqueTypesOf<Technique>['descriptor'],
    signal: AbortSignal,
  ): Promise<LoadedFont<Technique>> {
    const technique = request.technique;
    const rasterKey = await deriveRasterKey({
      descriptor,
      extension: technique.extension,
      kind: technique.kind,
      version: technique.version,
    });
    signal.throwIfAborted();
    let raster: RegisteredRaster<RasterKindOf<Technique>>;
    try {
      raster = (await font.loadRaster({ rasterKey, kind: technique.kind }, { signal })) as RegisteredRaster<
        RasterKindOf<Technique>
      >;
    } catch (error) {
      if (!isRasterMiss(error)) throw error;
      raster = await this.#runtimeBake(font, request, rasterKey, signal);
    }
    signal.throwIfAborted();
    let data: RasterDataOf<Technique>;
    try {
      data = await decodeTechnique(technique, font, raster, signal);
    } catch (error) {
      raster.dispose();
      throw error;
    }
    let value!: LoadedFontImpl<Technique>;
    value = new LoadedFontImpl({
      runtime: this,
      font,
      technique,
      raster,
      data,
      release: () => this.#releaseLoadedFont(value, canonicalJson(descriptor)),
    });
    return value;
  }

  async #runtimeBake<Technique extends AnyRasterTechnique>(
    font: RegisteredFont,
    request: RasterTechniqueRequest<Technique>,
    rasterKey: Awaited<ReturnType<typeof deriveRasterKey>>,
    signal: AbortSignal,
  ): Promise<RegisteredRaster<RasterKindOf<Technique>>> {
    const technique = request.technique;
    const loadBaker = techniqueOperations(technique).runtimeBaker;
    if (loadBaker === undefined) {
      throw new FontLoadError('RASTER_NOT_FOUND', `${technique.kind} has no baked artifact or runtime baker`);
    }
    const registered = getRegisteredFontData(font);
    if (registered.sourceBytes === undefined) {
      throw new FontLoadError(
        'RASTER_SOURCE_UNAVAILABLE',
        `${technique.kind} runtime generation requires retained source bytes`,
      );
    }
    const imported = await loadBaker();
    signal.throwIfAborted();
    const baker = 'default' in imported ? imported.default : imported;
    assertMatchingBaker(technique, baker);
    const bakeRequest = {
      source: registered.sourceBytes.slice(),
      font,
      fontFaceIndex: registered.fontFaceIndex,
      rasterKey,
      options: request.options as RasterOptionsArgument<RasterOptionsOf<Technique>>,
      signal,
    } as unknown as TechniqueRasterBakeRequest<RasterOptionsOf<Technique>>;
    const baked = await baker.bake(bakeRequest);
    assertMatchingArtifact(technique, rasterKey, baked);
    const artifacts = baked.artifacts.filter((artifact) => artifact.role === 'raster');
    if (artifacts.length !== 1) {
      throw new FontLoadError('INVALID_RASTER_ASSET', 'runtime raster generation must return one raster artifact');
    }
    const artifact = artifacts[0]!;
    const raster = await this.#legacyRegistry._attachGeneratedRaster(font, artifact.bytes, {
      rasterKey,
      kind: baked.kind,
      extension: baked.extension,
      version: baked.version,
    });
    return raster as RegisteredRaster<RasterKindOf<Technique>>;
  }

  #releaseLoadedFont<Technique extends AnyRasterTechnique>(font: LoadedFontImpl<Technique>, key: string): void {
    const techniques = this.#loaded.get(font.font);
    const fonts = techniques?.get(font.technique);
    if (fonts?.get(key) === font) fonts.delete(key);
    techniqueOperations(font.technique).dispose(font.data);
    font.raster.dispose();
    if (fonts?.size === 0) techniques?.delete(font.technique);
    if (techniques?.size === 0) {
      this.#loaded.delete(font.font);
      if (!this.#pending.has(font.font)) {
        this.#runtimeRegistry.delete(font.font);
        this.#legacyShaperFonts.delete(font.font);
        font.font.dispose();
      }
    }
  }

  #registerLegacyFont(font: RegisteredFont): void {
    this.#runtimeRegistry.add(font);
    try {
      this.#shaper.registerFont(font);
      this.#legacyShaperFonts.add(font);
    } catch (error) {
      this.#runtimeRegistry.delete(font);
      throw error;
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

  #loadedMap(font: RegisteredFont, technique: AnyRasterTechnique): Map<string, LoadedFont<AnyRasterTechnique>> {
    let techniques = this.#loaded.get(font);
    if (techniques === undefined) {
      techniques = new Map();
      this.#loaded.set(font, techniques);
    }
    let fonts = techniques.get(technique);
    if (fonts === undefined) {
      fonts = new Map();
      techniques.set(technique, fonts);
    }
    return fonts;
  }

  #pendingMap(font: RegisteredFont, technique: AnyRasterTechnique): Map<string, PendingTechniqueLoad> {
    let techniques = this.#pending.get(font);
    if (techniques === undefined) {
      techniques = new Map();
      this.#pending.set(font, techniques);
    }
    let loads = techniques.get(technique);
    if (loads === undefined) {
      loads = new Map();
      techniques.set(technique, loads);
    }
    return loads;
  }

  #deletePending(
    font: RegisteredFont,
    technique: AnyRasterTechnique,
    key: string,
    pending: PendingTechniqueLoad,
  ): void {
    const techniques = this.#pending.get(font);
    const loads = techniques?.get(technique);
    if (loads?.get(key) === pending) loads.delete(key);
    if (loads?.size === 0) techniques?.delete(technique);
    if (techniques?.size === 0) this.#pending.delete(font);
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('text runtime has been disposed');
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

async function runtimeBakeRaster(request: RasterTechniqueRequest<AnyRasterTechnique>): Promise<RuntimeBakeRaster> {
  const { technique } = request;
  const descriptor = techniqueOperations(technique).descriptor(
    request.options as RasterOptionsArgument<RasterOptionsOf<AnyRasterTechnique>>,
  );
  const rasterKey = await deriveRasterKey({
    descriptor,
    extension: technique.extension,
    kind: technique.kind,
    version: technique.version,
  });
  return {
    kind: technique.kind,
    extension: technique.extension,
    version: technique.version,
    rasterKey,
    descriptor,
  };
}

async function decodeTechnique<Technique extends AnyRasterTechnique>(
  technique: Technique,
  font: RegisteredFont,
  raster: RegisteredRaster<RasterKindOf<Technique>>,
  signal: AbortSignal,
): Promise<RasterDataOf<Technique>> {
  return techniqueOperations(technique).decode(font, raster, signal);
}

interface TechniqueOperations<Technique extends AnyRasterTechnique> {
  readonly runtimeBaker?: RuntimeRasterBakerLoader<RasterKindOf<Technique>, RasterOptionsOf<Technique>>;
  descriptor(
    options: RasterOptionsArgument<RasterOptionsOf<Technique>>,
  ): RasterTechniqueTypesOf<Technique>['descriptor'];
  decode(
    font: RegisteredFont,
    raster: RegisteredRaster<RasterKindOf<Technique>>,
    signal?: AbortSignal,
  ): Promise<RasterDataOf<Technique>>;
  dispose(data: RasterDataOf<Technique>): void;
}

function techniqueOperations<Technique extends AnyRasterTechnique>(
  technique: Technique,
): TechniqueOperations<Technique> {
  return technique as unknown as TechniqueOperations<Technique>;
}

function assertMatchingBaker<Options>(
  technique: AnyRasterTechnique,
  baker: RuntimeRasterBakerModule<string, Options>,
): void {
  if (baker.kind !== technique.kind) throw new FontLoadError('RASTER_INCOMPATIBLE', 'runtime baker kind mismatch');
}

function assertMatchingArtifact(technique: AnyRasterTechnique, rasterKey: string, artifact: RasterBakeArtifact): void {
  if (
    artifact.kind !== technique.kind ||
    artifact.extension !== technique.extension ||
    artifact.version !== technique.version ||
    artifact.rasterKey !== rasterKey
  ) {
    throw new FontLoadError('RASTER_INCOMPATIBLE', 'runtime raster artifact does not match the selected technique');
  }
}

function isRasterMiss(error: unknown): boolean {
  return error instanceof FontLoadError && error.code === 'RASTER_NOT_FOUND';
}

function consumePending<Value>(promise: Promise<Value>, signal: AbortSignal | undefined): Promise<Value> {
  if (signal === undefined) return promise;
  signal.throwIfAborted();
  return new Promise<Value>((resolve, reject) => {
    const abort = (): void => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    void promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}

export type { RuntimeFontBake, RuntimeFontBakeRequest };
