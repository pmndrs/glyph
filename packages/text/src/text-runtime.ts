import type { RasterBakeArtifact } from './bake.js';
import type { RegisteredFont } from './font.js';
import { disposeLoadedFontFromRuntime, LoadedFontImpl, type LoadedFont } from './loaded-font.js';
import {
  FontLoader,
  FontLoadError,
  FontRegistry,
  type RuntimeFontBake,
  type RuntimeFontBakeRequest,
} from './loader.js';
import { canonicalJson, deriveRasterKey } from './internal/raster-identity.js';
import { normalizeUnicodeRanges } from './internal/font-selection.js';
import type { RuntimeBakeRasterV0, RuntimeBakeUnicodeRangeV0 } from './internal/runtime-bake-protocol.js';
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

export interface TextRuntimeOptions {
  readonly registry?: FontRegistry;
  readonly wasm?: BufferSource | WebAssembly.Module;
}

export type LoadedFontInput =
  | { readonly baked: string | URL }
  | {
      readonly source: string | URL;
      readonly runtimeBake: RuntimeFontBake;
      readonly unicodeRanges?: readonly RuntimeBakeUnicodeRangeV0[];
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
  readonly registry: FontRegistry;
  readonly disposed: boolean;

  loadFont<Technique extends AnyRasterTechnique>(
    request: LoadedFontRequest<Technique>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<LoadedFont<Technique>>;

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

export async function createTextRuntime(options: TextRuntimeOptions = {}): Promise<TextRuntime> {
  const registry = options.registry ?? new FontRegistry();
  const shaper = await createRuntimeShaper({ registry, ...(options.wasm === undefined ? {} : { wasm: options.wasm }) });
  try {
    return new TextRuntimeImpl(registry, shaper);
  } catch (error) {
    shaper.dispose();
    throw error;
  }
}

/** @internal Rust-engine access for renderer integrations owned by this package. */
export function textRuntimeShaper(runtime: TextRuntime): RuntimeShaper {
  if (!(runtime instanceof TextRuntimeImpl)) throw new TypeError('text runtime was not created by this package');
  return runtime._shaper();
}

class TextRuntimeImpl implements TextRuntime {
  readonly registry: FontRegistry;
  readonly #shaper: RuntimeShaper;
  readonly #defaultLoader: FontLoader;
  readonly #sourceLoaders = new Map<RuntimeFontBake, Map<string, FontLoader>>();
  readonly #loaded = new Map<RegisteredFont, Map<AnyRasterTechnique, Map<string, LoadedFont<AnyRasterTechnique>>>>();
  readonly #pending = new Map<RegisteredFont, Map<AnyRasterTechnique, Map<string, PendingTechniqueLoad>>>();
  #disposed = false;

  constructor(registry: FontRegistry, shaper: RuntimeShaper) {
    this.registry = registry;
    this.#shaper = shaper;
    this.#defaultLoader = new FontLoader({ registry });
  }

  get disposed(): boolean {
    return this.#disposed;
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
    this.#shaper.registerFont(font);
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

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const techniques of this.#pending.values()) {
      for (const loads of techniques.values()) {
        for (const pending of loads.values()) pending.controller.abort();
      }
    }
    this.#pending.clear();
    for (const techniques of [...this.#loaded.values()]) {
      for (const fonts of [...techniques.values()]) {
        for (const font of [...fonts.values()]) disposeLoadedFontFromRuntime(font);
      }
    }
    this.#loaded.clear();
    this.#shaper.dispose();
  }

  async #loadRegisteredFont(
    input: LoadedFontInput,
    rasterRequests: readonly RasterTechniqueRequest<AnyRasterTechnique>[],
    signal: AbortSignal | undefined,
  ): Promise<RegisteredFont> {
    if ('baked' in input)
      return this.#defaultLoader.load({ baked: input.baked }, signal === undefined ? {} : { signal });
    const unicodeRanges = input.unicodeRanges === undefined ? undefined : normalizeUnicodeRanges(input.unicodeRanges);
    const rasters = await Promise.all(rasterRequests.map(runtimeBakeRaster));
    const planKey = canonicalJson({
      rasters,
      unicodeRanges: unicodeRanges ?? null,
    } as unknown as import('./raster.js').JsonValue);
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
        registry: this.registry,
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
    const raster = await this.registry._attachGeneratedRaster(font, artifact.bytes, {
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
      if (!this.#pending.has(font.font)) font.font.dispose();
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
}

async function runtimeBakeRaster(request: RasterTechniqueRequest<AnyRasterTechnique>): Promise<RuntimeBakeRasterV0> {
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
