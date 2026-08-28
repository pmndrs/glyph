import * as THREE from 'three/webgpu';

import type { Font } from '../font.js';
import {
  assertFontLibrary,
  fontLoadSignal,
  immutableFontRequestKey,
  loadFont,
  type FontLibrary,
  type FontLoadOptions,
  type FontRasterInputs,
  type Fonts,
  type LoadFontInput,
  type RuntimeFontBake,
} from '../loader.js';
import type { AnyRasterTechnique, RasterTechniqueInput } from '../raster-technique.js';
import { acquireThreeLoaderDomain } from './engine-domain.js';

export interface ThreeFontLoaderOptions {
  readonly runtimeBake?: RuntimeFontBake;
  /** Optional application-owned immutable cache. The loader never disposes it. */
  readonly library?: FontLibrary;
}

/** Font request accepted by the Three LoadingManager adapter, with cancellation. */
export interface ThreeFontLoadRequest<Technique extends AnyRasterTechnique> {
  readonly input: LoadFontInput;
  readonly raster: RasterTechniqueInput<Technique>;
  readonly signal?: AbortSignal;
}

type LoaderDomain = ReturnType<typeof acquireThreeLoaderDomain>;

/** Three loading-manager adapter that returns canonical root-package Font values. */
export class FontLoader extends THREE.Loader<Font<AnyRasterTechnique>, ThreeFontLoadRequest<AnyRasterTechnique>> {
  readonly #options: ThreeFontLoaderOptions;
  #domain: LoaderDomain | undefined;
  #disposed = false;

  constructor(manager?: THREE.LoadingManager, options: ThreeFontLoaderOptions = {}) {
    super(manager);
    if (typeof options !== 'object' || options === null || Array.isArray(options)) {
      throw new TypeError('Three FontLoader options must be an object');
    }
    if (options.library !== undefined) assertFontLibrary(options.library, 'Three FontLoader library option');
    this.#options = options;
  }

  override load<Technique extends AnyRasterTechnique>(
    request: ThreeFontLoadRequest<Technique>,
    onLoad: (font: Font<Technique>) => void,
    _onProgress?: (event: ProgressEvent) => void,
    onError?: (error: unknown) => void,
  ): void {
    this.#assertActive();
    assertThreeFontLoadRequest(request);
    request.signal?.throwIfAborted();
    const normalizedInput = normalizeInput(request.input, this.#options.runtimeBake);
    immutableFontRequestKey(normalizedInput, request.raster);
    const item = requestUrl(request);
    this.manager.itemStart(item);
    void this.#load({ ...request, input: normalizedInput }).then(
      (font) => {
        this.manager.itemEnd(item);
        onLoad(font);
      },
      (error: unknown) => {
        this.manager.itemError(item);
        this.manager.itemEnd(item);
        onError?.(error);
      },
    );
  }

  override loadAsync<Technique extends AnyRasterTechnique>(
    request: ThreeFontLoadRequest<Technique>,
    onProgress?: (event: ProgressEvent) => void,
  ): Promise<Font<Technique>> {
    return new Promise((resolve, reject) => this.load(request, resolve, onProgress, reject));
  }

  /** Load a nonempty raster tuple and associate every Font with this Three loader domain. */
  async loadFontsAsync<const Rasters extends FontRasterInputs>(
    input: LoadFontInput,
    rasters: Rasters,
    options: FontLoadOptions = {},
  ): Promise<Fonts<Rasters>> {
    this.#assertActive();
    const signal = fontLoadSignal(options);
    signal?.throwIfAborted();
    const normalizedInput = normalizeInput(input, this.#options.runtimeBake);
    immutableFontRequestKey(normalizedInput, rasters);
    const item = requestInputUrl(input);
    this.manager.itemStart(item);
    let fonts: Fonts<Rasters> | undefined;
    try {
      const domain = this.#runtimeDomain();
      const loaded =
        this.#options.library?.loadFont(normalizedInput, rasters, signal === undefined ? {} : { signal }) ??
        loadFont(normalizedInput, rasters, signal === undefined ? {} : { signal });
      [fonts] = await Promise.all([loaded, domain.ready]);
      this.#assertActive();
      signal?.throwIfAborted();
      for (const font of fonts) domain.associate(font);
      return fonts;
    } catch (error) {
      if (fonts !== undefined) for (const font of fonts) font.dispose();
      this.manager.itemError(item);
      throw error;
    } finally {
      this.manager.itemEnd(item);
    }
  }

  /** Associate an independently loaded root Font with this loader's ready Three domain. */
  async initFont<Technique extends AnyRasterTechnique>(font: Font<Technique>): Promise<Font<Technique>> {
    this.#assertActive();
    const domain = this.#runtimeDomain();
    await domain.ready;
    this.#assertActive();
    domain.associate(font);
    return font;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#domain?.dispose();
    this.#domain = undefined;
  }

  async #load<Technique extends AnyRasterTechnique>(
    request: ThreeFontLoadRequest<Technique>,
  ): Promise<Font<Technique>> {
    const { input, raster, signal } = request;
    signal?.throwIfAborted();
    const domain = this.#runtimeDomain();
    const normalizedInput = normalizeInput(input, this.#options.runtimeBake);
    const loaded =
      this.#options.library?.loadFont(normalizedInput, raster, signal === undefined ? {} : { signal }) ??
      loadFont(normalizedInput, raster, signal === undefined ? {} : { signal });
    let font: Font<Technique> | undefined;
    try {
      [font] = await Promise.all([loaded, domain.ready]);
      this.#assertActive();
      signal?.throwIfAborted();
      domain.associate(font);
      return font;
    } catch (error) {
      font?.dispose();
      throw error;
    }
  }

  #runtimeDomain(): LoaderDomain {
    this.#domain ??= acquireThreeLoaderDomain(this.manager);
    return this.#domain;
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('Three FontLoader has been disposed');
  }
}

function normalizeInput(input: LoadFontInput, runtimeBake: RuntimeFontBake | undefined): LoadFontInput {
  if (typeof input === 'object' && input !== null && 'source' in input && !('runtimeBake' in input)) {
    if (runtimeBake === undefined) throw new TypeError('source font loading requires a runtime font baker');
    return { source: input.source, runtimeBake };
  }
  return input;
}

function assertThreeFontLoadRequest(value: unknown): asserts value is ThreeFontLoadRequest<AnyRasterTechnique> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Three font load request must be an object');
  }
  if (Object.keys(value).some((key) => key !== 'input' && key !== 'raster' && key !== 'signal')) {
    throw new TypeError('Three font load request only accepts input, raster, and signal');
  }
  const { signal } = value as { readonly signal?: unknown };
  fontLoadSignal(signal === undefined ? {} : { signal });
}

function requestUrl<Technique extends AnyRasterTechnique>(request: ThreeFontLoadRequest<Technique>): string {
  return requestInputUrl(request.input);
}

function requestInputUrl(input: LoadFontInput): string {
  if (typeof input === 'string' || input instanceof URL) return String(input);
  if ('baked' in input && input.baked !== null) return String(input.baked);
  return String(input.source);
}
