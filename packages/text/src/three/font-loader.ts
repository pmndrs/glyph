import * as THREE from 'three/webgpu';

import type { LoadedFont } from '../loaded-font.js';
import { observeLoadedFontDispose } from '../loaded-font.js';
import type { AnyRasterTechnique } from '../raster-technique.js';
import {
  createTextRuntime,
  type LoadedFontRequest,
  type TextPreparationWorker,
  type TextRuntime,
} from '../text-runtime.js';
import type { FontRegistry, RuntimeFontBake } from '../loader.js';

export interface ThreeFontLoaderOptions {
  readonly runtimeBake?: RuntimeFontBake;
  readonly createWorker?: () => TextPreparationWorker;
  /**
   * Registers loaded fonts in a registry the application already owns. Without one the runtime creates its own, and a
   * caller holding registry-scoped state cannot reach the fonts this loader produces.
   */
  readonly registry?: FontRegistry;
}

/** A font request that an application can cancel, matching the signal the core runtime already accepts. */
export type ThreeLoadedFontRequest<Technique extends AnyRasterTechnique> = LoadedFontRequest<Technique> & {
  readonly signal?: AbortSignal;
};

interface RuntimeDomain {
  readonly manager: THREE.LoadingManager;
  readonly runtime: Promise<TextRuntime>;
  readonly fonts: Set<LoadedFont<AnyRasterTechnique>>;
  loaderCount: number;
  disposed: boolean;
}

const domains = new WeakMap<THREE.LoadingManager, RuntimeDomain>();

export class FontLoader extends THREE.Loader<LoadedFont<AnyRasterTechnique>, LoadedFontRequest<AnyRasterTechnique>> {
  readonly #options: ThreeFontLoaderOptions;
  #domain: RuntimeDomain | undefined;
  #disposed = false;

  constructor(manager?: THREE.LoadingManager, options: ThreeFontLoaderOptions = {}) {
    super(manager);
    this.#options = options;
  }

  override load<Technique extends AnyRasterTechnique>(
    request: ThreeLoadedFontRequest<Technique>,
    onLoad: (font: LoadedFont<Technique>) => void,
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
  ): Promise<LoadedFont<Technique>> {
    return new Promise((resolve, reject) => this.load(request, resolve, onProgress, reject));
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const domain = this.#domain;
    this.#domain = undefined;
    if (domain !== undefined) {
      domain.loaderCount -= 1;
      maybeDisposeDomain(domain);
    }
  }

  async #load<Technique extends AnyRasterTechnique>(
    request: ThreeLoadedFontRequest<Technique>,
  ): Promise<LoadedFont<Technique>> {
    const { signal, ...requested } = request;
    const domain = this.#runtimeDomain();
    const runtime = await domain.runtime;
    this.#assertActive();
    signal?.throwIfAborted();
    const normalized = normalizeRequest(requested as LoadedFontRequest<Technique>, this.#options.runtimeBake);
    const font = await runtime.loadFont(normalized, signal === undefined ? {} : { signal });
    this.#assertActive();
    if (!domain.fonts.has(font)) {
      domain.fonts.add(font);
      observeLoadedFontDispose(font, () => {
        domain.fonts.delete(font);
        maybeDisposeDomain(domain);
      });
    }
    return font;
  }

  #runtimeDomain(): RuntimeDomain {
    if (this.#domain !== undefined) return this.#domain;
    let domain = domains.get(this.manager);
    if (domain === undefined || domain.disposed) {
      domain = {
        manager: this.manager,
        runtime: createTextRuntime({
          ...(this.#options.createWorker === undefined ? {} : { async: { createWorker: this.#options.createWorker } }),
          ...(this.#options.registry === undefined ? {} : { registry: this.#options.registry }),
        }),
        fonts: new Set(),
        loaderCount: 0,
        disposed: false,
      };
      domains.set(this.manager, domain);
      void domain.runtime.catch(() => {
        if (domains.get(this.manager) === domain) domains.delete(this.manager);
      });
    }
    domain.loaderCount += 1;
    this.#domain = domain;
    return domain;
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('Three font loader has been disposed');
  }
}

function normalizeRequest<Technique extends AnyRasterTechnique>(
  request: LoadedFontRequest<Technique>,
  runtimeBake: RuntimeFontBake | undefined,
): LoadedFontRequest<Technique> {
  if ('source' in request.input && request.input.runtimeBake === undefined) {
    if (runtimeBake === undefined) throw new TypeError('source font loading requires a runtime font baker');
    return { ...request, input: { ...request.input, runtimeBake } };
  }
  return request;
}

function requestUrl<Technique extends AnyRasterTechnique>(request: LoadedFontRequest<Technique>): string {
  return String('baked' in request.input ? request.input.baked : request.input.source);
}

function maybeDisposeDomain(domain: RuntimeDomain): void {
  if (domain.disposed || domain.loaderCount !== 0 || domain.fonts.size !== 0) return;
  domain.disposed = true;
  if (domains.get(domain.manager) === domain) domains.delete(domain.manager);
  void domain.runtime.then((runtime) => runtime.dispose());
}
