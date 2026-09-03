import {
  FONT_BAKER_VERSION as CORE_BAKER_VERSION,
  FONT_FORMAT_VERSION as CORE_FORMAT_VERSION,
} from './font-baker/contract.js';

import type { Font, FontBytesInput, FontInput, FontMetrics, RegisteredFont } from './font.js';
import {
  createImmutableFontBacking,
  createImmutableFontLease,
  createImmutableFontVariant,
  observeImmutableFontDispose,
  releaseImmutableFontVariant,
  retainImmutableFontVariant,
  type ImmutableFontVariant,
} from './loaded-font.js';
import type { SerializedFontFace } from './font-face-transfer.js';
import { readBufferViews, readRuntimeFontArtifact } from './internal/font-artifact-reader.js';
import { readGlb, type ParsedGlb } from './internal/glb-reader.js';
import type { FontHandle, FontKey, RasterHandle, RasterKey, Sha256Hex } from './identity.js';
import {
  deleteRegisteredFontData,
  getRegisteredFontData,
  setRegisteredFontData,
  type RegisteredBufferView,
  type RegisteredRasterResourceData,
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
import type { BakeProgressListener, RasterBakeArtifact } from './bake.js';
import { normalizeUnicodeRanges } from './internal/font-selection.js';
import { canonicalJson, deriveRasterKey } from './internal/raster-identity.js';
import type { RuntimeBakeRaster, RuntimeBakeUnicodeRange } from './internal/runtime-bake-protocol.js';
import { workerRasterKinds } from './internal/runtime-bake-protocol.js';
import { DEV } from './internal/dev.js';
import {
  type AnyRasterFormat,
  type RasterDataOf,
  type RasterOptionsOf,
  type RasterFormatInput,
  type RasterFormatRequest,
  type RasterFormatTypesOf,
} from './config/raster-format.js';
import { isRasterFormat, rasterFormatForReference } from './internal/raster-format-registry.js';
import type {
  RasterKindOf,
  RasterOptionsArgument,
  RuntimeRasterBakeRequest as TechniqueRasterBakeRequest,
  RuntimeRasterBakerLoader,
  RuntimeRasterBakerModule,
} from './raster.js';

const DEFAULT_MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const DEFAULT_MAX_BUFFER_VIEWS = 4_096;
const DEFAULT_MAX_RASTERS = 256;

let nextRegistryId = 1;
let nextFontHandle = 1;
let nextRasterHandle = 1;
let nextObjectIdentity = 1;
let defaultRuntimeBakePromise: Promise<RuntimeFontBake> | undefined;
const objectIdentities = new WeakMap<object, number>();

/** Cancellation accepted by one font load. */
export interface FontLoadOptions {
  readonly signal?: AbortSignal;
}

export interface FontLoadDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly url?: string;
  readonly cause?: unknown;
}

/** Portable font source accepted by loading, including an explicit runtime-bake source. */
export type LoadFontInput =
  | FontInput
  | {
      readonly source: string | URL | FontBytesInput;
      readonly runtimeBake: RuntimeFontBake;
      readonly unicodeRanges?: readonly RuntimeBakeUnicodeRange[];
    };

/** Nonempty raster-input tuple used by one multi-raster font load. */
export type FontRasterInputs = readonly [RasterFormatInput<AnyRasterFormat>, ...RasterFormatInput<AnyRasterFormat>[]];

type RasterFormatOfInput<Input> = Input extends AnyRasterFormat
  ? Input
  : Input extends { readonly raster: infer Format extends AnyRasterFormat }
    ? Format
    : never;

/** Position-preserving Font results for a nonempty raster-input tuple. */
export type Fonts<Rasters extends FontRasterInputs> = {
  readonly [Index in keyof Rasters]: Font<RasterFormatOfInput<Rasters[Index]>>;
};

/** Options for an application-owned view of Glyph's immutable font resource graph. */
export interface FontLibraryOptions {
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string | URL;
  readonly development?: boolean;
  readonly runtimeBake?: RuntimeFontBake;
  readonly onDiagnostic?: (diagnostic: FontLoadDiagnostic) => void;
  readonly onWarning?: (diagnostic: FontLoadDiagnostic) => void;
  readonly maxArtifactBytes?: number;
  readonly maxBufferViews?: number;
  readonly maxRasters?: number;
}

/** Application-owned loading boundary over Glyph's immutable font resource graph. */
export interface FontLibrary {
  readonly disposed: boolean;

  /** Load one typed raster variant of a portable font. */
  loadFont<Format extends AnyRasterFormat>(
    input: LoadFontInput,
    raster: RasterFormatInput<Format>,
    options?: FontLoadOptions,
  ): Promise<Font<Format>>;

  /** Load a nonempty raster tuple from one shared portable font backing. */
  loadFont<const Rasters extends FontRasterInputs>(
    input: LoadFontInput,
    rasters: Rasters,
    options?: FontLoadOptions,
  ): Promise<Fonts<Rasters>>;

  /** Release every source, decoded variant, and adapter-resource lease. */
  dispose(): void;
}

export interface RuntimeFontBakeRequest {
  readonly source: Uint8Array;
  readonly sourceUrl: string;
  readonly bakedUrl?: string;
  /** Persistent derived-artifact lifetime inherited from the source response. Omitted means memory-only. */
  readonly cache?: { readonly expiresAt: number };
  readonly unicodeRanges?: readonly RuntimeBakeUnicodeRange[];
  readonly rasters?: readonly RuntimeBakeRaster[];
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
  /** @internal A transformed runtime source cannot be authenticated or retained as the baked shaping source. */
  readonly runtimeSourceIdentity?: 'original' | 'transformed';
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

type FontByteOwnership = 'adopt' | 'copy' | 'transfer';

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

  /** @internal */
  async _registerAsset(
    bytes: ArrayBufferView,
    context: FontAssetContext = {},
    ownership: FontByteOwnership = 'copy',
  ): Promise<RegisteredFont> {
    this.#checkArtifactSize(bytes.byteLength);
    const owned = ownFontBytes(bytes, ownership);
    const artifactHash = (await sha256(owned)) as Sha256Hex;
    let artifact: ReturnType<typeof readRuntimeFontArtifact>;
    try {
      artifact = readRuntimeFontArtifact(owned);
    } catch (error) {
      throw validationError('INVALID_FONT_ASSET', 'font artifact could not be read', error);
    }
    const { parsed, extension: fontExtension, bufferViews: views } = artifact;
    const document = parsed.document;
    const metricsValue = fontExtension.metrics;
    const provenance = fontExtension.provenance;
    const sourceHash = string(provenance.sourceHash, 'provenance.sourceHash');
    const fontFaceIndex = await authenticatedFontFaceIndex(provenance);
    if (context.sourceBytes !== undefined && (await sha256(context.sourceBytes)) !== sourceHash) {
      throw new FontLoadError('FONT_SOURCE_IDENTITY', 'runtime source bytes do not match the baked font provenance');
    }
    const references = rasterReferences(fontExtension.rasters);
    const binaryBytes = parsed.bin.subarray(0, parsed.declaredBinLength);
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
    const shapingHash = artifact.shapingHash;
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
      glyphCount: integer(metricsValue.glyphCount, 'metrics.glyphCount'),
      metrics: {
        unitsPerEm: integer(metricsValue.unitsPerEm, 'metrics.unitsPerEm'),
        ascender: integer(metricsValue.ascender, 'metrics.ascender'),
        descender: integer(metricsValue.descender, 'metrics.descender'),
        lineGap: integer(metricsValue.lineGap, 'metrics.lineGap'),
        underlinePosition: integer(metricsValue.underlinePosition, 'metrics.underlinePosition'),
        underlineThickness: integer(metricsValue.underlineThickness, 'metrics.underlineThickness'),
        strikeoutPosition: integer(metricsValue.strikeoutPosition, 'metrics.strikeoutPosition'),
        strikeoutSize: integer(metricsValue.strikeoutSize, 'metrics.strikeoutSize'),
      },
    });
    const rasterSources = new Map<string, RegisteredRasterSourceData>();
    setRegisteredFontData(font, {
      artifactBytes: owned,
      artifactHash,
      fontFaceIndex,
      sourceHash,
      ...(context.sourceBytes === undefined ? {} : { sourceBytes: context.sourceBytes }),
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
      shapingSfnt: artifact.shapingSfnt,
      glyphExtents: artifact.glyphExtents,
      glyphExtentsAvailability: artifact.glyphExtentsAvailability,
      rasterSources,
      resources: new Map(),
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
    ownership: FontByteOwnership = 'copy',
  ): Promise<RegisteredRaster> {
    const registered = this.#ownedFont(font);
    this.#checkArtifactSize(bytes.byteLength);
    const owned = ownFontBytes(bytes, ownership);
    let parsed: ParsedGlb;
    let views: readonly RegisteredBufferView[];
    try {
      parsed = readGlb(owned);
      views = readBufferViews(parsed);
    } catch (error) {
      throw validationError('INVALID_RASTER_ASSET', 'raster artifact could not be read', error);
    }
    if (views.length > this.#maxBufferViews) {
      throw new FontLoadError(
        'FONT_RESOURCE_LIMIT',
        `raster artifact has ${views.length} buffer views; limit is ${this.#maxBufferViews}`,
      );
    }
    const match = matchRasterExtension(registered, parsed.document);
    const artifactHash = await sha256(owned);
    if (match.reference.source.type === 'external' && match.reference.source.artifactHash !== undefined) {
      if (artifactHash !== match.reference.source.artifactHash) {
        throw new FontLoadError(
          'RASTER_ARTIFACT_HASH',
          'external raster artifact hash does not match its font directory entry',
        );
      }
    }
    const source = retainRasterArtifactData(
      registered,
      match.reference,
      match.extensionData,
      parsed.bin.subarray(0, parsed.declaredBinLength),
      views,
      owned,
      artifactHash,
      [context],
    );
    return registered.registerRaster(
      source.reference,
      source.extensionData!,
      source.binaryBytes!,
      source.bufferViews!,
      source.resourceCandidates,
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
    let parsed: ParsedGlb;
    let views: readonly RegisteredBufferView[];
    try {
      parsed = readGlb(owned);
      views = readBufferViews(parsed);
    } catch (error) {
      throw validationError('INVALID_RASTER_ASSET', 'raster artifact could not be read', error);
    }
    if (views.length > this.#maxBufferViews) {
      throw new FontLoadError(
        'FONT_RESOURCE_LIMIT',
        `raster artifact has ${views.length} buffer views; limit is ${this.#maxBufferViews}`,
      );
    }
    const reference: RasterReference = { ...expected, source: { type: 'external' } };
    const extensionData = generatedRasterExtension(registered, parsed.document, reference);
    const binaryBytes = parsed.bin.subarray(0, parsed.declaredBinLength);
    const source = retainRasterArtifactData(
      registered,
      reference,
      extensionData,
      binaryBytes,
      views,
      owned,
      await sha256(owned),
      [],
    );
    return registered.registerRaster(
      source.reference,
      source.extensionData!,
      source.binaryBytes!,
      source.bufferViews!,
      source.resourceCandidates,
    );
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
  readonly #runtimeSourceIdentity: 'original' | 'transformed';
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
    this.#runtimeSourceIdentity = options.runtimeSourceIdentity ?? 'original';
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
    if (request.bakedBytes !== undefined) {
      signal.throwIfAborted();
      return this.registry._registerAsset(request.bakedBytes.bytes, {}, request.bakedBytes.ownership ?? 'copy');
    }
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
    if (request.sourceUrl === undefined && request.sourceBytes === undefined) {
      throw new FontLoadError('INVALID_FONT_INPUT', 'font request has no source or baked asset');
    }
    const sourceLabel = request.sourceUrl ?? 'memory://font-source';
    const runtimeBake = this.#runtimeBake ?? (await loadDefaultRuntimeBake(sourceLabel));
    signal.throwIfAborted();
    const sourceResponse =
      request.sourceBytes === undefined
        ? await this.#fetchRequired(request.sourceUrl!, 'FONT_SOURCE_FETCH', signal)
        : {
            bytes: ownFontBytes(request.sourceBytes.bytes, request.sourceBytes.ownership ?? 'copy'),
            expiresAt: undefined,
          };
    const { bytes: source } = sourceResponse;
    const baked = await runtimeBake({
      source,
      sourceUrl: sourceLabel,
      ...(request.bakedUrl === undefined ? {} : { bakedUrl: request.bakedUrl }),
      ...(sourceResponse.expiresAt === undefined ? {} : { cache: { expiresAt: sourceResponse.expiresAt } }),
      signal,
    });
    signal.throwIfAborted();
    return this.registry._registerAsset(baked, {
      ...(request.bakedUrl === undefined ? {} : { artifactUrl: request.bakedUrl }),
      ...(request.sourceUrl === undefined ? {} : { sourceUrl: request.sourceUrl }),
      ...(this.#runtimeSourceIdentity === 'original' ? { sourceBytes: source } : {}),
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
      const font = await this.registry._registerAsset(
        bytes,
        {
          artifactUrl: url,
          ...(sourceUrl === undefined ? {} : { sourceUrl }),
          fetch: this.#fetch,
        },
        'adopt',
      );
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

  async #fetchRequired(
    url: string,
    code: string,
    signal: AbortSignal,
  ): Promise<{ readonly bytes: Uint8Array; readonly expiresAt?: number }> {
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
    const bytes = await readResponseBytes(
      response,
      this.registry._artifactByteLimit(),
      'FONT_SOURCE_RESOURCE_LIMIT',
      url,
      signal,
    );
    const expiresAt = persistentResponseExpiration(response);
    return { bytes, ...(expiresAt === undefined ? {} : { expiresAt }) };
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

interface ImmutableLoaderConfig {
  readonly fetch?: typeof fetch;
  readonly baseUrl?: string | URL;
  readonly development?: boolean;
  readonly runtimeBake?: RuntimeFontBake;
  readonly onDiagnostic?: (diagnostic: FontLoadDiagnostic) => void;
  readonly onWarning?: (diagnostic: FontLoadDiagnostic) => void;
  readonly maxArtifactBytes?: number;
  readonly maxBufferViews?: number;
  readonly maxRasters?: number;
}

interface PreparedRasterRequest {
  readonly request: RasterFormatRequest<AnyRasterFormat>;
  readonly descriptor: RasterFormatTypesOf<AnyRasterFormat>['descriptor'];
  readonly identity: string;
}

interface PreparedFontFaceSourceRequest {
  readonly input: FontInput;
  readonly runtimeBake?: RuntimeFontBake;
  readonly unicodeRanges?: readonly RuntimeBakeUnicodeRange[];
  readonly initialRasters: readonly PreparedRasterRequest[];
  readonly key: string;
}

interface SharedFontFaceSourceLoad {
  readonly controller: AbortController;
  readonly promise: Promise<FontFaceSourceNode>;
  consumers: number;
  settled: boolean;
  value: FontFaceSourceNode | undefined;
}

interface FontLibraryOwnedResource<Value> {
  readonly value: Value;
  readonly dispose: () => void;
}

interface ImmutableLoadArguments {
  readonly input: LoadFontInput;
  readonly rasters: readonly unknown[];
  readonly multiple: boolean;
  readonly options: FontLoadOptions;
}

function immutableLoadArguments(
  input: unknown,
  rasterOrOptions: unknown,
  loadOptions: unknown,
): ImmutableLoadArguments {
  if (rasterOrOptions === undefined) throw new TypeError('font loading requires a raster format');
  return {
    input: input as LoadFontInput,
    rasters: Array.isArray(rasterOrOptions) ? rasterOrOptions : [rasterOrOptions],
    multiple: Array.isArray(rasterOrOptions),
    options: loadOptions === undefined ? {} : (loadOptions as FontLoadOptions),
  };
}

/** Load a portable Font or position-preserving Font tuple. */
export function loadFont<Format extends AnyRasterFormat>(
  input: LoadFontInput,
  raster: RasterFormatInput<Format>,
  options?: FontLoadOptions,
): Promise<Font<Format>>;

export function loadFont<const Rasters extends FontRasterInputs>(
  input: LoadFontInput,
  rasters: Rasters,
  options?: FontLoadOptions,
): Promise<Fonts<Rasters>>;

export function loadFont(
  inputOrToken: unknown,
  rasterOrOptions?: unknown,
  loadOptions?: unknown,
): Promise<Font<AnyRasterFormat> | readonly Font<AnyRasterFormat>[]> {
  const args = immutableLoadArguments(inputOrToken, rasterOrOptions, loadOptions);
  return loadFontsFromGraph(sharedGlyphFontLibrary, args);
}

export function createFontLibrary(options: FontLibraryOptions = {}): FontLibrary {
  if (!isNonArrayObject(options)) throw new TypeError('font library options must be an object');
  return new FontLibraryImpl(options);
}

/** Package-private lease on one authenticated main-font node used by FontFace. */
export interface FontFaceSourceLease {
  /** Ordered unique format keys advertised by the authoritative main font. */
  readonly formats: readonly string[];
  load<Format extends AnyRasterFormat>(raster: RasterFormatInput<Format>): Promise<Font<Format>>;
  loadAdvertised(excluding?: readonly AnyRasterFormat[]): Promise<readonly Font<AnyRasterFormat>[]>;
  /** Snapshot selected loaded variants into fresh cross-realm buffers. */
  snapshot(fonts: readonly Font<AnyRasterFormat>[]): Promise<SerializedFontFace>;
  dispose(): void;
}

/** @internal Open one shared main-font node without loading its raster sidecars. */
export function openFontFaceSource(
  library: FontLibrary,
  input: LoadFontInput,
  initialRasters: readonly RasterFormatInput<AnyRasterFormat>[],
  options: FontLoadOptions = {},
): Promise<FontFaceSourceLease> {
  assertFontLibrary(library, 'FontFace loading');
  return (library as FontLibraryImpl).openFontFaceSource(input, initialRasters, options);
}

/** @internal Adopt an explicit cross-realm snapshot without consulting a URL or runtime baker. */
export function openSerializedFontFaceSource(
  library: FontLibrary,
  serialized: SerializedFontFace,
  options: FontLoadOptions = {},
): Promise<FontFaceSourceLease> {
  assertFontLibrary(library, 'serialized FontFace loading');
  return (library as FontLibraryImpl).openSerializedFontFaceSource(serialized, options);
}

class FontLibraryImpl implements FontLibrary {
  readonly #config: ImmutableLoaderConfig;
  readonly #fontFaceSources = new Map<string, SharedFontFaceSourceLoad>();
  readonly #fontFaceContent = new Map<string, FontFaceSourceNode>();
  readonly #resources = new Map<object, FontLibraryOwnedResource<unknown>>();
  #disposed = false;

  constructor(options: FontLibraryOptions) {
    this.#config = {
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      ...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
      ...(options.development === undefined ? {} : { development: options.development }),
      ...(options.runtimeBake === undefined ? {} : { runtimeBake: options.runtimeBake }),
      ...(options.onDiagnostic === undefined ? {} : { onDiagnostic: options.onDiagnostic }),
      ...(options.onWarning === undefined ? {} : { onWarning: options.onWarning }),
      ...(options.maxArtifactBytes === undefined ? {} : { maxArtifactBytes: options.maxArtifactBytes }),
      ...(options.maxBufferViews === undefined ? {} : { maxBufferViews: options.maxBufferViews }),
      ...(options.maxRasters === undefined ? {} : { maxRasters: options.maxRasters }),
    };
  }

  get disposed(): boolean {
    return this.#disposed;
  }

  loadFont<Format extends AnyRasterFormat>(
    input: LoadFontInput,
    raster: RasterFormatInput<Format>,
    options?: FontLoadOptions,
  ): Promise<Font<Format>>;

  loadFont<const Rasters extends FontRasterInputs>(
    input: LoadFontInput,
    rasters: Rasters,
    options?: FontLoadOptions,
  ): Promise<Fonts<Rasters>>;

  loadFont(
    inputOrToken: unknown,
    rasterOrOptions?: unknown,
    loadOptions?: unknown,
  ): Promise<Font<AnyRasterFormat> | readonly Font<AnyRasterFormat>[]> {
    this.#assertActive();
    const args = immutableLoadArguments(inputOrToken, rasterOrOptions, loadOptions);
    return loadFontsFromGraph(this, args);
  }

  openFontFaceSource(
    input: LoadFontInput,
    initialRasters: readonly RasterFormatInput<AnyRasterFormat>[],
    options: FontLoadOptions = {},
  ): Promise<FontFaceSourceLease> {
    this.#assertActive();
    const signal = fontLoadSignal(options);
    signal?.throwIfAborted();
    const prepared = prepareFontFaceSourceRequest(input, initialRasters, this.#config);
    let shared = this.#fontFaceSources.get(prepared.key);
    if (shared === undefined || shared.controller.signal.aborted) {
      const owned = ownPreparedFontFaceSourceBytes(prepared);
      const created = createSharedFontFaceSourceLoad((sourceSignal) => this.#loadFontFaceSource(owned, sourceSignal));
      shared = created;
      this.#fontFaceSources.set(prepared.key, created);
      void created.promise.catch(() => {
        if (this.#fontFaceSources.get(prepared.key) === created) this.#fontFaceSources.delete(prepared.key);
      });
    }
    return consumeFontFaceSourceLoad(shared, signal);
  }

  async openSerializedFontFaceSource(
    serialized: SerializedFontFace,
    options: FontLoadOptions = {},
  ): Promise<FontFaceSourceLease> {
    this.#assertActive();
    const signal = fontLoadSignal(options);
    signal?.throwIfAborted();
    const existing = this.#fontFaceContent.get(serialized.artifactHash);
    if (existing !== undefined && existing.contains(serialized)) return existing.acquire();
    const { loadSerializedFontFaceSource } = await import('./internal/font-face-transfer-runtime.js');
    const candidate = await loadSerializedFontFaceSource(serialized, this.#config, signal);
    try {
      signal?.throwIfAborted();
      this.#assertActive();
      return this.#convergeFontFaceSource(candidate).acquire();
    } catch (error) {
      candidate.dispose();
      throw error;
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const resource of this.#resources.values()) {
      try {
        resource.dispose();
      } catch (error) {
        if (DEV) console.warn(`font library teardown continued after an adapter resource failed: ${String(error)}`);
      }
    }
    this.#resources.clear();
    for (const shared of this.#fontFaceSources.values()) {
      shared.controller.abort(new FontLoadError('FONT_LIBRARY_DISPOSED', 'font library was disposed'));
      shared.value?.dispose();
    }
    this.#fontFaceSources.clear();
    this.#fontFaceContent.clear();
  }

  #assertActive(): void {
    if (this.#disposed) throw new FontLoadError('FONT_LIBRARY_DISPOSED', 'font library has been disposed');
  }

  async #loadFontFaceSource(prepared: PreparedFontFaceSourceRequest, signal: AbortSignal): Promise<FontFaceSourceNode> {
    const candidate = await loadFontFaceSourceFont(prepared, this.#config, signal);
    signal.throwIfAborted();
    return this.#convergeFontFaceSource(candidate);
  }

  #convergeFontFaceSource(candidate: RegisteredFont): FontFaceSourceNode {
    const contentHash = getRegisteredFontData(candidate).artifactHash;
    const existing = this.#fontFaceContent.get(contentHash);
    if (existing !== undefined) {
      existing.mergeAcquisition(candidate);
      candidate.dispose();
      return existing;
    }
    let node!: FontFaceSourceNode;
    node = new FontFaceSourceNode(candidate, () => {
      if (this.#fontFaceContent.get(contentHash) === node) this.#fontFaceContent.delete(contentHash);
      for (const [key, shared] of this.#fontFaceSources) {
        if (shared.value === node) this.#fontFaceSources.delete(key);
      }
    });
    this.#fontFaceContent.set(contentHash, node);
    return node;
  }

  resource<Value>(key: object, create: () => FontLibraryOwnedResource<Value>): Value {
    this.#assertActive();
    const existing = this.#resources.get(key) as FontLibraryOwnedResource<Value> | undefined;
    if (existing !== undefined) return existing.value;
    const resource = create();
    this.#resources.set(key, resource);
    return resource.value;
  }
}

const sharedGlyphFontLibrary = new FontLibraryImpl({});

/** @internal Process-local font resource graph shared by Glyph and transitional low-level loads. */
export function glyphFontLibrary(): FontLibrary {
  return sharedGlyphFontLibrary;
}

function loadFontsFromGraph(
  library: FontLibraryImpl,
  args: ImmutableLoadArguments,
): Promise<Font<AnyRasterFormat> | readonly Font<AnyRasterFormat>[]> {
  if (args.rasters.length === 0) throw new TypeError('font request requires at least one raster format');
  const rasters = args.rasters.map((raster, index) => prepareRasterRequest(raster, index));
  const identities = new Set<string>();
  for (const raster of rasters) {
    if (identities.has(raster.identity)) throw new TypeError('font request cannot repeat one raster variant');
    identities.add(raster.identity);
  }
  const requests = rasters.map(({ request }) => request);
  const sourcePromise = library.openFontFaceSource(args.input, requests, args.options);
  return sourcePromise.then((source) => loadFontsFromSource(source, requests, args.multiple));
}

async function loadFontsFromSource(
  source: FontFaceSourceLease,
  requests: readonly RasterFormatRequest<AnyRasterFormat>[],
  multiple: boolean,
): Promise<Font<AnyRasterFormat> | readonly Font<AnyRasterFormat>[]> {
  const loads = requests.map((raster) => source.load(raster));
  try {
    const fonts = await Promise.all(loads);
    retainFontSourceLease(source, fonts);
    return multiple ? Object.freeze(fonts) : fonts[0]!;
  } catch (error) {
    const settled = await Promise.allSettled(loads);
    for (const result of settled) if (result.status === 'fulfilled') result.value.dispose();
    source.dispose();
    throw error;
  }
}

function retainFontSourceLease(source: FontFaceSourceLease, fonts: readonly Font<AnyRasterFormat>[]): void {
  let remaining = fonts.length;
  for (const font of fonts) {
    observeImmutableFontDispose(font, () => {
      remaining -= 1;
      if (remaining === 0) source.dispose();
    });
  }
}

/** @internal Assert that a value is a FontLibrary created by this package instance. */
export function assertFontLibrary(value: unknown, owner: string): asserts value is FontLibrary {
  if (!(value instanceof FontLibraryImpl)) throw new TypeError(`${owner} requires a FontLibrary`);
}

/** @internal Own one adapter resource under an authentic FontLibrary lifetime. */
export function fontLibraryOwnedResource<Value>(
  library: FontLibrary,
  key: object,
  create: () => FontLibraryOwnedResource<Value>,
): Value {
  assertFontLibrary(library, 'font library resource');
  return (library as FontLibraryImpl).resource(key, create);
}

function createSharedFontFaceSourceLoad(
  load: (signal: AbortSignal) => Promise<FontFaceSourceNode>,
): SharedFontFaceSourceLoad {
  const controller = new AbortController();
  let created!: SharedFontFaceSourceLoad;
  const promise = Promise.resolve()
    .then(() => load(controller.signal))
    .then(
      (node) => {
        created.settled = true;
        created.value = node;
        if (created.consumers === 0 && node.leaseCount === 0) node.dispose();
        return node;
      },
      (error: unknown) => {
        created.settled = true;
        throw error;
      },
    );
  created = { controller, promise, consumers: 0, settled: false, value: undefined };
  return created;
}

function consumeFontFaceSourceLoad(
  shared: SharedFontFaceSourceLoad,
  signal: AbortSignal | undefined,
): Promise<FontFaceSourceLease> {
  signal?.throwIfAborted();
  shared.consumers += 1;
  return new Promise((resolve, reject) => {
    let active = true;
    const release = (): void => {
      if (!active) return;
      active = false;
      signal?.removeEventListener('abort', aborted);
      shared.controller.signal.removeEventListener('abort', sharedAborted);
      shared.consumers -= 1;
      if (shared.consumers === 0) {
        if (!shared.settled) shared.controller.abort(abortReason(signal));
        else if (shared.value?.leaseCount === 0) shared.value.dispose();
      }
    };
    const aborted = (): void => {
      release();
      reject(abortReason(signal));
    };
    const sharedAborted = (): void => {
      release();
      reject(abortReason(shared.controller.signal));
    };
    signal?.addEventListener('abort', aborted, { once: true });
    shared.controller.signal.addEventListener('abort', sharedAborted, { once: true });
    shared.promise.then(
      (node) => {
        if (!active) return;
        const lease = node.acquire();
        release();
        resolve(lease);
      },
      (error: unknown) => {
        if (!active) return;
        release();
        reject(error);
      },
    );
  });
}

interface SharedFontFaceVariant {
  readonly promise: Promise<ImmutableFontVariant<AnyRasterFormat>>;
  value: ImmutableFontVariant<AnyRasterFormat> | undefined;
}

class FontFaceSourceNode {
  readonly formats: readonly string[];
  readonly #font: RegisteredFont;
  readonly #backing: ReturnType<typeof createImmutableFontBacking>;
  readonly #references: readonly RasterReference[];
  readonly #variants = new Map<string, SharedFontFaceVariant>();
  readonly #controller = new AbortController();
  readonly #remove: () => void;
  #leases = 0;
  #disposed = false;

  constructor(font: RegisteredFont, remove: () => void) {
    this.#font = font;
    this.#backing = createImmutableFontBacking(font);
    this.#references = Object.freeze([...font.rasterReferences]);
    this.formats = Object.freeze([...new Set(this.#references.map(({ kind }) => kind))]);
    this.#remove = remove;
  }

  get leaseCount(): number {
    return this.#leases;
  }

  mergeAcquisition(candidate: RegisteredFont): void {
    this.#assertActive();
    mergeRegisteredFontAcquisition(this.#font, candidate);
  }

  contains(serialized: SerializedFontFace): boolean {
    this.#assertActive();
    const registered = getRegisteredFontData(this.#font);
    if (registered.artifactHash !== serialized.artifactHash) return false;
    for (const raster of serialized.rasters) {
      const source = registered.rasterSources.get(raster.rasterKey);
      if (
        source === undefined ||
        source.reference.kind !== raster.kind ||
        source.reference.extension !== raster.extension ||
        source.reference.version !== raster.version
      ) {
        return false;
      }
      if (raster.data !== undefined && source.artifactHash !== raster.artifactHash) return false;
      if (source.reference.source.type === 'external' && source.artifactBytes === undefined) return false;
    }
    for (const resource of serialized.resources) {
      if (!registered.resources.has(rasterResourceIdentity(resource.artifactHash, resource.byteLength))) return false;
    }
    return true;
  }

  acquire(): FontFaceSourceLease {
    this.#assertActive();
    this.#leases += 1;
    return new FontFaceSourceLeaseImpl(this);
  }

  load<Format extends AnyRasterFormat>(raster: RasterFormatInput<Format>): Promise<Font<Format>> {
    this.#assertActive();
    const prepared = prepareRasterRequest(raster, 0);
    return this.#loadPrepared(prepared) as Promise<Font<Format>>;
  }

  async loadAdvertised(excluding: readonly AnyRasterFormat[] = []): Promise<readonly Font<AnyRasterFormat>[]> {
    this.#assertActive();
    const excluded = new Set(excluding);
    const selected = this.#references
      .map((reference) => {
        const raster = rasterFormatForReference(reference);
        if (raster === undefined) {
          throw new FontLoadError(
            'FONT_FACE_FORMAT_UNAVAILABLE',
            `font advertises ${JSON.stringify(reference.kind)}, but its raster format is not imported`,
          );
        }
        return { reference, raster };
      })
      .filter(({ raster }) => !excluded.has(raster));
    const seen = new Set<string>();
    for (const { raster } of selected) {
      if (seen.has(raster.id)) {
        throw new FontLoadError(
          'FONT_FACE_FORMAT_AMBIGUOUS',
          `font advertises more than one ${JSON.stringify(raster.kind)} variant; declare the exact format contract`,
        );
      }
      seen.add(raster.id);
    }
    return Promise.all(selected.map(({ reference, raster }) => this.#loadReference(reference, raster)));
  }

  async snapshot(fonts: readonly Font<AnyRasterFormat>[]): Promise<SerializedFontFace> {
    this.#assertActive();
    const { snapshotSerializedFontFace } = await import('./internal/font-face-transfer-runtime.js');
    this.#assertActive();
    return snapshotSerializedFontFace(this.#font, fonts);
  }

  release(): void {
    if (this.#leases <= 0) throw new Error('FontFace source lease underflow');
    this.#leases -= 1;
    if (this.#leases === 0) this.dispose();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#remove();
    this.#controller.abort(new DOMException('FontFace source node was disposed', 'AbortError'));
    const variants = [...this.#variants.values()];
    this.#variants.clear();
    if (variants.length === 0) {
      this.#font.dispose();
      return;
    }
    const pending = variants.filter(({ value }) => value === undefined);
    for (const variant of variants) if (variant.value !== undefined) releaseImmutableFontVariant(variant.value);
    if (pending.length === 0) return;
    void Promise.allSettled(pending.map(({ promise }) => promise)).then((results) => {
      for (const result of results) if (result.status === 'fulfilled') releaseImmutableFontVariant(result.value);
      if (this.#backing.leases === 0 && !this.#backing.released) this.#font.dispose();
    });
  }

  async #loadPrepared(prepared: PreparedRasterRequest): Promise<Font<AnyRasterFormat>> {
    const rasterKey = await deriveRasterKey({
      descriptor: prepared.descriptor,
      extension: prepared.request.raster.extension,
      kind: prepared.request.raster.kind,
      version: prepared.request.raster.version,
    });
    this.#assertActive();
    const variant = await this.#variant(`${prepared.request.raster.id}:${rasterKey}`, () =>
      loadImmutableVariant(this.#font, this.#backing, prepared, this.#controller.signal),
    );
    this.#assertActive();
    return createImmutableFontLease(variant);
  }

  async #loadReference(reference: RasterReference, raster: AnyRasterFormat): Promise<Font<AnyRasterFormat>> {
    const variant = await this.#variant(`${raster.id}:${reference.rasterKey}`, () =>
      loadAdvertisedVariant(this.#font, this.#backing, reference, raster, this.#controller.signal),
    );
    this.#assertActive();
    return createImmutableFontLease(variant);
  }

  #variant(
    key: string,
    create: () => Promise<ImmutableFontVariant<AnyRasterFormat>>,
  ): Promise<ImmutableFontVariant<AnyRasterFormat>> {
    const existing = this.#variants.get(key);
    if (existing !== undefined) return existing.promise;
    let shared!: SharedFontFaceVariant;
    const promise = create().then(
      (variant) => {
        shared.value = variant;
        retainImmutableFontVariant(variant);
        if (this.#disposed || this.#variants.get(key) !== shared) {
          releaseImmutableFontVariant(variant);
          throw new DOMException('FontFace source node was disposed', 'AbortError');
        }
        return variant;
      },
      (error: unknown) => {
        if (this.#variants.get(key) === shared) this.#variants.delete(key);
        throw error;
      },
    );
    shared = { promise, value: undefined };
    this.#variants.set(key, shared);
    return promise;
  }

  #assertActive(): void {
    if (this.#disposed) throw new DOMException('FontFace source node was disposed', 'AbortError');
  }
}

class FontFaceSourceLeaseImpl implements FontFaceSourceLease {
  readonly #node: FontFaceSourceNode;
  #disposed = false;

  constructor(node: FontFaceSourceNode) {
    this.#node = node;
  }

  get formats(): readonly string[] {
    this.#assertActive();
    return this.#node.formats;
  }

  load<Format extends AnyRasterFormat>(raster: RasterFormatInput<Format>): Promise<Font<Format>> {
    this.#assertActive();
    return this.#node.load(raster);
  }

  loadAdvertised(excluding?: readonly AnyRasterFormat[]): Promise<readonly Font<AnyRasterFormat>[]> {
    this.#assertActive();
    return this.#node.loadAdvertised(excluding);
  }

  snapshot(fonts: readonly Font<AnyRasterFormat>[]): Promise<SerializedFontFace> {
    this.#assertActive();
    return this.#node.snapshot(fonts);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#node.release();
  }

  #assertActive(): void {
    if (this.#disposed) throw new DOMException('FontFace source lease was disposed', 'AbortError');
  }
}

async function loadFontFaceSourceFont(
  prepared: PreparedFontFaceSourceRequest,
  config: ImmutableLoaderConfig,
  signal: AbortSignal,
): Promise<RegisteredFont> {
  const registry = new FontRegistry({
    ...(config.maxArtifactBytes === undefined ? {} : { maxArtifactBytes: config.maxArtifactBytes }),
    ...(config.maxBufferViews === undefined ? {} : { maxBufferViews: config.maxBufferViews }),
    ...(config.maxRasters === undefined ? {} : { maxRasters: config.maxRasters }),
  });
  const workerRasters = await Promise.all(
    prepared.initialRasters
      .filter(({ request }) => workerRasterKinds.includes(request.raster.kind))
      .map(({ request, descriptor }) => runtimeBakeRaster(request.raster, descriptor)),
  );
  const selectedRuntimeBake = prepared.runtimeBake ?? config.runtimeBake;
  const runtimeBake: RuntimeFontBake = async (request) => {
    const bake = selectedRuntimeBake ?? (await loadDefaultRuntimeBake(request.sourceUrl));
    return bake({
      ...request,
      ...(prepared.unicodeRanges === undefined ? {} : { unicodeRanges: prepared.unicodeRanges }),
      rasters: workerRasters,
    });
  };
  const loader = new FontLoader({
    registry,
    ...(config.fetch === undefined ? {} : { fetch: config.fetch }),
    ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
    ...(config.development === undefined ? {} : { development: config.development }),
    runtimeBake,
    ...(prepared.unicodeRanges === undefined ? {} : { runtimeSourceIdentity: 'transformed' }),
    ...(config.onDiagnostic === undefined ? {} : { onDiagnostic: config.onDiagnostic }),
    ...(config.onWarning === undefined ? {} : { onWarning: config.onWarning }),
  });
  const font = await loader.load(prepared.input, { signal });
  signal.throwIfAborted();
  return font;
}

async function loadAdvertisedVariant(
  font: RegisteredFont,
  backing: ReturnType<typeof createImmutableFontBacking>,
  reference: RasterReference,
  format: AnyRasterFormat,
  signal: AbortSignal,
): Promise<ImmutableFontVariant<AnyRasterFormat>> {
  const raster = await font.loadRaster({ rasterKey: reference.rasterKey, kind: reference.kind }, { signal });
  signal.throwIfAborted();
  let data: unknown;
  try {
    data = await rasterFormatOperations(format).decode(font, raster, signal);
  } catch (error) {
    raster.dispose();
    throw error;
  }
  return createImmutableFontVariant({ backing, format, raster, data });
}

async function loadImmutableVariant(
  font: RegisteredFont,
  backing: ReturnType<typeof createImmutableFontBacking>,
  prepared: PreparedRasterRequest,
  signal: AbortSignal,
): Promise<ImmutableFontVariant<AnyRasterFormat>> {
  const format = prepared.request.raster;
  const rasterKey = await deriveRasterKey({
    descriptor: prepared.descriptor,
    extension: format.extension,
    kind: format.kind,
    version: format.version,
  });
  signal.throwIfAborted();
  let raster: RegisteredRaster;
  try {
    raster = await font.loadRaster({ rasterKey, kind: format.kind }, { signal });
  } catch (error) {
    if (!isRasterMiss(error)) throw error;
    raster = await runtimeBakeFormat(font, prepared.request, rasterKey, signal);
  }
  signal.throwIfAborted();
  let data: unknown;
  try {
    data = await rasterFormatOperations(format).decode(font, raster, signal);
  } catch (error) {
    raster.dispose();
    throw error;
  }
  return createImmutableFontVariant({
    backing,
    format,
    raster: raster as RegisteredRaster<RasterKindOf<typeof format>>,
    data,
  });
}

async function runtimeBakeFormat(
  font: RegisteredFont,
  request: RasterFormatRequest<AnyRasterFormat>,
  rasterKey: RasterKey,
  signal: AbortSignal,
): Promise<RegisteredRaster> {
  const format = request.raster;
  const loadBaker = rasterFormatOperations(format).runtimeBaker;
  if (loadBaker === undefined) {
    throw new FontLoadError('RASTER_NOT_FOUND', `${format.kind} has no baked artifact or runtime baker`);
  }
  const registered = getRegisteredFontData(font);
  if (registered.sourceBytes === undefined) {
    throw new FontLoadError(
      'RASTER_SOURCE_UNAVAILABLE',
      `${format.kind} runtime generation requires retained source bytes`,
    );
  }
  const imported = await loadBaker();
  signal.throwIfAborted();
  const baker = 'default' in imported ? imported.default : imported;
  assertMatchingBaker(format, baker);
  const baked = await baker.bake({
    source: registered.sourceBytes.slice(),
    font,
    fontFaceIndex: registered.fontFaceIndex,
    rasterKey,
    options: request.options,
    signal,
  } as TechniqueRasterBakeRequest<unknown>);
  assertMatchingArtifact(format, rasterKey, baked);
  const artifacts = baked.artifacts.filter((artifact) => artifact.role === 'raster');
  if (artifacts.length !== 1) {
    throw new FontLoadError('INVALID_RASTER_ASSET', 'runtime raster generation must return one raster artifact');
  }
  return fontRegistry(font)._attachGeneratedRaster(font, artifacts[0]!.bytes, {
    rasterKey,
    kind: baked.kind,
    extension: baked.extension,
    version: baked.version,
  });
}

function prepareFontFaceSourceRequest(
  input: LoadFontInput,
  initialRasters: readonly RasterFormatInput<AnyRasterFormat>[],
  config: ImmutableLoaderConfig,
): PreparedFontFaceSourceRequest {
  if (!Array.isArray(initialRasters)) throw new TypeError('FontFace initial formats must be an array');
  const rasters = initialRasters.map((raster, index) => prepareRasterRequest(raster, index));
  const identities = new Set<string>();
  for (const raster of rasters) {
    if (identities.has(raster.identity)) throw new TypeError('FontFace cannot repeat one raster format');
    identities.add(raster.identity);
  }
  const normalizedInput = prepareLoadInput(input);
  const resolved = resolveFontRequest(normalizedInput.input, resolveBaseUrl(config.baseUrl));
  return {
    input: normalizedInput.input,
    ...(normalizedInput.runtimeBake === undefined ? {} : { runtimeBake: normalizedInput.runtimeBake }),
    ...(normalizedInput.unicodeRanges === undefined ? {} : { unicodeRanges: normalizedInput.unicodeRanges }),
    initialRasters: rasters,
    key: `${requestKey(resolved)}:runtime:${functionIdentity(normalizedInput.runtimeBake ?? config.runtimeBake)}:ranges:${canonicalJson((normalizedInput.unicodeRanges ?? null) as never)}:font-face-source`,
  };
}

function ownPreparedFontFaceSourceBytes(prepared: PreparedFontFaceSourceRequest): PreparedFontFaceSourceRequest {
  return { ...prepared, input: ownFontInputBytes(prepared.input) };
}

function ownFontInputBytes(input: FontInput): FontInput {
  const value = normalizeFontInput(input);
  const own = (location: string | URL | FontBytesInput): string | URL | FontBytesInput => {
    if (!isFontBytesInput(location)) return location;
    return {
      bytes: ownFontBytes(location.bytes, location.ownership ?? 'copy'),
      ownership: 'transfer',
    };
  };
  if (value.source === undefined) return { baked: own(value.baked!) };
  return {
    source: own(value.source),
    ...(value.baked === undefined ? {} : { baked: value.baked === null ? null : own(value.baked) }),
  };
}

function prepareLoadInput(value: unknown): {
  readonly input: FontInput;
  readonly runtimeBake?: RuntimeFontBake;
  readonly unicodeRanges?: readonly RuntimeBakeUnicodeRange[];
} {
  if (isNonArrayObject(value) && Object.hasOwn(value, 'runtimeBake')) {
    if (typeof value.runtimeBake !== 'function') throw new TypeError('font request runtimeBake must be a function');
    const source = fontLocationValue(value.source, 'input.source');
    if (source === undefined) throw new TypeError('runtime-baked font request requires a source');
    const unicodeRanges =
      value.unicodeRanges === undefined
        ? undefined
        : normalizeUnicodeRanges(value.unicodeRanges as readonly RuntimeBakeUnicodeRange[]);
    return {
      input: { source, baked: null },
      runtimeBake: value.runtimeBake as RuntimeFontBake,
      ...(unicodeRanges === undefined ? {} : { unicodeRanges }),
    };
  }
  normalizeFontInput(value as FontInput);
  return { input: value as FontInput };
}

function prepareRasterRequest(value: unknown, index: number): PreparedRasterRequest {
  const request = isRasterFormat(value)
    ? { raster: value }
    : requireNonArrayObject(value, `font request raster ${index}`);
  if (!isRasterFormat(request.raster)) {
    throw new TypeError(`font request raster ${index} must use a package-defined raster format`);
  }
  const format = request.raster;
  const operations = rasterFormatOperations(format);
  const descriptor = operations.descriptor(request.options as RasterOptionsArgument<RasterOptionsOf<typeof format>>);
  const identity = `${format.id}:${canonicalJson(descriptor)}`;
  return {
    request: {
      raster: format,
      ...(request.options === undefined ? {} : { options: request.options }),
    } as RasterFormatRequest<AnyRasterFormat>,
    descriptor,
    identity,
  };
}

async function runtimeBakeRaster(
  format: AnyRasterFormat,
  descriptor: RasterFormatTypesOf<AnyRasterFormat>['descriptor'],
): Promise<RuntimeBakeRaster> {
  return {
    kind: format.kind,
    extension: format.extension,
    version: format.version,
    rasterKey: await deriveRasterKey({
      descriptor,
      extension: format.extension,
      kind: format.kind,
      version: format.version,
    }),
    descriptor,
  };
}

interface RasterFormatOperations<Format extends AnyRasterFormat> {
  readonly runtimeBaker?: RuntimeRasterBakerLoader<RasterKindOf<Format>, RasterOptionsOf<Format>>;
  descriptor(options: RasterOptionsArgument<RasterOptionsOf<Format>>): RasterFormatTypesOf<Format>['descriptor'];
  decode(
    font: RegisteredFont,
    raster: RegisteredRaster<RasterKindOf<Format>>,
    signal?: AbortSignal,
  ): Promise<RasterDataOf<Format>>;
}

function rasterFormatOperations<Format extends AnyRasterFormat>(format: Format): RasterFormatOperations<Format> {
  return format as unknown as RasterFormatOperations<Format>;
}

function assertMatchingBaker<Options>(format: AnyRasterFormat, baker: RuntimeRasterBakerModule<string, Options>): void {
  if (baker.kind !== format.kind) throw new FontLoadError('RASTER_INCOMPATIBLE', 'runtime baker kind mismatch');
}

function assertMatchingArtifact(format: AnyRasterFormat, rasterKey: string, artifact: RasterBakeArtifact): void {
  if (
    artifact.kind !== format.kind ||
    artifact.extension !== format.extension ||
    artifact.version !== format.version ||
    artifact.rasterKey !== rasterKey
  ) {
    throw new FontLoadError('RASTER_INCOMPATIBLE', 'runtime raster artifact does not match the selected format');
  }
}

function isRasterMiss(error: unknown): boolean {
  return error instanceof FontLoadError && error.code === 'RASTER_NOT_FOUND';
}

function fontRegistry(font: RegisteredFont): FontRegistry {
  return registeredFontRegistry(font);
}

function functionIdentity(value: Function | undefined): string {
  return value === undefined ? '' : String(objectIdentity(value));
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
  readonly sourceBytes?: FontBytesInput;
  readonly bakedUrl?: string;
  readonly bakedBytes?: FontBytesInput;
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
      resources: getRegisteredFontData(this).resources,
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
  readonly resources: Map<string, RegisteredRasterResourceData>;
  readonly resourceCandidates: readonly RegisteredRasterResourceCandidate[];
  readonly handle: RasterHandle;
}

class RegisteredRasterImpl implements RegisteredRaster {
  readonly #owner: RegisteredFontImpl;
  readonly #binaryBytes: Uint8Array;
  readonly #views: readonly RegisteredBufferView[];
  readonly #reference: RasterReference;
  readonly #resources: Map<string, RegisteredRasterResourceData>;
  readonly #resourceLoads = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();
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
    this.#resources = init.resources;
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
    return this.#binaryBytes.subarray(view.byteOffset, view.byteOffset + view.byteLength);
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

    const identity = rasterResourceIdentity(source.artifactHash, source.byteLength);
    const cached = this.#resources.get(identity);
    if (cached !== undefined) {
      this.#retainResourceIdentity(identity);
      return cached.bytes;
    }
    const pending = this.#resourceLoads.get(identity);
    if (pending !== undefined) return pending;
    let operation!: Promise<Uint8Array<ArrayBuffer>>;
    operation = this.#loadExternalResource(source, signal).then(
      (bytes) => {
        if (this.#resourceLoads.get(identity) === operation) this.#resourceLoads.delete(identity);
        const resource = Object.freeze({
          artifactHash: source.artifactHash,
          byteLength: source.byteLength,
          bytes,
        });
        this.#resources.set(identity, resource);
        this.#retainResourceIdentity(identity);
        return bytes;
      },
      (error: unknown) => {
        if (this.#resourceLoads.get(identity) === operation) this.#resourceLoads.delete(identity);
        throw error;
      },
    );
    this.#resourceLoads.set(identity, operation);
    return operation;
  }

  #retainResourceIdentity(identity: string): void {
    const source = getRegisteredFontData(this.#owner).rasterSources.get(this.rasterKey);
    if (source === undefined) throw new Error('registered raster source data is unavailable');
    source.resourceIdentities.add(identity);
  }

  async #loadExternalResource(
    source: Extract<RasterResourceSource, { readonly type: 'external' }>,
    signal: AbortSignal | undefined,
  ): Promise<Uint8Array<ArrayBuffer>> {
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
    this.#resourceLoads.clear();
    this.#owner.removeRaster(this);
  }

  disposeFromOwner(): void {
    this.#disposed = true;
    this.#resourceLoads.clear();
  }

  #assertActive(): void {
    this.#owner.assertActive();
    if (this.#disposed) throw new FontLoadError('STALE_RASTER_HANDLE', 'raster has been disposed');
  }
}

function mergeRegisteredFontAcquisition(target: RegisteredFont, candidate: RegisteredFont): void {
  const targetData = getRegisteredFontData(target);
  const candidateData = getRegisteredFontData(candidate);
  if (targetData.sourceBytes === undefined && candidateData.sourceBytes !== undefined) {
    targetData.sourceBytes = candidateData.sourceBytes;
  }
  for (const source of candidateData.sourceCandidates) {
    if (
      !targetData.sourceCandidates.some(
        (current) =>
          current.sourceHash === source.sourceHash &&
          current.sourceUrl === source.sourceUrl &&
          current.fetch === source.fetch,
      )
    ) {
      targetData.sourceCandidates.push(source);
    }
  }
  for (const [rasterKey, source] of candidateData.rasterSources) {
    const targetSource = targetData.rasterSources.get(rasterKey)!;
    if (targetSource.artifactBytes === undefined && source.artifactBytes !== undefined) {
      if (
        source.artifactHash === undefined ||
        source.extensionData === undefined ||
        source.binaryBytes === undefined ||
        source.bufferViews === undefined
      ) {
        throw new Error('retained raster artifact data is incomplete');
      }
      targetSource.artifactBytes = source.artifactBytes;
      targetSource.artifactHash = source.artifactHash;
      targetSource.extensionData = source.extensionData;
      targetSource.binaryBytes = source.binaryBytes;
      targetSource.bufferViews = source.bufferViews;
    }
    for (const identity of source.resourceIdentities) targetSource.resourceIdentities.add(identity);
    for (const external of source.externalCandidates) {
      if (
        !targetSource.externalCandidates.some(
          (current) =>
            sameExternalSource(current.source, external.source) &&
            current.artifactUrl === external.artifactUrl &&
            current.fetch === external.fetch,
        )
      ) {
        targetSource.externalCandidates.push(external);
      }
    }
    const resources = mergeResourceCandidates(targetSource.resourceCandidates, source.resourceCandidates);
    targetSource.resourceCandidates.splice(0, targetSource.resourceCandidates.length, ...resources);
    const raster = target.getRaster(rasterKey);
    if (raster instanceof RegisteredRasterImpl) raster.addResourceCandidates(source.resourceCandidates);
  }
  for (const [identity, resource] of candidateData.resources) {
    if (!targetData.resources.has(identity)) targetData.resources.set(identity, resource);
  }
}

function retainRasterArtifactData(
  font: RegisteredFontImpl,
  reference: RasterReference,
  extensionData: JsonValue,
  binaryBytes: Uint8Array,
  views: readonly RegisteredBufferView[],
  artifactBytes: Uint8Array<ArrayBuffer>,
  artifactHash: string,
  resourceCandidates: readonly RegisteredRasterResourceCandidate[],
): RegisteredRasterSourceData {
  const sources = getRegisteredFontData(font).rasterSources;
  const current = sources.get(reference.rasterKey);
  if (current === undefined) {
    const created: RegisteredRasterSourceData = {
      reference: freezeReference(reference),
      extensionData,
      binaryBytes,
      bufferViews: views,
      artifactBytes,
      artifactHash,
      resourceIdentities: new Set(),
      externalCandidates: [],
      resourceCandidates: mergeResourceCandidates([], resourceCandidates),
    };
    sources.set(reference.rasterKey, created);
    return created;
  }
  if (
    current.reference.kind !== reference.kind ||
    current.reference.extension !== reference.extension ||
    current.reference.version !== reference.version ||
    (current.artifactHash !== undefined && current.artifactHash !== artifactHash)
  ) {
    throw new FontLoadError('RASTER_REFERENCE_CONFLICT', 'one raster identity resolved to conflicting artifact data');
  }
  current.extensionData ??= extensionData;
  current.binaryBytes ??= binaryBytes;
  current.bufferViews ??= views;
  current.artifactBytes ??= artifactBytes;
  current.artifactHash ??= artifactHash;
  current.resourceCandidates.splice(
    0,
    current.resourceCandidates.length,
    ...mergeResourceCandidates(current.resourceCandidates, resourceCandidates),
  );
  return current;
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
          resourceIdentities: current.resourceIdentities,
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
      resourceIdentities: new Set(),
      externalCandidates: externalCandidate === undefined ? [] : [externalCandidate],
      resourceCandidates: resourceCandidate === undefined ? [] : [resourceCandidate],
    });
  }
}

function mergeSourceContext(font: RegisteredFontImpl, sourceHash: string, context: FontAssetContext): void {
  const data = getRegisteredFontData(font);
  if (sourceHash === data.sourceHash && context.sourceBytes !== undefined && data.sourceBytes === undefined) {
    data.sourceBytes = context.sourceBytes;
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

function resolveFontRequest(input: FontInput, baseUrl: URL | undefined): ResolvedFontRequest {
  const value = normalizeFontInput(input);
  if (value.source === undefined) {
    if (isFontBytesInput(value.baked)) return { bakedBytes: value.baked };
    return { bakedUrl: normalizeUrl(value.baked!, baseUrl) };
  }
  if (isFontBytesInput(value.source)) {
    if (value.baked === undefined || value.baked === null) return { sourceBytes: value.source };
    if (isFontBytesInput(value.baked)) return { sourceBytes: value.source, bakedBytes: value.baked };
    return { sourceBytes: value.source, bakedUrl: normalizeUrl(value.baked, baseUrl) };
  }
  const source = normalizeUrl(value.source, baseUrl);
  const sourceUrl = new URL(source);
  if (value.baked === null) return { sourceUrl: source };
  if (value.baked !== undefined) {
    if (isFontBytesInput(value.baked)) return { sourceUrl: source, bakedBytes: value.baked };
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
  source?: string | URL | FontBytesInput;
  baked?: string | URL | FontBytesInput | null;
} {
  if (typeof input === 'string' || input instanceof URL) return { source: input };
  if (typeof input !== 'object' || input === null) {
    throw new FontLoadError('INVALID_FONT_INPUT', 'font input must be a URL or source object');
  }
  const value = input as { source?: unknown; baked?: unknown };
  const source = fontLocationValue(value.source, 'source');
  const baked = value.baked === null ? null : fontLocationValue(value.baked, 'baked');
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

function persistentResponseExpiration(response: Response, now = Date.now()): number | undefined {
  const cacheControl = response.headers.get('cache-control')?.toLowerCase();
  if (cacheControl !== undefined) {
    const directives = cacheControl.split(',').map((directive) => directive.trim());
    if (directives.includes('no-store') || directives.includes('no-cache')) return undefined;
    const maxAge = directives
      .map((directive) => /^max-age=(?:"(\d+)"|(\d+))$/.exec(directive))
      .find((match) => match !== null);
    if (maxAge !== undefined) {
      const seconds = Number(maxAge[1] ?? maxAge[2]);
      if (!Number.isSafeInteger(seconds) || seconds <= 0) return undefined;
      const responseDate = Date.parse(response.headers.get('date') ?? '');
      const base = Number.isFinite(responseDate) ? responseDate : now;
      const expiresAt = base + seconds * 1_000;
      return Number.isSafeInteger(expiresAt) && expiresAt > now ? expiresAt : undefined;
    }
  }
  const expiresAt = Date.parse(response.headers.get('expires') ?? '');
  return Number.isFinite(expiresAt) && expiresAt > now ? expiresAt : undefined;
}

function resolveBaseUrl(value: string | URL | undefined): URL | undefined {
  if (value !== undefined) return new URL(value);
  const location = (globalThis as { location?: { href?: string } }).location?.href;
  return location === undefined ? undefined : new URL(location);
}

function requestKey(request: ResolvedFontRequest): string {
  return `font:${CORE_FORMAT_VERSION}:${CORE_BAKER_VERSION}:${request.sourceUrl ?? byteInputKey(request.sourceBytes)}:${request.bakedUrl ?? byteInputKey(request.bakedBytes)}`;
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

function copyView(value: ArrayBufferView): Uint8Array<ArrayBuffer> {
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice() as Uint8Array<ArrayBuffer>;
}

function ownFontBytes(value: ArrayBufferView, ownership: FontByteOwnership): Uint8Array<ArrayBuffer> {
  if (!ArrayBuffer.isView(value)) throw new TypeError('font bytes must be an ArrayBuffer view');
  if (value.byteLength === 0) throw new TypeError('font bytes must not be empty or detached');
  if (ownership === 'copy') return copyView(value) as Uint8Array<ArrayBuffer>;
  if (ownership === 'adopt') {
    if (!(value.buffer instanceof ArrayBuffer))
      throw new TypeError('internally adopted font bytes need an ArrayBuffer');
    if (value.byteOffset !== 0 || value.byteLength !== value.buffer.byteLength) {
      throw new TypeError('internally adopted font bytes must span their complete ArrayBuffer');
    }
    return new Uint8Array(value.buffer);
  }
  if (ownership !== 'transfer') throw new TypeError('font byte ownership must be copy or transfer');
  if (!(value.buffer instanceof ArrayBuffer)) {
    throw new TypeError('transferred font bytes cannot use SharedArrayBuffer');
  }
  if (value.byteOffset !== 0 || value.byteLength !== value.buffer.byteLength) {
    throw new TypeError('transferred font bytes must span their complete ArrayBuffer');
  }
  const transferred = structuredClone(value.buffer, { transfer: [value.buffer] });
  return new Uint8Array(transferred);
}

function fontLocationValue(value: unknown, name: string): string | URL | FontBytesInput | undefined {
  if (value === undefined || typeof value === 'string' || value instanceof URL) return value;
  if (!isNonArrayObject(value) || !Object.hasOwn(value, 'bytes')) {
    throw new TypeError(`${name} must be a URL or explicit font byte input`);
  }
  const bytes = value.bytes;
  if (!ArrayBuffer.isView(bytes)) throw new TypeError(`${name}.bytes must be an ArrayBuffer view`);
  if (bytes.byteLength === 0) throw new TypeError(`${name}.bytes must not be empty or detached`);
  const ownership = value.ownership;
  if (ownership !== undefined && ownership !== 'copy' && ownership !== 'transfer') {
    throw new TypeError(`${name}.ownership must be copy or transfer`);
  }
  if (ownership === 'transfer') {
    if (!(bytes.buffer instanceof ArrayBuffer)) {
      throw new TypeError(`${name} transfer bytes cannot use SharedArrayBuffer`);
    }
    if (bytes.byteLength === 0 || bytes.byteOffset !== 0 || bytes.byteLength !== bytes.buffer.byteLength) {
      throw new TypeError(`${name} transfer bytes must be a non-empty view spanning its complete ArrayBuffer`);
    }
  }
  return ownership === undefined ? { bytes } : { bytes, ownership };
}

function isFontBytesInput(value: unknown): value is FontBytesInput {
  return isNonArrayObject(value) && Object.hasOwn(value, 'bytes');
}

function byteInputKey(input: FontBytesInput | undefined): string {
  if (input === undefined) return '';
  return `bytes:${objectIdentity(input.bytes.buffer)}:${input.bytes.byteOffset}:${input.bytes.byteLength}:${input.ownership ?? 'copy'}`;
}

/** @internal Validate font-load options at an adapter call boundary. */
export function fontLoadSignal(options: unknown): AbortSignal | undefined {
  if (!isNonArrayObject(options)) throw new TypeError('font load options must be an object');
  if (Object.keys(options).some((key) => key !== 'signal')) {
    throw new TypeError('font load options only accept signal');
  }
  const signal = options.signal;
  if (signal !== undefined && !(signal instanceof AbortSignal)) {
    throw new TypeError('font load signal must be an AbortSignal');
  }
  return signal;
}

function objectIdentity(value: object): number {
  let identity = objectIdentities.get(value);
  if (identity === undefined) {
    identity = nextObjectIdentity++;
    objectIdentities.set(value, identity);
  }
  return identity;
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
): Promise<Uint8Array<ArrayBuffer>> {
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
  return bytes as Uint8Array<ArrayBuffer>;
}

function rasterResourceIdentity(artifactHash: string, byteLength: number): string {
  return `${artifactHash}:${byteLength}`;
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
