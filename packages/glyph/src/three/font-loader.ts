import * as THREE from 'three/webgpu';

import type { Font } from '../font.js';
import {
  assertFontLibrary,
  loadFont,
  type FontLibrary,
  type FontRequest,
  type Fonts,
  type FontTechniques,
  type MultiRasterFontRequest,
  type RuntimeFontBake,
} from '../loader.js';
import type { AnyRasterTechnique } from '../raster-technique.js';
import { acquireThreeLoaderDomain } from './runtime-domain.js';

export interface ThreeFontLoaderOptions {
  readonly runtimeBake?: RuntimeFontBake;
  /** Optional application-owned immutable cache. The loader never disposes it. */
  readonly library?: FontLibrary;
}

/** Font request accepted by the Three LoadingManager adapter, with cancellation. */
export type ThreeLoadedFontRequest<Technique extends AnyRasterTechnique> = FontRequest<Technique> & {
  readonly signal?: AbortSignal;
};

type LoaderDomain = ReturnType<typeof acquireThreeLoaderDomain>;

/** Three loading-manager adapter that returns canonical root-package Font values. */
export class FontLoader extends THREE.Loader<Font<AnyRasterTechnique>, FontRequest<AnyRasterTechnique>> {
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
    request: ThreeLoadedFontRequest<Technique>,
    onLoad: (font: Font<Technique>) => void,
    _onProgress?: (event: ProgressEvent) => void,
    onError?: (error: unknown) => void,
  ): void {
    this.#assertActive();
    const item = requestUrl(request);
    this.manager.itemStart(item);
    void this.#load(request).then(
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
    request: ThreeLoadedFontRequest<Technique>,
    onProgress?: (event: ProgressEvent) => void,
  ): Promise<Font<Technique>> {
    return new Promise((resolve, reject) => this.load(request, resolve, onProgress, reject));
  }

  async loadFontsAsync<const Techniques extends FontTechniques>(
    request: MultiRasterFontRequest<Techniques> & { readonly signal?: AbortSignal },
  ): Promise<Fonts<Techniques>> {
    this.#assertActive();
    const item = requestInputUrl(request);
    this.manager.itemStart(item);
    let fonts: Fonts<Techniques> | undefined;
    try {
      const { signal, ...requested } = request;
      signal?.throwIfAborted();
      const domain = this.#runtimeDomain();
      const normalized = normalizeRequests(requested, this.#options.runtimeBake);
      const loaded =
        this.#options.library?.loadFont(normalized, signal === undefined ? {} : { signal }) ??
        loadFont(normalized, signal === undefined ? {} : { signal });
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
    request: ThreeLoadedFontRequest<Technique>,
  ): Promise<Font<Technique>> {
    const { signal, ...requested } = request;
    signal?.throwIfAborted();
    const domain = this.#runtimeDomain();
    const normalized = normalizeRequest(requested, this.#options.runtimeBake);
    const loaded =
      this.#options.library?.loadFont(normalized, signal === undefined ? {} : { signal }) ??
      loadFont(normalized, signal === undefined ? {} : { signal });
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

function normalizeRequest<Technique extends AnyRasterTechnique>(
  request: FontRequest<Technique>,
  runtimeBake: RuntimeFontBake | undefined,
): FontRequest<Technique> {
  if (
    typeof request.input === 'object' &&
    request.input !== null &&
    'source' in request.input &&
    !('runtimeBake' in request.input)
  ) {
    if (runtimeBake === undefined) throw new TypeError('source font loading requires a runtime font baker');
    return { ...request, input: { source: request.input.source, runtimeBake } };
  }
  return request;
}

function normalizeRequests<const Techniques extends FontTechniques>(
  request: MultiRasterFontRequest<Techniques>,
  runtimeBake: RuntimeFontBake | undefined,
): MultiRasterFontRequest<Techniques> {
  if (
    typeof request.input === 'object' &&
    request.input !== null &&
    'source' in request.input &&
    !('runtimeBake' in request.input)
  ) {
    if (runtimeBake === undefined) throw new TypeError('source font loading requires a runtime font baker');
    return { ...request, input: { source: request.input.source, runtimeBake } };
  }
  return request;
}

function requestUrl<Technique extends AnyRasterTechnique>(request: FontRequest<Technique>): string {
  return requestInputUrl(request);
}

function requestInputUrl(request: { readonly input: FontRequest<AnyRasterTechnique>['input'] }): string {
  if (typeof request.input === 'string' || request.input instanceof URL) return String(request.input);
  if ('baked' in request.input && request.input.baked !== null) return String(request.input.baked);
  return String(request.input.source);
}
