import * as THREE from 'three/webgpu';

import type { Font } from '../font.js';
import {
  assertFontLibrary,
  fontLoadSignal,
  immutableFontRequestKey,
  type FontLibrary,
  type FontLoadOptions,
  type FontRasterInputs,
  type Fonts,
  type LoadFontInput,
  type RuntimeFontBake,
} from '../loader.js';
import { glyphFontLibrary } from '../glyph.js';
import type { AnyRasterFormat, RasterFormatInput } from '../raster-format.js';

export interface ThreeFontLoaderOptions {
  readonly runtimeBake?: RuntimeFontBake;
  /** Optional application-owned immutable cache. The loader never disposes it. */
  readonly library?: FontLibrary;
}

/** Font request accepted by the Three LoadingManager adapter, with cancellation. */
export interface ThreeFontLoadRequest<Technique extends AnyRasterFormat> {
  readonly input: LoadFontInput;
  readonly raster: RasterFormatInput<Technique>;
  readonly signal?: AbortSignal;
}

/** Three loading-manager adapter that returns canonical root-package Font values. */
export class FontLoader extends THREE.Loader<Font<AnyRasterFormat>, ThreeFontLoadRequest<AnyRasterFormat>> {
  readonly #options: ThreeFontLoaderOptions;
  readonly #library: FontLibrary;
  #disposed = false;

  constructor(manager?: THREE.LoadingManager, options: ThreeFontLoaderOptions = {}) {
    super(manager);
    if (typeof options !== 'object' || options === null || Array.isArray(options)) {
      throw new TypeError('Three FontLoader options must be an object');
    }
    if (options.library !== undefined) assertFontLibrary(options.library, 'Three FontLoader library option');
    this.#options = options;
    this.#library = options.library ?? glyphFontLibrary();
  }

  override load<Technique extends AnyRasterFormat>(
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

  override loadAsync<Technique extends AnyRasterFormat>(
    request: ThreeFontLoadRequest<Technique>,
    onProgress?: (event: ProgressEvent) => void,
  ): Promise<Font<Technique>> {
    return new Promise((resolve, reject) => this.load(request, resolve, onProgress, reject));
  }

  /** Load a nonempty raster tuple through the canonical Glyph font loader. */
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
      fonts = await this.#library.loadFont(normalizedInput, rasters, signal === undefined ? {} : { signal });
      this.#assertActive();
      signal?.throwIfAborted();
      return fonts;
    } catch (error) {
      if (fonts !== undefined) for (const font of fonts) font.dispose();
      this.manager.itemError(item);
      throw error;
    } finally {
      this.manager.itemEnd(item);
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
  }

  async #load<Technique extends AnyRasterFormat>(request: ThreeFontLoadRequest<Technique>): Promise<Font<Technique>> {
    const { input, raster, signal } = request;
    signal?.throwIfAborted();
    const normalizedInput = normalizeInput(input, this.#options.runtimeBake);
    const loaded = this.#library.loadFont(normalizedInput, raster, signal === undefined ? {} : { signal });
    let font: Font<Technique> | undefined;
    try {
      font = await loaded;
      this.#assertActive();
      signal?.throwIfAborted();
      return font;
    } catch (error) {
      font?.dispose();
      throw error;
    }
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

function assertThreeFontLoadRequest(value: unknown): asserts value is ThreeFontLoadRequest<AnyRasterFormat> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Three font load request must be an object');
  }
  if (Object.keys(value).some((key) => key !== 'input' && key !== 'raster' && key !== 'signal')) {
    throw new TypeError('Three font load request only accepts input, raster, and signal');
  }
  const { signal } = value as { readonly signal?: unknown };
  fontLoadSignal(signal === undefined ? {} : { signal });
}

function requestUrl<Technique extends AnyRasterFormat>(request: ThreeFontLoadRequest<Technique>): string {
  return requestInputUrl(request.input);
}

function requestInputUrl(input: LoadFontInput): string {
  if (typeof input === 'string' || input instanceof URL) return String(input);
  if ('baked' in input && input.baked !== null) return String(input.baked);
  return String(input.source);
}
