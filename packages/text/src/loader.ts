import type { ParsedGlb, ValidatedFontArtifactV0 } from '@pmndrs/text-font-baker/validate';
import {
  FONT_BAKER_VERSION as CORE_BAKER_VERSION,
  FONT_FORMAT_VERSION as CORE_FORMAT_VERSION,
} from '@pmndrs/text-font-baker/contract';

import type { FontInput, FontMetrics, RegisteredFont } from './font.js';
import type { FontHandle, FontKey, RasterHandle, RasterKey, Sha256Hex } from './identity.js';
import {
  deleteRegisteredFontData,
  getRegisteredFontData,
  setRegisteredFontData,
  type RegisteredBufferView,
  type RegisteredRasterResourceCandidate,
  type RegisteredRasterSourceData,
} from './internal/registered-font.js';
import type {
  JsonValue,
  RasterLoadOptions,
  RasterReference,
  RasterResourceResolver,
  RasterResourceSource,
  RasterSelection,
  RegisteredRaster,
} from './raster.js';
import type { BakeProgressListener } from './bake.js';
import type { RuntimeShaperFontData } from './shaper.js';

const DEFAULT_MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_BUFFER_VIEWS = 4_096;
const DEFAULT_MAX_RASTERS = 256;

let nextRegistryId = 1;
let nextFontHandle = 1;
let nextRasterHandle = 1;
let validatorPromise: Promise<typeof import('@pmndrs/text-font-baker/validate')> | undefined;
let defaultRuntimeBakePromise: Promise<RuntimeFontBake> | undefined;

export interface FontLoadOptions {
  readonly signal?: AbortSignal;
}

export interface FontLoadDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly url?: string;
  readonly cause?: unknown;
}

export interface RuntimeFontBakeRequest {
  readonly source: Uint8Array;
  readonly sourceUrl: string;
  readonly bakedUrl?: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: BakeProgressListener;
}

export type RuntimeFontBake = (request: RuntimeFontBakeRequest) => Promise<ArrayBufferView>;

export interface FontLoaderOptions {
  readonly registry?: FontRegistry;
  readonly baseUrl?: string | URL;
  readonly fetch?: typeof fetch;
  readonly development?: boolean;
  readonly runtimeBake?: RuntimeFontBake;
  readonly onDiagnostic?: (diagnostic: FontLoadDiagnostic) => void;
  readonly onWarning?: (diagnostic: FontLoadDiagnostic) => void;
}

export interface FontRegistryOptions {
  readonly maxArtifactBytes?: number;
  readonly maxBufferViews?: number;
  readonly maxRasters?: number;
}

export interface RasterAttachOptions {
  readonly baseUrl?: string | URL;
  readonly fetch?: typeof fetch;
  readonly resolveResource?: RasterResourceResolver;
}

interface FontAssetContext {
  readonly artifactUrl?: string;
  readonly sourceUrl?: string;
  readonly sourceBytes?: Uint8Array;
  readonly fetch?: typeof fetch;
}

interface SharedFontLoad {
  readonly controller: AbortController;
  promise: Promise<RegisteredFont>;
  value: RegisteredFont | undefined;
  consumers: number;
  settled: boolean;
}

export class FontLoadError extends Error {
  readonly code: string;
  readonly url: string | undefined;

  constructor(code: string, message: string, options: { url?: string; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'FontLoadError';
    this.code = code;
    this.url = options.url;
  }
}

export class FontRegistry {
  readonly #id: number;
  readonly #maxArtifactBytes: number;
  readonly #maxBufferViews: number;
  readonly #maxRasters: number;
  readonly #fontsByKey = new Map<FontKey, RegisteredFontImpl>();
  readonly #fontsByHash = new Map<Sha256Hex, RegisteredFontImpl>();
  readonly #fontsByHandle = new Map<FontHandle, RegisteredFontImpl>();
  readonly #disposeListeners = new Set<(font: RegisteredFont) => void>();

  constructor(options: FontRegistryOptions = {}) {
    this.#id = nextRegistryId++;
    this.#maxArtifactBytes = positiveLimit(options.maxArtifactBytes, DEFAULT_MAX_ARTIFACT_BYTES, 'maxArtifactBytes');
    this.#maxBufferViews = positiveLimit(options.maxBufferViews, DEFAULT_MAX_BUFFER_VIEWS, 'maxBufferViews');
    this.#maxRasters = positiveLimit(options.maxRasters, DEFAULT_MAX_RASTERS, 'maxRasters');
  }

  async registerAsset(bytes: ArrayBufferView): Promise<RegisteredFont> {
    return this._registerAsset(bytes);
  }

  get(key: FontKey): RegisteredFont | undefined {
    return this.#fontsByKey.get(key);
  }

  getByHandle(handle: FontHandle): RegisteredFont | undefined {
    return this.#fontsByHandle.get(handle);
  }

  /** @internal Register a shaping-only font replica inside a preparation Worker. */
  _registerShapingFont(data: RuntimeShaperFontData): RegisteredFont {
    const existing = this.#fontsByHandle.get(data.handle);
    if (existing !== undefined) {
      if (existing.shapingHash !== data.shapingHash)
        throw new TypeError('Worker font handle is already registered with another shaping identity');
      return existing;
    }
    const font = new RegisteredFontImpl({
      registry: this,
      key: data.key,
      handle: data.handle,
      shapingHash: data.shapingHash,
      glyphCount: data.glyphCount,
      metrics: data.metrics,
    });
    setRegisteredFontData(font, {
      fontFaceIndex: data.fontFaceIndex,
      sourceHash: data.sourceHash,
      sourceCandidates: [],
      shapingSfnt: data.shapingSfnt,
      glyphExtents: data.glyphExtents,
      glyphExtentsAvailability: data.glyphExtentsAvailability,
      rasterSources: new Map(),
      unicodeVersion: data.unicodeVersion,
    });
    this.#fontsByKey.set(data.key, font);
    this.#fontsByHash.set(data.shapingHash, font);
    this.#fontsByHandle.set(data.handle, font);
    return font;
  }

  /** @internal */
  async _registerAsset(bytes: ArrayBufferView, context: FontAssetContext = {}): Promise<RegisteredFont> {
    this.#checkArtifactSize(bytes.byteLength);
    const owned = copyView(bytes);
    const validator = await loadValidator();
    let validated: ValidatedFontArtifactV0;
    try {
      validated = await validator.validateFontArtifact(owned);
    } catch (error) {
      throw validationError('INVALID_FONT_ASSET', 'font artifact validation failed', error);
    }
    const document = validated.document;
    const fontExtension = requireNonArrayObject(
      requireNonArrayObject(document.extensions, 'extensions').PMNDRS_font,
      'PMNDRS_font',
    );
    const metricsValue = requireNonArrayObject(fontExtension.metrics, 'PMNDRS_font.metrics');
    const provenance = requireNonArrayObject(fontExtension.provenance, 'PMNDRS_font.provenance');
    const sourceHash = string(provenance.sourceHash, 'provenance.sourceHash');
    const fontFaceIndex = await authenticatedFontFaceIndex(provenance);
    if (context.sourceBytes !== undefined && (await sha256(context.sourceBytes)) !== sourceHash) {
      throw new FontLoadError('FONT_SOURCE_IDENTITY', 'runtime source bytes do not match the baked font provenance');
    }
    const references = rasterReferences(fontExtension.rasters);
    const parsed = validator.parseGlb(owned);
    const views = bufferViews(document, parsed.declaredBinLength);
    const binaryBytes = parsed.bin.slice(0, parsed.declaredBinLength);
    if (views.length > this.#maxBufferViews) {
      throw new FontLoadError(
        'FONT_RESOURCE_LIMIT',
        `font artifact has ${views.length} buffer views; limit is ${this.#maxBufferViews}`,
      );
    }
    if (references.length > this.#maxRasters) {
      throw new FontLoadError(
        'FONT_RESOURCE_LIMIT',
        `font artifact has ${references.length} raster references; limit is ${this.#maxRasters}`,
      );
    }
    const shapingHash = validated.shapingHash as Sha256Hex;
    const existing = this.#fontsByHash.get(shapingHash);
    if (existing !== undefined) {
      existing.assertActive();
      mergeRasterSources(existing, binaryBytes, document, views, references, context.artifactUrl, context.fetch);
      mergeSourceContext(existing, sourceHash, context);
      return existing;
    }

    const generation = nextFontHandle++;
    const key = `font:${this.#id}:${generation}:${shapingHash}` as FontKey;
    const handle = generation as FontHandle;
    const font = new RegisteredFontImpl({
      registry: this,
      key,
      handle,
      shapingHash,
      glyphCount: validated.glyphCount,
      metrics: {
        unitsPerEm: integer(metricsValue.unitsPerEm, 'metrics.unitsPerEm'),
        ascender: integer(metricsValue.ascender, 'metrics.ascender'),
        descender: integer(metricsValue.descender, 'metrics.descender'),
        lineGap: integer(metricsValue.lineGap, 'metrics.lineGap'),
      },
    });
    const rasterSources = new Map<string, RegisteredRasterSourceData>();
    setRegisteredFontData(font, {
      fontFaceIndex,
      sourceHash,
      ...(context.sourceBytes === undefined ? {} : { sourceBytes: context.sourceBytes.slice() }),
      sourceCandidates:
        context.sourceUrl === undefined
          ? []
          : [
              {
                sourceHash,
                sourceUrl: context.sourceUrl,
                ...(context.fetch === undefined ? {} : { fetch: context.fetch }),
              },
            ],
      shapingSfnt: validated.shapingSfnt,
      glyphExtents: validated.glyphExtents,
      glyphExtentsAvailability: validated.glyphExtentsAvailability,
      rasterSources,
      unicodeVersion: string(provenance.unicodeVersion, 'provenance.unicodeVersion'),
    });
    mergeRasterSources(font, binaryBytes, document, views, references, context.artifactUrl, context.fetch);
    this.#fontsByKey.set(key, font);
    this.#fontsByHash.set(shapingHash, font);
    this.#fontsByHandle.set(handle, font);
    return font;
  }

  async attachRaster(
    font: RegisteredFont,
    bytes: ArrayBufferView,
    options: RasterAttachOptions = {},
  ): Promise<RegisteredRaster> {
    let artifactUrl: string | undefined;
    if (options.baseUrl !== undefined) {
      try {
        artifactUrl = new URL(options.baseUrl).href;
      } catch (error) {
        throw new FontLoadError('INVALID_RASTER_BASE_URL', 'raster base URL is invalid', {
          cause: error,
        });
      }
    }
    return this._attachRaster(font, bytes, {
      ...(artifactUrl === undefined ? {} : { artifactUrl }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      ...(options.resolveResource === undefined ? {} : { resolveResource: options.resolveResource }),
    });
  }

  /** @internal */
  async _attachRaster(
    font: RegisteredFont,
    bytes: ArrayBufferView,
    context: RegisteredRasterResourceCandidate = {},
  ): Promise<RegisteredRaster> {
    const registered = this.#ownedFont(font);
    this.#checkArtifactSize(bytes.byteLength);
    const owned = copyView(bytes);
    const validator = await loadValidator();
    let parsed: ParsedGlb;
    try {
      parsed = validator.parseGlb(owned);
      await validator.validateWithKhronos(owned, parsed.document);
    } catch (error) {
      throw validationError('INVALID_RASTER_ASSET', 'raster artifact validation failed', error);
    }
    const views = bufferViews(parsed.document, parsed.declaredBinLength);
    if (views.length > this.#maxBufferViews) {
      throw new FontLoadError(
        'FONT_RESOURCE_LIMIT',
        `raster artifact has ${views.length} buffer views; limit is ${this.#maxBufferViews}`,
      );
    }
    const match = matchRasterExtension(registered, parsed.document);
    if (match.reference.source.type === 'external' && match.reference.source.artifactHash !== undefined) {
      const actual = await sha256(owned);
      if (actual !== match.reference.source.artifactHash) {
        throw new FontLoadError(
          'RASTER_ARTIFACT_HASH',
          'external raster artifact hash does not match its font directory entry',
        );
      }
    }
    return registered.registerRaster(
      match.reference,
      match.extensionData,
      parsed.bin.slice(0, parsed.declaredBinLength),
      views,
      [context],
    );
  }

  /** @internal Attach a runtime-generated raster against its caller-authenticated identity. */
  async _attachGeneratedRaster(
    font: RegisteredFont,
    bytes: ArrayBufferView,
    expected: Omit<RasterReference, 'source'>,
  ): Promise<RegisteredRaster> {
    const registered = this.#ownedFont(font);
    this.#checkArtifactSize(bytes.byteLength);
    const owned = copyView(bytes);
    const validator = await loadValidator();
    let parsed: ParsedGlb;
    try {
      parsed = validator.parseGlb(owned);
      await validator.validateWithKhronos(owned, parsed.document);
    } catch (error) {
      throw validationError('INVALID_RASTER_ASSET', 'raster artifact validation failed', error);
    }
    const views = bufferViews(parsed.document, parsed.declaredBinLength);
    if (views.length > this.#maxBufferViews) {
      throw new FontLoadError(
        'FONT_RESOURCE_LIMIT',
        `raster artifact has ${views.length} buffer views; limit is ${this.#maxBufferViews}`,
      );
    }
    const reference: RasterReference = { ...expected, source: { type: 'external' } };
    const extensionData = generatedRasterExtension(registered, parsed.document, reference);
    const binaryBytes = parsed.bin.slice(0, parsed.declaredBinLength);
    getRegisteredFontData(registered).rasterSources.set(reference.rasterKey, {
      reference,
      extensionData,
      binaryBytes,
      bufferViews: views,
      externalCandidates: [],
      resourceCandidates: [],
    });
    return registered.registerRaster(reference, extensionData, binaryBytes, views, []);
  }

  /** @internal */
  _disposeFont(font: RegisteredFontImpl): void {
    if (this.#fontsByKey.get(font.key) !== font) return;
    this.#fontsByKey.delete(font.key);
    this.#fontsByHash.delete(font.shapingHash);
    this.#fontsByHandle.delete(font.handle);
    for (const listener of this.#disposeListeners) listener(font);
    deleteRegisteredFontData(font);
  }

  /** @internal */
  _onFontDispose(listener: (font: RegisteredFont) => void): () => void {
    this.#disposeListeners.add(listener);
    return () => this.#disposeListeners.delete(listener);
  }

  /** @internal */
  _artifactByteLimit(): number {
    return this.#maxArtifactBytes;
  }

  #ownedFont(font: RegisteredFont): RegisteredFontImpl {
    if (!(font instanceof RegisteredFontImpl) || font.registry !== this) {
      throw new FontLoadError('FOREIGN_FONT', 'font is not owned by this registry');
    }
    font.assertActive();
    return font;
  }

  #checkArtifactSize(byteLength: number): void {
    if (byteLength > this.#maxArtifactBytes) {
      throw new FontLoadError(
        'FONT_RESOURCE_LIMIT',
        `artifact has ${byteLength} bytes; limit is ${this.#maxArtifactBytes}`,
      );
    }
  }
}

export class FontLoader {
  readonly registry: FontRegistry;
  readonly #fetch: typeof fetch;
  readonly #baseUrl: URL | undefined;
  readonly #development: boolean;
  readonly #runtimeBake: RuntimeFontBake | undefined;
  readonly #onDiagnostic: ((diagnostic: FontLoadDiagnostic) => void) | undefined;
  readonly #onWarning: ((diagnostic: FontLoadDiagnostic) => void) | undefined;
  readonly #loads = new Map<string, SharedFontLoad>();
  readonly #warnedMissing = new Set<string>();

  constructor(options: FontLoaderOptions = {}) {
    this.registry = options.registry ?? new FontRegistry();
    const fetcher = options.fetch ?? globalThis.fetch;
    if (typeof fetcher !== 'function') {
      throw new TypeError('FontLoader requires a fetch implementation');
    }
    this.#fetch = (...arguments_: Parameters<typeof fetch>) => fetcher(...arguments_);
    this.#baseUrl = resolveBaseUrl(options.baseUrl);
    this.#development = options.development ?? defaultDevelopmentMode();
    this.#runtimeBake = options.runtimeBake;
    this.#onDiagnostic = options.onDiagnostic;
    this.#onWarning = options.onWarning;
  }

  load(input: FontInput, options: FontLoadOptions = {}): Promise<RegisteredFont> {
    options.signal?.throwIfAborted();
    const request = resolveFontRequest(input, this.#baseUrl);
    const key = requestKey(request);
    const shared = this.#sharedLoad(request, key);
    const active = consumeSharedLoad(shared, options.signal).then((font) => {
      if (this.registry.get(font.key) === font) return font;
      if (this.#loads.get(key) === shared) this.#loads.delete(key);
      return consumeSharedLoad(this.#sharedLoad(request, key), options.signal);
    });
    return active;
  }

  /** @internal Return a currently registered load without crossing a Promise boundary. */
  _peek(input: FontInput): RegisteredFont | undefined {
    const request = resolveFontRequest(input, this.#baseUrl);
    const key = requestKey(request);
    const shared = this.#loads.get(key);
    const font = shared?.value;
    if (font === undefined) return undefined;
    if (this.registry.get(font.key) === font) return font;
    if (this.#loads.get(key) === shared) this.#loads.delete(key);
    return undefined;
  }

  #sharedLoad(request: ResolvedFontRequest, key: string): SharedFontLoad {
    let shared = this.#loads.get(key);
    if (shared?.controller.signal.aborted === true) {
      this.#loads.delete(key);
      shared = undefined;
    }
    if (shared === undefined) {
      const controller = new AbortController();
      let created!: SharedFontLoad;
      const promise = this.#load(request, controller.signal).then(
        (font) => {
          created.settled = true;
          created.value = font;
          return font;
        },
        (error: unknown) => {
          created.settled = true;
          if (this.#loads.get(key) === created) this.#loads.delete(key);
          throw error;
        },
      );
      created = {
        controller,
        value: undefined,
        consumers: 0,
        settled: false,
        promise,
      };
      shared = created;
      this.#loads.set(key, shared);
    }
    return shared;
  }

  attachRaster(font: RegisteredFont, bytes: ArrayBufferView): Promise<RegisteredRaster> {
    return this.registry.attachRaster(font, bytes);
  }

  async #load(request: ResolvedFontRequest, signal: AbortSignal): Promise<RegisteredFont> {
    if (request.bakedUrl !== undefined) {
      const probe = await this.#probe(request.bakedUrl, signal, request.sourceUrl);
      if (probe.status === 'hit') return probe.font;
      if (request.sourceUrl === undefined) {
        if (probe.status === 'missing') {
          throw new FontLoadError('BAKED_FONT_MISSING', 'baked-only font asset was not found', {
            url: request.bakedUrl,
          });
        }
        throw probe.error;
      }
      if (probe.status === 'missing') this.#warnMissing(request.bakedUrl);
      else this.#emitDiagnostic(probe.error);
    }
    if (request.sourceUrl === undefined) {
      throw new FontLoadError('INVALID_FONT_INPUT', 'font request has no source or baked URL');
    }
    const runtimeBake = this.#runtimeBake ?? (await loadDefaultRuntimeBake(request.sourceUrl));
    signal.throwIfAborted();
    const source = await this.#fetchRequired(request.sourceUrl, 'FONT_SOURCE_FETCH', signal);
    const baked = await runtimeBake({
      source,
      sourceUrl: request.sourceUrl,
      ...(request.bakedUrl === undefined ? {} : { bakedUrl: request.bakedUrl }),
      signal,
    });
    signal.throwIfAborted();
    return this.registry._registerAsset(baked, {
      ...(request.bakedUrl === undefined ? {} : { artifactUrl: request.bakedUrl }),
      sourceUrl: request.sourceUrl,
      sourceBytes: source,
      fetch: this.#fetch,
    });
  }

  async #probe(url: string, signal: AbortSignal, sourceUrl?: string): Promise<ProbeResult> {
    let response: Response;
    try {
      response = await this.#fetch(url, { signal });
    } catch (cause) {
      signal.throwIfAborted();
      return {
        status: 'invalid',
        error: new FontLoadError('BAKED_FONT_FETCH', 'baked font request failed', { url, cause }),
      };
    }
    if (response.status === 404 || response.status === 410) return { status: 'missing' };
    if (!response.ok) {
      return {
        status: 'invalid',
        error: new FontLoadError('BAKED_FONT_FETCH', `baked font request failed with HTTP ${response.status}`, { url }),
      };
    }
    try {
      const bytes = await readResponseBytes(
        response,
        this.registry._artifactByteLimit(),
        'FONT_RESOURCE_LIMIT',
        url,
        signal,
      );
      signal.throwIfAborted();
      const font = await this.registry._registerAsset(bytes, {
        artifactUrl: url,
        ...(sourceUrl === undefined ? {} : { sourceUrl }),
        fetch: this.#fetch,
      });
      return { status: 'hit', font };
    } catch (cause) {
      signal.throwIfAborted();
      const incompatible = hasValidationIssue(cause, 'FONT_VERSION_INCOMPATIBLE');
      const resourceLimited = cause instanceof FontLoadError && cause.code === 'FONT_RESOURCE_LIMIT';
      return {
        status: 'invalid',
        error: new FontLoadError(
          incompatible
            ? 'BAKED_FONT_INCOMPATIBLE'
            : resourceLimited
              ? 'BAKED_FONT_RESOURCE_LIMIT'
              : 'BAKED_FONT_INVALID',
          incompatible
            ? 'baked font asset uses an incompatible version contract'
            : resourceLimited
              ? 'baked font asset exceeds a configured resource limit'
              : 'baked font asset is invalid',
          { url, cause },
        ),
      };
    }
  }

  async #fetchRequired(url: string, code: string, signal: AbortSignal): Promise<Uint8Array> {
    let response: Response;
    try {
      response = await this.#fetch(url, { signal });
    } catch (cause) {
      signal.throwIfAborted();
      throw new FontLoadError(code, 'font source request failed', { url, cause });
    }
    if (!response.ok) {
      throw new FontLoadError(code, `font source request failed with HTTP ${response.status}`, {
        url,
      });
    }
    return readResponseBytes(response, this.registry._artifactByteLimit(), 'FONT_SOURCE_RESOURCE_LIMIT', url, signal);
  }

  #warnMissing(url: string): void {
    if (!this.#development || this.#warnedMissing.has(url)) return;
    this.#warnedMissing.add(url);
    const diagnostic = {
      code: 'BAKED_FONT_MISSING',
      message: `No baked font asset was found at ${url}; using the runtime baker.`,
      url,
    };
    if (this.#onWarning !== undefined) this.#onWarning(diagnostic);
    else console.warn(diagnostic.message);
  }

  #emitDiagnostic(error: FontLoadError): void {
    this.#onDiagnostic?.({
      code: error.code,
      message: error.message,
      ...(error.url === undefined ? {} : { url: error.url }),
      ...(error.cause === undefined ? {} : { cause: error.cause }),
    });
  }
}

async function loadDefaultRuntimeBake(sourceUrl: string): Promise<RuntimeFontBake> {
  defaultRuntimeBakePromise ??= import('./runtime-bake.js')
    .then(({ bakeFontInWorker }) => bakeFontInWorker)
    .catch((cause: unknown) => {
      defaultRuntimeBakePromise = undefined;
      throw new FontLoadError(
        'RUNTIME_BAKER_UNAVAILABLE',
        'font source requires the dynamically imported runtime baker',
        { url: sourceUrl, cause },
      );
    });
  return defaultRuntimeBakePromise;
}

interface ResolvedFontRequest {
  readonly sourceUrl?: string;
  readonly bakedUrl?: string;
}

type ProbeResult =
  | { readonly status: 'hit'; readonly font: RegisteredFont }
  | { readonly status: 'missing' }
  | { readonly status: 'invalid'; readonly error: FontLoadError };

interface RegisteredFontInit {
  readonly registry: FontRegistry;
  readonly key: FontKey;
  readonly handle: FontHandle;
  readonly shapingHash: Sha256Hex;
  readonly glyphCount: number;
  readonly metrics: FontMetrics;
}

class RegisteredFontImpl implements RegisteredFont {
  readonly registry: FontRegistry;
  readonly key: FontKey;
  readonly handle: FontHandle;
  readonly shapingHash: Sha256Hex;
  readonly glyphCount: number;
  readonly glyphIdWidth = 16 as const;
  readonly metrics: FontMetrics;
  readonly #rasters = new Map<string, RegisteredRasterImpl>();
  #disposed = false;

  constructor(init: RegisteredFontInit) {
    this.registry = init.registry;
    this.key = init.key;
    this.handle = init.handle;
    this.shapingHash = init.shapingHash;
    this.glyphCount = init.glyphCount;
    this.metrics = Object.freeze({ ...init.metrics });
  }

  get rasterReferences(): readonly RasterReference[] {
    this.assertActive();
    return [...getRegisteredFontData(this).rasterSources.values()].map(({ reference }) => reference);
  }

  getRaster(rasterKey: RasterKey | string): RegisteredRaster | undefined {
    this.assertActive();
    return this.#rasters.get(rasterKey);
  }

  async loadRaster<const Kind extends string>(
    selection: RasterSelection<Kind> & { readonly kind: Kind },
    options?: RasterLoadOptions,
  ): Promise<RegisteredRaster<Kind>>;

  async loadRaster(selection: RasterSelection, options?: RasterLoadOptions): Promise<RegisteredRaster>;

  async loadRaster(selection: RasterSelection, options: RasterLoadOptions = {}): Promise<RegisteredRaster> {
    this.assertActive();
    options.signal?.throwIfAborted();
    const existing = this.#rasters.get(selection.rasterKey);
    if (existing !== undefined) {
      existing.addResourceCandidates(withResourceResolver([], options.resolveResource));
      return existing;
    }
    const source = getRegisteredFontData(this).rasterSources.get(selection.rasterKey);
    if (source === undefined || (selection.kind !== undefined && selection.kind !== source.reference.kind)) {
      throw new FontLoadError('RASTER_NOT_FOUND', 'font has no matching raster reference');
    }
    if (source.extensionData !== undefined && source.binaryBytes !== undefined && source.bufferViews !== undefined) {
      return this.registerRaster(
        source.reference,
        source.extensionData,
        source.binaryBytes,
        source.bufferViews,
        withResourceResolver(source.resourceCandidates, options.resolveResource),
      );
    }
    const resolved = await options.resolve?.({
      font: this,
      reference: source.reference,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    options.signal?.throwIfAborted();
    if (resolved !== undefined) {
      return this.registry._attachRaster(this, resolved, {
        ...(options.resolveResource === undefined ? {} : { resolveResource: options.resolveResource }),
      });
    }
    if (source.externalCandidates.length === 0) {
      throw new FontLoadError('RASTER_NOT_FOUND', 'raster reference has no resolvable artifact');
    }
    const failures: unknown[] = [];
    for (const candidate of source.externalCandidates) {
      if (!('uri' in candidate.source)) continue;
      if (candidate.source.artifactHash === undefined) {
        failures.push(
          new FontLoadError(
            'RASTER_ARTIFACT_HASH_REQUIRED',
            'URI-addressed raster artifacts require an authenticated hash',
            { url: candidate.source.uri },
          ),
        );
        continue;
      }
      let url: string;
      try {
        url = new URL(candidate.source.uri, candidate.artifactUrl).href;
      } catch (error) {
        failures.push(error);
        continue;
      }
      const fetcher = candidate.fetch ?? globalThis.fetch;
      if (typeof fetcher !== 'function') {
        failures.push(new TypeError('no fetch implementation is available'));
        continue;
      }
      try {
        const response = await fetcher(url, options.signal === undefined ? undefined : { signal: options.signal });
        if (!response.ok) {
          throw new FontLoadError('RASTER_FETCH', `raster request failed with HTTP ${response.status}`, { url });
        }
        return this.registry._attachRaster(
          this,
          await readResponseBytes(response, this.registry._artifactByteLimit(), 'RASTER_RESOURCE_LIMIT', url),
          {
            artifactUrl: url,
            fetch: fetcher,
            ...(options.resolveResource === undefined ? {} : { resolveResource: options.resolveResource }),
          },
        );
      } catch (error) {
        options.signal?.throwIfAborted();
        if (error instanceof FontLoadError && error.code === 'RASTER_RESOURCE_LIMIT') throw error;
        failures.push(error);
      }
    }
    throw new FontLoadError('RASTER_FETCH', 'no external raster candidate could be loaded', {
      cause: new AggregateError(failures),
    });
  }

  registerRaster(
    reference: RasterReference,
    extensionData: JsonValue,
    binaryBytes: Uint8Array,
    views: readonly RegisteredBufferView[],
    resourceCandidates: readonly RegisteredRasterResourceCandidate[],
  ): RegisteredRaster {
    this.assertActive();
    const existing = this.#rasters.get(reference.rasterKey);
    if (existing !== undefined) {
      existing.addResourceCandidates(resourceCandidates);
      return existing;
    }
    const raster = new RegisteredRasterImpl({
      owner: this,
      reference,
      extensionData,
      binaryBytes,
      views,
      resourceCandidates,
      handle: nextRasterHandle++ as RasterHandle,
    });
    this.#rasters.set(reference.rasterKey, raster);
    return raster;
  }

  removeRaster(raster: RegisteredRasterImpl): void {
    if (this.#rasters.get(raster.rasterKey) === raster) this.#rasters.delete(raster.rasterKey);
  }

  assertActive(): void {
    if (this.#disposed) throw new FontLoadError('STALE_FONT_HANDLE', 'font has been disposed');
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const raster of this.#rasters.values()) raster.disposeFromOwner();
    this.#rasters.clear();
    this.registry._disposeFont(this);
  }
}

/** @internal Return the active ownership domain for a package-created font. */
export function registeredFontRegistry(font: RegisteredFont): FontRegistry {
  if (!(font instanceof RegisteredFontImpl)) {
    throw new FontLoadError('FOREIGN_FONT', 'font is not registered by this package');
  }
  font.assertActive();
  return font.registry;
}

/** @internal Narrow an unknown value without trusting structural imitation. */
export function isPackageRegisteredFont(value: unknown): value is RegisteredFont {
  return value instanceof RegisteredFontImpl;
}

interface RegisteredRasterInit {
  readonly owner: RegisteredFontImpl;
  readonly reference: RasterReference;
  readonly extensionData: JsonValue;
  readonly binaryBytes: Uint8Array;
  readonly views: readonly RegisteredBufferView[];
  readonly resourceCandidates: readonly RegisteredRasterResourceCandidate[];
  readonly handle: RasterHandle;
}

class RegisteredRasterImpl implements RegisteredRaster {
  readonly #owner: RegisteredFontImpl;
  readonly #binaryBytes: Uint8Array;
  readonly #views: readonly RegisteredBufferView[];
  readonly #reference: RasterReference;
  readonly #resourceCandidates: RegisteredRasterResourceCandidate[];
  readonly rasterKey: RasterKey;
  readonly handle: RasterHandle;
  readonly font: FontHandle;
  readonly kind: string;
  readonly extension: string;
  readonly version: number;
  readonly extensionData: JsonValue;
  #disposed = false;

  constructor(init: RegisteredRasterInit) {
    this.#owner = init.owner;
    this.#binaryBytes = init.binaryBytes;
    this.#views = init.views;
    this.#reference = freezeReference(init.reference);
    this.#resourceCandidates = mergeResourceCandidates([], init.resourceCandidates);
    this.rasterKey = init.reference.rasterKey;
    this.handle = init.handle;
    this.font = init.owner.handle;
    this.kind = init.reference.kind;
    this.extension = init.reference.extension;
    this.version = init.reference.version;
    this.extensionData = deepFreeze(structuredClone(init.extensionData));
  }

  view(bufferView: number): Uint8Array {
    this.#assertActive();
    const view = this.#views[bufferView];
    if (view === undefined) throw new RangeError(`bufferView ${bufferView} is out of range`);
    return this.#binaryBytes.slice(view.byteOffset, view.byteOffset + view.byteLength);
  }

  async resource(source: RasterResourceSource, signal?: AbortSignal): Promise<Uint8Array> {
    this.#assertActive();
    signal?.throwIfAborted();
    if (source.type === 'bufferView') return this.view(source.bufferView);
    assertExternalResourceSource(source);
    if (source.byteLength > this.#owner.registry._artifactByteLimit()) {
      throw new FontLoadError(
        'RASTER_RESOURCE_LIMIT',
        'external raster resource exceeds the configured resource limit',
      );
    }

    const failures: unknown[] = [];
    for (const candidate of this.#resourceCandidates) {
      if (candidate.resolveResource !== undefined) {
        try {
          const resolved = await candidate.resolveResource({
            font: this.#owner,
            reference: this.#reference,
            source,
            ...(signal === undefined ? {} : { signal }),
          });
          signal?.throwIfAborted();
          if (resolved !== undefined) {
            if (resolved.byteLength > this.#owner.registry._artifactByteLimit()) {
              throw new FontLoadError(
                'RASTER_RESOURCE_LIMIT',
                'resolved raster resource exceeds the configured resource limit',
              );
            }
            return authenticateRasterResource(copyView(resolved), source);
          }
        } catch (error) {
          signal?.throwIfAborted();
          if (error instanceof FontLoadError && error.code === 'RASTER_RESOURCE_LIMIT') throw error;
          failures.push(error);
        }
      }

      let url: string;
      try {
        url =
          candidate.artifactUrl === undefined
            ? new URL(source.uri).href
            : new URL(source.uri, candidate.artifactUrl).href;
      } catch (error) {
        failures.push(error);
        continue;
      }
      const fetcher = candidate.fetch ?? globalThis.fetch;
      if (typeof fetcher !== 'function') {
        failures.push(new TypeError('no fetch implementation is available'));
        continue;
      }
      try {
        const response = await fetcher(url, signal === undefined ? undefined : { signal });
        if (!response.ok) {
          throw new FontLoadError(
            'RASTER_RESOURCE_FETCH',
            `raster resource request failed with HTTP ${response.status}`,
            { url },
          );
        }
        const bytes = await readResponseBytes(
          response,
          this.#owner.registry._artifactByteLimit(),
          'RASTER_RESOURCE_LIMIT',
          url,
          signal,
        );
        return authenticateRasterResource(bytes, source, url);
      } catch (error) {
        signal?.throwIfAborted();
        if (error instanceof FontLoadError && error.code === 'RASTER_RESOURCE_LIMIT') throw error;
        failures.push(error);
      }
    }
    throw new FontLoadError('RASTER_RESOURCE_FETCH', 'external raster resource is unavailable', {
      cause: new AggregateError(failures),
    });
  }

  addResourceCandidates(candidates: readonly RegisteredRasterResourceCandidate[]): void {
    this.#assertActive();
    this.#resourceCandidates.splice(
      0,
      this.#resourceCandidates.length,
      ...mergeResourceCandidates(this.#resourceCandidates, candidates),
    );
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#owner.removeRaster(this);
  }

  disposeFromOwner(): void {
    this.#disposed = true;
  }

  #assertActive(): void {
    this.#owner.assertActive();
    if (this.#disposed) throw new FontLoadError('STALE_RASTER_HANDLE', 'raster has been disposed');
  }
}

function mergeRasterSources(
  font: RegisteredFontImpl,
  binaryBytes: Uint8Array,
  document: Readonly<Record<string, unknown>>,
  views: readonly RegisteredBufferView[],
  references: readonly RasterReference[],
  artifactUrl: string | undefined,
  fetcher: typeof fetch | undefined,
): void {
  const data = getRegisteredFontData(font);
  const extensions = requireNonArrayObject(document.extensions, 'extensions');
  for (const reference of references) {
    const current = data.rasterSources.get(reference.rasterKey);
    const extensionData =
      reference.source.type === 'embedded'
        ? jsonValue(extensions[reference.extension], `extensions.${reference.extension}`)
        : undefined;
    const resourceCandidate =
      extensionData === undefined
        ? undefined
        : {
            ...(artifactUrl === undefined ? {} : { artifactUrl }),
            ...(fetcher === undefined ? {} : { fetch: fetcher }),
          };
    const externalCandidate =
      reference.source.type === 'external'
        ? {
            source: reference.source,
            ...(artifactUrl === undefined ? {} : { artifactUrl }),
            ...(fetcher === undefined ? {} : { fetch: fetcher }),
          }
        : undefined;
    if (current !== undefined) {
      if (
        current.reference.kind !== reference.kind ||
        current.reference.extension !== reference.extension ||
        current.reference.version !== reference.version
      ) {
        throw new FontLoadError(
          'RASTER_REFERENCE_CONFLICT',
          'one shaping identity declared conflicting raster references',
        );
      }
      if (
        externalCandidate !== undefined &&
        !current.externalCandidates.some(
          (candidate) =>
            sameExternalSource(candidate.source, externalCandidate.source) &&
            candidate.artifactUrl === externalCandidate.artifactUrl,
        )
      ) {
        current.externalCandidates.push(externalCandidate);
      }
      if (extensionData !== undefined && current.extensionData === undefined) {
        data.rasterSources.set(reference.rasterKey, {
          reference: freezeReference(reference),
          extensionData,
          binaryBytes,
          bufferViews: views,
          externalCandidates: current.externalCandidates,
          resourceCandidates: mergeResourceCandidates(
            current.resourceCandidates,
            resourceCandidate === undefined ? [] : [resourceCandidate],
          ),
        });
      } else if (resourceCandidate !== undefined) {
        current.resourceCandidates.splice(
          0,
          current.resourceCandidates.length,
          ...mergeResourceCandidates(current.resourceCandidates, [resourceCandidate]),
        );
        const registered = font.getRaster(reference.rasterKey);
        if (registered instanceof RegisteredRasterImpl) {
          registered.addResourceCandidates([resourceCandidate]);
        }
      }
      continue;
    }
    data.rasterSources.set(reference.rasterKey, {
      reference: freezeReference(reference),
      ...(extensionData === undefined ? {} : { extensionData }),
      ...(extensionData === undefined ? {} : { binaryBytes, bufferViews: views }),
      externalCandidates: externalCandidate === undefined ? [] : [externalCandidate],
      resourceCandidates: resourceCandidate === undefined ? [] : [resourceCandidate],
    });
  }
}

function mergeSourceContext(font: RegisteredFontImpl, sourceHash: string, context: FontAssetContext): void {
  const data = getRegisteredFontData(font);
  if (sourceHash === data.sourceHash && context.sourceBytes !== undefined && data.sourceBytes === undefined) {
    data.sourceBytes = context.sourceBytes.slice();
  }
  if (
    context.sourceUrl !== undefined &&
    !data.sourceCandidates.some(
      (candidate) => candidate.sourceHash === sourceHash && candidate.sourceUrl === context.sourceUrl,
    )
  ) {
    data.sourceCandidates.push({
      sourceHash,
      sourceUrl: context.sourceUrl,
      ...(context.fetch === undefined ? {} : { fetch: context.fetch }),
    });
  }
}

function matchRasterExtension(
  font: RegisteredFontImpl,
  document: Readonly<Record<string, unknown>>,
): { readonly reference: RasterReference; readonly extensionData: JsonValue } {
  const extensions = requireNonArrayObject(document.extensions, 'extensions');
  const matches: { reference: RasterReference; extensionData: JsonValue }[] = [];
  for (const source of getRegisteredFontData(font).rasterSources.values()) {
    const candidate = extensions[source.reference.extension];
    if (candidate === undefined) continue;
    const extension = requireNonArrayObject(candidate, source.reference.extension);
    if (
      extension.rasterKey !== source.reference.rasterKey ||
      extension.shapingHash !== font.shapingHash ||
      extension.glyphCount !== font.glyphCount ||
      extension.glyphIdWidth !== 16 ||
      extension.version !== source.reference.version
    ) {
      continue;
    }
    matches.push({
      reference: source.reference,
      extensionData: jsonValue(candidate, source.reference.extension),
    });
  }
  if (matches.length !== 1) {
    throw new FontLoadError(
      'RASTER_RECIPROCAL_IDENTITY',
      'raster artifact must match exactly one font directory reference',
    );
  }
  return matches[0]!;
}

function generatedRasterExtension(
  font: RegisteredFontImpl,
  document: Readonly<Record<string, unknown>>,
  reference: RasterReference,
): JsonValue {
  const extensions = requireNonArrayObject(document.extensions, 'extensions');
  const candidate = requireNonArrayObject(extensions[reference.extension], reference.extension);
  if (
    candidate.rasterKey !== reference.rasterKey ||
    candidate.shapingHash !== font.shapingHash ||
    candidate.glyphCount !== font.glyphCount ||
    candidate.glyphIdWidth !== 16 ||
    candidate.version !== reference.version
  ) {
    throw new FontLoadError(
      'RASTER_RECIPROCAL_IDENTITY',
      'runtime raster artifact does not match its requested font and raster identity',
    );
  }
  return jsonValue(candidate, reference.extension);
}

function rasterReferences(value: unknown): readonly RasterReference[] {
  if (!Array.isArray(value)) throw new TypeError('PMNDRS_font.rasters must be an array');
  return value.map((entry, index) => {
    const item = requireNonArrayObject(entry, `rasters[${index}]`);
    const sourceValue = requireNonArrayObject(item.source, `rasters[${index}].source`);
    const source = rasterSource(sourceValue, `rasters[${index}].source`);
    return {
      rasterKey: string(item.rasterKey, `rasters[${index}].rasterKey`) as RasterKey,
      kind: string(item.kind, `rasters[${index}].kind`),
      extension: string(item.extension, `rasters[${index}].extension`),
      version: integer(item.version, `rasters[${index}].version`),
      source,
    };
  });
}

function rasterSource(value: Record<string, unknown>, path: string): RasterReference['source'] {
  if (value.type === 'embedded') return { type: 'embedded' };
  const artifactHash =
    value.artifactHash === undefined ? undefined : (string(value.artifactHash, `${path}.artifactHash`) as Sha256Hex);
  if (value.uri === undefined) {
    return { type: 'external', ...(artifactHash === undefined ? {} : { artifactHash }) };
  }
  if (artifactHash === undefined) {
    throw new TypeError(`${path}.artifactHash is required when uri is present`);
  }
  return {
    type: 'external',
    uri: string(value.uri, `${path}.uri`),
    artifactHash,
  };
}

function bufferViews(
  document: Readonly<Record<string, unknown>>,
  declaredBinLength: number,
): readonly RegisteredBufferView[] {
  if (!Array.isArray(document.bufferViews)) throw new TypeError('bufferViews must be an array');
  return document.bufferViews.map((entry, index) => {
    const value = requireNonArrayObject(entry, `bufferViews[${index}]`);
    if (value.buffer !== 0) throw new FontLoadError('BUFFER_VIEW_BUFFER', 'bufferView must use buffer 0');
    const byteOffset = value.byteOffset === undefined ? 0 : integer(value.byteOffset, 'byteOffset');
    const byteLength = integer(value.byteLength, 'byteLength');
    if (
      byteOffset < 0 ||
      byteLength < 0 ||
      !Number.isSafeInteger(byteOffset + byteLength) ||
      byteOffset + byteLength > declaredBinLength
    ) {
      throw new FontLoadError('BUFFER_VIEW_RANGE', 'bufferView exceeds the declared binary data');
    }
    return { byteOffset, byteLength };
  });
}

function resolveFontRequest(input: FontInput, baseUrl: URL | undefined): ResolvedFontRequest {
  const value = normalizeFontInput(input);
  if (value.source === undefined) {
    return { bakedUrl: normalizeUrl(value.baked!, baseUrl) };
  }
  const source = normalizeUrl(value.source, baseUrl);
  const sourceUrl = new URL(source);
  if (value.baked === null) return { sourceUrl: source };
  if (value.baked !== undefined) {
    return { sourceUrl: source, bakedUrl: normalizeUrl(value.baked, baseUrl) };
  }
  if (/\.glb$/i.test(sourceUrl.pathname)) return { bakedUrl: source };
  if (!isHierarchical(sourceUrl)) return { sourceUrl: source };
  sourceUrl.pathname = /\.(?:ttf|otf|woff2?)$/i.test(sourceUrl.pathname)
    ? sourceUrl.pathname.replace(/\.(?:ttf|otf|woff2?)$/i, '.font.glb')
    : `${sourceUrl.pathname}.font.glb`;
  sourceUrl.hash = '';
  return { sourceUrl: source, bakedUrl: sourceUrl.href };
}

function normalizeFontInput(input: FontInput): {
  source?: string | URL;
  baked?: string | URL | null;
} {
  if (typeof input === 'string' || input instanceof URL) return { source: input };
  if (typeof input !== 'object' || input === null) {
    throw new FontLoadError('INVALID_FONT_INPUT', 'font input must be a URL or source object');
  }
  const value = input as { source?: unknown; baked?: unknown };
  const source = urlValue(value.source, 'source');
  const baked = value.baked === null ? null : urlValue(value.baked, 'baked');
  if (source === undefined && (baked === undefined || baked === null)) {
    throw new FontLoadError('INVALID_FONT_INPUT', 'font input must provide source or baked');
  }
  return {
    ...(source === undefined ? {} : { source }),
    ...(baked === undefined ? {} : { baked }),
  };
}

function normalizeUrl(value: string | URL, baseUrl: URL | undefined): string {
  let url: URL;
  try {
    url = value instanceof URL ? new URL(value.href) : new URL(value, baseUrl);
  } catch (cause) {
    throw new FontLoadError('INVALID_FONT_URL', 'font URL cannot be resolved', { cause });
  }
  url.hash = '';
  return url.href;
}

function resolveBaseUrl(value: string | URL | undefined): URL | undefined {
  if (value !== undefined) return new URL(value);
  const location = (globalThis as { location?: { href?: string } }).location?.href;
  return location === undefined ? undefined : new URL(location);
}

function requestKey(request: ResolvedFontRequest): string {
  return `font:${CORE_FORMAT_VERSION}:${CORE_BAKER_VERSION}:${request.sourceUrl ?? ''}:${request.bakedUrl ?? ''}`;
}

function isHierarchical(url: URL): boolean {
  return url.protocol !== 'data:' && url.protocol !== 'blob:';
}

function defaultDevelopmentMode(): boolean {
  const environment = (globalThis as { process?: { env?: { NODE_ENV?: string } } }).process?.env?.NODE_ENV;
  return environment !== 'production';
}

function consumeSharedLoad(shared: SharedFontLoad, signal: AbortSignal | undefined): Promise<RegisteredFont> {
  signal?.throwIfAborted();
  shared.consumers += 1;
  return new Promise<RegisteredFont>((resolve, reject) => {
    let active = true;
    const release = (): void => {
      if (!active) return;
      active = false;
      signal?.removeEventListener('abort', aborted);
      shared.consumers -= 1;
      if (shared.consumers === 0 && !shared.settled) shared.controller.abort(abortReason(signal));
    };
    const aborted = (): void => {
      release();
      reject(abortReason(signal));
    };
    signal?.addEventListener('abort', aborted, { once: true });
    shared.promise.then(
      (font) => {
        if (!active) return;
        release();
        resolve(font);
      },
      (error: unknown) => {
        if (!active) return;
        release();
        reject(error);
      },
    );
  });
}

function loadValidator(): Promise<typeof import('@pmndrs/text-font-baker/validate')> {
  return (validatorPromise ??= import('@pmndrs/text-font-baker/validate'));
}

async function readResponseBytes(
  response: Response,
  limit: number,
  code: string,
  url: string,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  signal?.throwIfAborted();
  const declaredText = response.headers.get('content-length');
  const declared = declaredText === null ? undefined : Number(declaredText);
  if (declared !== undefined && Number.isFinite(declared) && declared > limit) {
    await response.body?.cancel();
    throw new FontLoadError(code, `response declares ${declared} bytes; limit is ${limit}`, {
      url,
    });
  }
  if (response.body === null) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    signal?.throwIfAborted();
    if (bytes.byteLength > limit) {
      throw new FontLoadError(code, `response has ${bytes.byteLength} bytes; limit is ${limit}`, {
        url,
      });
    }
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const abort = (): void => {
    void reader.cancel(abortReason(signal));
  };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      const chunk = result.value;
      if (!Number.isSafeInteger(total + chunk.byteLength) || total + chunk.byteLength > limit) {
        await reader.cancel();
        throw new FontLoadError(code, `response exceeds the ${limit}-byte resource limit`, {
          url,
        });
      }
      chunks.push(chunk);
      total += chunk.byteLength;
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    reader.releaseLock();
  }
  signal?.throwIfAborted();
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function abortReason(signal: AbortSignal | undefined): unknown {
  return signal?.reason ?? new DOMException('The operation was aborted', 'AbortError');
}

function copyView(value: ArrayBufferView): Uint8Array {
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
}

function positiveLimit(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new RangeError(`${name} must be a positive safe integer`);
  }
  return resolved;
}

function validationError(code: string, message: string, cause: unknown): FontLoadError {
  if (cause instanceof FontLoadError) return cause;
  return new FontLoadError(code, message, { cause });
}

function hasValidationIssue(error: unknown, code: string): boolean {
  let current = error;
  const seen = new Set<unknown>();
  while (isNonArrayObject(current) && !seen.has(current)) {
    seen.add(current);
    if (
      Array.isArray(current.issues) &&
      current.issues.some((issue) => isNonArrayObject(issue) && issue.code === code)
    ) {
      return true;
    }
    current = current.cause;
  }
  return false;
}

function requireNonArrayObject(value: unknown, name: string): Record<string, unknown> {
  assertNonArrayObject(value, name);
  return value;
}

function assertNonArrayObject(value: unknown, name: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
}

function isNonArrayObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integer(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TypeError(`${name} must be a safe integer`);
  }
  return value;
}

function string(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new TypeError(`${name} must be a string`);
  return value;
}

function urlValue(value: unknown, name: string): string | URL | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string' || value instanceof URL) return value;
  throw new FontLoadError('INVALID_FONT_INPUT', `${name} must be a string or URL`);
}

function jsonValue(value: unknown, name: string): JsonValue {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  if (Array.isArray(value)) return value.map((entry, index) => jsonValue(entry, `${name}[${index}]`));
  const object = requireNonArrayObject(value, name);
  return Object.fromEntries(Object.entries(object).map(([key, entry]) => [key, jsonValue(entry, `${name}.${key}`)]));
}

function deepFreeze<Value extends JsonValue>(value: Value): Value {
  if (typeof value !== 'object' || value === null) return value;
  for (const child of Array.isArray(value) ? value : Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function freezeReference(reference: RasterReference): RasterReference {
  const copy = structuredClone(reference);
  Object.freeze(copy.source);
  return Object.freeze(copy);
}

function sameExternalSource(
  left: Extract<RasterReference['source'], { readonly type: 'external' }>,
  right: Extract<RasterReference['source'], { readonly type: 'external' }>,
): boolean {
  return left.uri === right.uri && left.artifactHash === right.artifactHash;
}

function withResourceResolver(
  candidates: readonly RegisteredRasterResourceCandidate[],
  resolveResource: RasterResourceResolver | undefined,
): RegisteredRasterResourceCandidate[] {
  return mergeResourceCandidates(candidates, resolveResource === undefined ? [] : [{ resolveResource }]);
}

function mergeResourceCandidates(
  left: readonly RegisteredRasterResourceCandidate[],
  right: readonly RegisteredRasterResourceCandidate[],
): RegisteredRasterResourceCandidate[] {
  const result = [...left];
  for (const candidate of right) {
    if (
      !result.some(
        (current) =>
          current.artifactUrl === candidate.artifactUrl &&
          current.fetch === candidate.fetch &&
          current.resolveResource === candidate.resolveResource,
      )
    ) {
      result.push(candidate);
    }
  }
  return result;
}

function assertExternalResourceSource(source: Extract<RasterResourceSource, { readonly type: 'external' }>): void {
  if (
    source.uri.length === 0 ||
    !Number.isSafeInteger(source.byteLength) ||
    source.byteLength <= 0 ||
    !/^[0-9a-f]{64}$/.test(source.artifactHash)
  ) {
    throw new TypeError('external raster resource has invalid URI, length, or SHA-256 identity');
  }
}

async function authenticateRasterResource(
  bytes: Uint8Array,
  source: Extract<RasterResourceSource, { readonly type: 'external' }>,
  url?: string,
): Promise<Uint8Array> {
  if (bytes.byteLength !== source.byteLength) {
    throw new FontLoadError(
      'RASTER_RESOURCE_LENGTH',
      'external raster resource byte length does not match its directory entry',
      { ...(url === undefined ? {} : { url }) },
    );
  }
  if ((await sha256(bytes)) !== source.artifactHash) {
    throw new FontLoadError(
      'RASTER_RESOURCE_HASH',
      'external raster resource hash does not match its directory entry',
      { ...(url === undefined ? {} : { url }) },
    );
  }
  return bytes;
}

async function authenticatedFontFaceIndex(provenance: Readonly<Record<string, unknown>>): Promise<number> {
  const descriptorHash = string(provenance.descriptorHash, 'provenance.descriptorHash');
  const declared = provenance.fontFaceIndex;
  const fontFaceIndex = declared === undefined ? 0 : integer(declared, 'provenance.fontFaceIndex');
  if (fontFaceIndex < 0 || fontFaceIndex > 0xffff_ffff) {
    throw new FontLoadError('INVALID_FONT_ASSET', 'provenance.fontFaceIndex must be an unsigned 32-bit integer');
  }
  const canonical = new TextEncoder().encode(`{"fontFaceIndex":${fontFaceIndex},"formatVersion":0}`);
  if ((await sha256(canonical)) !== descriptorHash) {
    throw new FontLoadError(
      'INVALID_FONT_ASSET',
      declared === undefined
        ? 'legacy font artifact does not identify its nonzero collection face'
        : 'font face index does not match the authenticated bake descriptor',
    );
  }
  return fontFaceIndex;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}
