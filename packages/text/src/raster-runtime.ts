import type { RasterBakeArtifact } from './bake.js'
import type { RegisteredFont } from './font.js'
import type { RasterKey } from './identity.js'
import { FontLoadError, registeredFontRegistry } from './loader.js'
import { deriveRasterKey } from './internal/raster-identity.js'
import { getRegisteredFontData } from './internal/registered-font.js'
import type {
  AnyRasterModule,
  LoadedRaster,
  RasterKindOf,
  RasterLoadOptions,
  RasterRequest,
  RuntimeRasterBakerModule,
} from './raster.js'

type LoadedAnyRaster = LoadedRaster<AnyRasterModule>

interface CachedRaster {
  readonly promise: Promise<LoadedAnyRaster>
}

/**
 * Resolves, validates, decodes, and caches raster resources per font generation.
 * Failed loads are never retained, and font disposal releases decoded resources.
 */
export class RasterRuntime {
  readonly #fonts = new Map<RegisteredFont, Map<AnyRasterModule, Map<string, CachedRaster>>>()
  readonly #registries = new Map<ReturnType<typeof registeredFontRegistry>, () => void>()
  #disposed = false

  load<const Module extends AnyRasterModule>(
    font: RegisteredFont,
    request: RasterRequest<Module>,
    options: RasterLoadOptions = {},
  ): Promise<LoadedRaster<Module>> {
    this.#assertActive()
    options.signal?.throwIfAborted()
    return this.#load(font, request, options)
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    for (const unsubscribe of this.#registries.values()) unsubscribe()
    this.#registries.clear()
    for (const font of this.#fonts.keys()) this.#disposeFont(font)
  }

  async #load<Module extends AnyRasterModule>(
    font: RegisteredFont,
    request: RasterRequest<Module>,
    options: RasterLoadOptions,
  ): Promise<LoadedRaster<Module>> {
    const module = request.module
    const descriptor = module.descriptor(request.options)
    const rasterKey = await deriveRasterKey({
      descriptor,
      extension: module.extension,
      kind: module.kind,
      version: module.version,
    })
    options.signal?.throwIfAborted()

    this.#observeRegistry(font)
    let modules = this.#fonts.get(font)
    if (modules === undefined) {
      modules = new Map()
      this.#fonts.set(font, modules)
    }
    let rasters = modules.get(module)
    if (rasters === undefined) {
      rasters = new Map()
      modules.set(module, rasters)
    }
    const existing = rasters.get(rasterKey)
    if (existing !== undefined) {
      return awaitWithSignal(existing.promise as Promise<LoadedRaster<Module>>, options.signal)
    }

    const loadOptions = options.resolve === undefined ? {} : { resolve: options.resolve }
    const promise = this.#loadUncached(font, request, rasterKey, loadOptions).catch(
      (error: unknown) => {
        if (rasters?.get(rasterKey)?.promise === promise) rasters.delete(rasterKey)
        throw error
      },
    )
    rasters.set(rasterKey, { promise })
    return awaitWithSignal(promise, options.signal)
  }

  async #loadUncached<Module extends AnyRasterModule>(
    font: RegisteredFont,
    request: RasterRequest<Module>,
    rasterKey: RasterKey,
    options: RasterLoadOptions,
  ): Promise<LoadedRaster<Module>> {
    const module = request.module
    const kind = module.kind as RasterKindOf<Module>
    let artifact: LoadedRaster<Module>['artifact']
    try {
      artifact = await font.loadRaster({ rasterKey, kind }, options)
    } catch (error) {
      if (!isRasterMiss(error)) throw error
      artifact = await this.#runtimeBake(font, request, rasterKey, options.signal)
    }
    options.signal?.throwIfAborted()
    const resource = await module.decode(font, artifact, options.signal)
    options.signal?.throwIfAborted()
    return { module, artifact, resource }
  }

  async #runtimeBake<Module extends AnyRasterModule>(
    font: RegisteredFont,
    request: RasterRequest<Module>,
    rasterKey: RasterKey,
    signal: AbortSignal | undefined,
  ) {
    const loadBaker = request.module.runtimeBaker
    if (loadBaker === undefined) {
      throw new FontLoadError(
        'RASTER_NOT_FOUND',
        `${request.module.kind} has no baked artifact or runtime baker`,
      )
    }
    const source = getRegisteredFontData(font).sourceBytes
    if (source === undefined) {
      throw new FontLoadError(
        'RASTER_SOURCE_UNAVAILABLE',
        `${request.module.kind} runtime generation requires retained source bytes`,
      )
    }
    signal?.throwIfAborted()
    const imported = await loadBaker()
    const baker = 'default' in imported ? imported.default : imported
    assertMatchingBaker(request.module, baker)
    const baked = await baker.bake({
      source: source.slice(),
      font,
      fontFaceIndex: 0,
      rasterKey,
      options: request.options,
      ...(signal === undefined ? {} : { signal }),
    })
    assertMatchingArtifact(request.module, rasterKey, baked)
    const rasterArtifacts = baked.artifacts.filter((artifact) => artifact.role === 'raster')
    if (rasterArtifacts.length !== 1) {
      throw new FontLoadError(
        'INVALID_RASTER_ASSET',
        'runtime raster generation must return one authoritative raster artifact',
      )
    }
    const rasterArtifact = rasterArtifacts[0]
    if (rasterArtifact === undefined) throw new Error('unreachable raster artifact state')
    const registered = await registeredFontRegistry(font).attachRaster(font, rasterArtifact.bytes)
    if (registered.kind !== request.module.kind) {
      registered.dispose()
      throw new FontLoadError(
        'RASTER_INCOMPATIBLE',
        'registered runtime raster kind does not match the selected module',
      )
    }
    return registered as LoadedRaster<Module>['artifact']
  }

  #observeRegistry(font: RegisteredFont): void {
    const registry = registeredFontRegistry(font)
    if (this.#registries.has(registry)) return
    this.#registries.set(
      registry,
      registry._onFontDispose((disposed) => this.#disposeFont(disposed)),
    )
  }

  #disposeFont(font: RegisteredFont): void {
    const modules = this.#fonts.get(font)
    if (modules === undefined) return
    this.#fonts.delete(font)
    for (const [module, rasters] of modules) {
      for (const { promise } of rasters.values()) {
        void promise.then(
          ({ resource }) => module.dispose(resource),
          () => undefined,
        )
      }
    }
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('raster runtime is disposed')
  }
}

function isRasterMiss(error: unknown): boolean {
  return (
    error instanceof FontLoadError &&
    (error.code === 'RASTER_NOT_FOUND' || error.code === 'RASTER_FETCH')
  )
}

function assertMatchingBaker(
  module: AnyRasterModule,
  baker: RuntimeRasterBakerModule<string, unknown>,
): void {
  if (baker.kind !== module.kind) {
    throw new FontLoadError(
      'RASTER_INCOMPATIBLE',
      'runtime raster baker kind does not match module',
    )
  }
}

function assertMatchingArtifact(
  module: AnyRasterModule,
  rasterKey: RasterKey,
  artifact: RasterBakeArtifact,
): void {
  if (
    artifact.rasterKey !== rasterKey ||
    artifact.kind !== module.kind ||
    artifact.extension !== module.extension ||
    artifact.version !== module.version
  ) {
    throw new FontLoadError(
      'RASTER_INCOMPATIBLE',
      'runtime raster artifact does not match the selected module',
    )
  }
}

function awaitWithSignal<Value>(
  promise: Promise<Value>,
  signal: AbortSignal | undefined,
): Promise<Value> {
  if (signal === undefined) return promise
  signal.throwIfAborted()
  return new Promise<Value>((resolve, reject) => {
    const abort = (): void => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    void promise.then(
      (value) => {
        signal.removeEventListener('abort', abort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort)
        reject(error)
      },
    )
  })
}
