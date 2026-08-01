import type { RasterBakeArtifact } from './bake.js';
import type { RegisteredFont } from './font.js';
import type { RasterKey } from './identity.js';
import { FontLoadError, registeredFontRegistry } from './loader.js';
import { canonicalJson, deriveRasterKey } from './internal/raster-identity.js';
import { getRegisteredFontData } from './internal/registered-font.js';
import type {
  AnyRasterModule,
  LoadedRaster,
  RasterKindOf,
  RasterLoadOptions,
  RasterRequest,
  RuntimeRasterBakerModule,
} from './raster.js';

type LoadedAnyRaster = LoadedRaster<AnyRasterModule>;

interface CachedRaster {
  readonly promise: Promise<LoadedAnyRaster>;
  readonly controller: AbortController;
  readonly descriptorKey: string;
  value: LoadedAnyRaster | undefined;
  consumers: number;
  settled: boolean;
}

interface ObservedRegistry {
  readonly fonts: Set<RegisteredFont>;
  readonly unsubscribe: () => void;
}

/**
 * Resolves, validates, decodes, and caches raster resources per font generation.
 * Failed loads are never retained, and font disposal releases decoded resources.
 */
export class RasterRuntime {
  readonly #fonts = new Map<RegisteredFont, Map<AnyRasterModule, Map<string, CachedRaster>>>();
  readonly #registries = new Map<ReturnType<typeof registeredFontRegistry>, ObservedRegistry>();
  #disposed = false;

  load<const Module extends AnyRasterModule>(
    font: RegisteredFont,
    request: RasterRequest<Module>,
    options: RasterLoadOptions = {},
  ): Promise<LoadedRaster<Module>> {
    this.#assertActive();
    options.signal?.throwIfAborted();
    return this.#load(font, request, options);
  }

  /** @internal Return a current decoded resource without crossing a Promise boundary. */
  _peek<const Module extends AnyRasterModule>(
    font: RegisteredFont,
    request: RasterRequest<Module>,
  ): LoadedRaster<Module> | undefined {
    this.#assertActive();
    const rasters = this.#fonts.get(font)?.get(request.module);
    if (rasters === undefined) return undefined;
    const descriptorKey = rasterDescriptorKey(request.module, request.options);
    for (const [rasterKey, cached] of rasters) {
      if (cached.descriptorKey !== descriptorKey || cached.value === undefined) continue;
      if (isCurrentRaster(font, rasterKey as RasterKey, cached.value.artifact)) {
        return cached.value as LoadedRaster<Module>;
      }
      rasters.delete(rasterKey);
      request.module.dispose(cached.value.resource);
      return undefined;
    }
    return undefined;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const { unsubscribe } of this.#registries.values()) unsubscribe();
    this.#registries.clear();
    for (const font of this.#fonts.keys()) this.#disposeFontResources(font);
  }

  async #load<Module extends AnyRasterModule>(
    font: RegisteredFont,
    request: RasterRequest<Module>,
    options: RasterLoadOptions,
  ): Promise<LoadedRaster<Module>> {
    const module = request.module;
    const descriptor = module.descriptor(request.options);
    const descriptorKey = rasterDescriptorKey(module, request.options, descriptor);
    const rasterKey = await deriveRasterKey({
      descriptor,
      extension: module.extension,
      kind: module.kind,
      version: module.version,
    });
    this.#assertActive();
    options.signal?.throwIfAborted();

    this.#observeRegistry(font);
    let modules = this.#fonts.get(font);
    if (modules === undefined) {
      modules = new Map();
      this.#fonts.set(font, modules);
    }
    let rasters = modules.get(module);
    if (rasters === undefined) {
      rasters = new Map();
      modules.set(module, rasters);
    }
    const existing = rasters.get(rasterKey);
    if (existing !== undefined) {
      if (existing.controller.signal.aborted) {
        if (rasters.get(rasterKey) === existing) rasters.delete(rasterKey);
        return this.#load(font, request, options);
      }
      const loaded = await consumeCachedRaster<Module>(existing, options.signal);
      if (this.#fonts.get(font)?.get(module)?.get(rasterKey) !== existing) {
        throw rasterLoadInvalidated();
      }
      if (isCurrentRaster(font, rasterKey, loaded.artifact)) return loaded;
      rasters.delete(rasterKey);
      module.dispose(loaded.resource);
      return this.#load(font, request, options);
    }

    const controller = new AbortController();
    const loadOptions: RasterLoadOptions = {
      ...(options.resolve === undefined ? {} : { resolve: options.resolve }),
      signal: controller.signal,
    };
    let cached!: CachedRaster;
    const promise = this.#loadUncached(font, request, rasterKey, loadOptions)
      .then((loaded) => {
        if (
          this.#disposed ||
          controller.signal.aborted ||
          this.#fonts.get(font)?.get(module)?.get(rasterKey) !== cached ||
          !isCurrentRaster(font, rasterKey, loaded.artifact)
        ) {
          module.dispose(loaded.resource);
          throw rasterLoadInvalidated();
        }
        return loaded;
      })
      .then(
        (loaded) => {
          cached.settled = true;
          cached.value = loaded;
          return loaded;
        },
        (error: unknown) => {
          cached.settled = true;
          if (rasters?.get(rasterKey) === cached) rasters.delete(rasterKey);
          throw error;
        },
      );
    cached = { promise, controller, descriptorKey, value: undefined, consumers: 0, settled: false };
    rasters.set(rasterKey, cached);
    return consumeCachedRaster<Module>(cached, options.signal);
  }

  async #loadUncached<Module extends AnyRasterModule>(
    font: RegisteredFont,
    request: RasterRequest<Module>,
    rasterKey: RasterKey,
    options: RasterLoadOptions,
  ): Promise<LoadedRaster<Module>> {
    const module = request.module;
    const kind = module.kind as RasterKindOf<Module>;
    let artifact: LoadedRaster<Module>['artifact'];
    try {
      artifact = await font.loadRaster({ rasterKey, kind }, options);
    } catch (error) {
      if (!isRasterMiss(error)) throw error;
      artifact = await this.#runtimeBake(font, request, rasterKey, options.signal);
    }
    options.signal?.throwIfAborted();
    const resource = await module.decode(font, artifact, options.signal);
    // The cache publication guard owns this resource once decode returns, including
    // disposal when a module ignores cancellation and completes after invalidation.
    return { module, artifact, resource };
  }

  async #runtimeBake<Module extends AnyRasterModule>(
    font: RegisteredFont,
    request: RasterRequest<Module>,
    rasterKey: RasterKey,
    signal: AbortSignal | undefined,
  ) {
    const loadBaker = request.module.runtimeBaker;
    if (loadBaker === undefined) {
      throw new FontLoadError('RASTER_NOT_FOUND', `${request.module.kind} has no baked artifact or runtime baker`);
    }
    const registeredData = getRegisteredFontData(font);
    const source = registeredData.sourceBytes;
    if (source === undefined) {
      throw new FontLoadError(
        'RASTER_SOURCE_UNAVAILABLE',
        `${request.module.kind} runtime generation requires retained source bytes`,
      );
    }
    signal?.throwIfAborted();
    const imported = await loadBaker();
    const baker = 'default' in imported ? imported.default : imported;
    assertMatchingBaker(request.module, baker);
    const baked = await baker.bake({
      source: source.slice(),
      font,
      fontFaceIndex: registeredData.fontFaceIndex,
      rasterKey,
      options: request.options,
      ...(signal === undefined ? {} : { signal }),
    });
    assertMatchingArtifact(request.module, rasterKey, baked);
    const rasterArtifacts = baked.artifacts.filter((artifact) => artifact.role === 'raster');
    if (rasterArtifacts.length !== 1) {
      throw new FontLoadError(
        'INVALID_RASTER_ASSET',
        'runtime raster generation must return one authoritative raster artifact',
      );
    }
    const rasterArtifact = rasterArtifacts[0];
    if (rasterArtifact === undefined) throw new Error('unreachable raster artifact state');
    const registered = await registeredFontRegistry(font)._attachGeneratedRaster(font, rasterArtifact.bytes, {
      rasterKey,
      kind: baked.kind,
      extension: baked.extension,
      version: baked.version,
    });
    if (registered.kind !== request.module.kind) {
      registered.dispose();
      throw new FontLoadError(
        'RASTER_INCOMPATIBLE',
        'registered runtime raster kind does not match the selected module',
      );
    }
    return registered as LoadedRaster<Module>['artifact'];
  }

  #observeRegistry(font: RegisteredFont): void {
    const registry = registeredFontRegistry(font);
    const observed = this.#registries.get(registry);
    if (observed !== undefined) {
      observed.fonts.add(font);
      return;
    }
    this.#registries.set(registry, {
      fonts: new Set([font]),
      unsubscribe: registry._onFontDispose((disposed) => this.#disposeFont(disposed, registry)),
    });
  }

  #disposeFont(font: RegisteredFont, registry: ReturnType<typeof registeredFontRegistry>): void {
    this.#disposeFontResources(font);
    const observed = this.#registries.get(registry);
    if (observed === undefined) return;
    observed.fonts.delete(font);
    if (observed.fonts.size === 0) {
      observed.unsubscribe();
      this.#registries.delete(registry);
    }
  }

  #disposeFontResources(font: RegisteredFont): void {
    const modules = this.#fonts.get(font);
    if (modules === undefined) return;
    this.#fonts.delete(font);
    for (const [module, rasters] of modules) {
      for (const { promise, controller } of rasters.values()) {
        controller.abort(rasterLoadInvalidated());
        void promise.then(
          ({ resource }) => module.dispose(resource),
          () => undefined,
        );
      }
    }
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('raster runtime is disposed');
  }
}

function rasterDescriptorKey(
  module: AnyRasterModule,
  options: unknown,
  descriptor = module.descriptor(options),
): string {
  return canonicalJson({ descriptor, extension: module.extension, kind: module.kind, version: module.version });
}

function isCurrentRaster(font: RegisteredFont, rasterKey: RasterKey, raster: LoadedAnyRaster['artifact']): boolean {
  try {
    return font.getRaster(rasterKey) === raster;
  } catch {
    return false;
  }
}

function rasterLoadInvalidated(): DOMException {
  return new DOMException('The raster load was invalidated', 'AbortError');
}

function isRasterMiss(error: unknown): boolean {
  return error instanceof FontLoadError && (error.code === 'RASTER_NOT_FOUND' || error.code === 'RASTER_FETCH');
}

function assertMatchingBaker(module: AnyRasterModule, baker: RuntimeRasterBakerModule<string, unknown>): void {
  if (baker.kind !== module.kind) {
    throw new FontLoadError('RASTER_INCOMPATIBLE', 'runtime raster baker kind does not match module');
  }
}

function assertMatchingArtifact(module: AnyRasterModule, rasterKey: RasterKey, artifact: RasterBakeArtifact): void {
  if (
    artifact.rasterKey !== rasterKey ||
    artifact.kind !== module.kind ||
    artifact.extension !== module.extension ||
    artifact.version !== module.version
  ) {
    throw new FontLoadError('RASTER_INCOMPATIBLE', 'runtime raster artifact does not match the selected module');
  }
}

function consumeCachedRaster<Module extends AnyRasterModule>(
  cached: CachedRaster,
  signal: AbortSignal | undefined,
): Promise<LoadedRaster<Module>> {
  signal?.throwIfAborted();
  cached.consumers += 1;
  return new Promise<LoadedRaster<Module>>((resolve, reject) => {
    let active = true;
    const release = (): void => {
      if (!active) return;
      active = false;
      signal?.removeEventListener('abort', aborted);
      cached.consumers -= 1;
      if (cached.consumers === 0 && !cached.settled) {
        cached.controller.abort(signal?.reason ?? rasterLoadInvalidated());
      }
    };
    const aborted = (): void => {
      release();
      reject(signal?.reason ?? rasterLoadInvalidated());
    };
    signal?.addEventListener('abort', aborted, { once: true });
    void (cached.promise as Promise<LoadedRaster<Module>>).then(
      (value) => {
        if (!active) return;
        release();
        resolve(value);
      },
      (error: unknown) => {
        if (!active) return;
        release();
        reject(error);
      },
    );
  });
}
