import type { Font } from './font.js';
import { cloneImmutableFont } from './loaded-font.js';
import {
  GlyphFontError,
  openFontFaceSource,
  openSerializedFontFaceSource,
  type FontFaceSourceLease,
  type FontLibrary,
  type LoadFontInput,
} from './loader.js';
import type { FontFaceTransfer, SerializedFontFace } from './font-face-transfer.js';
import {
  claimSerializedFontFace,
  isSerializedFontFace,
  serializedFontFaceBuffers,
} from './internal/font-face-transfer.js';
import type {
  RasterFormatInput,
  RasterFormatMetadata,
  RasterFormatRequest,
  RasterFormatRequestMetadata,
} from './config/raster-format.js';
import { isRasterFormat, isRasterFormatRequest, rasterFormatForKey } from './internal/raster-format-registry.js';

/** Canonical source accepted by a reusable FontFace declaration. */
export type FontFaceSource = string | URL | Blob | SerializedFontFace;

/** One format assertion accepted by a FontFace declaration. */
export type FontFaceFormat<Format extends RasterFormatMetadata = RasterFormatMetadata> =
  | string
  | (RasterFormatMetadata extends Format ? Format | RasterFormatRequestMetadata : RasterFormatInput<Format>);

export type FontFaceFormatDeclaration = FontFaceFormat | readonly [FontFaceFormat, ...FontFaceFormat[]];

type ValidFontFaceFormat<Format> = Format extends RasterFormatMetadata
  ? Format extends RasterFormatInput<Format>
    ? Format
    : never
  : Format extends string | RasterFormatRequestMetadata
    ? Format
    : never;

type ValidFontFaceFormatDeclaration<Declaration> = Declaration extends readonly []
  ? never
  : Declaration extends readonly unknown[]
    ? {
        readonly [Index in keyof Declaration]: ValidFontFaceFormat<Declaration[Index]>;
      }
    : ValidFontFaceFormat<Declaration>;

/** Format input after enforcing option-bearing raster contracts. */
export type FontFaceFormatInput<Declaration> = Declaration & ValidFontFaceFormatDeclaration<Declaration>;

export type FontFaceDeclaredFormat<Declaration> = Declaration extends readonly FontFaceFormat[]
  ? Declaration[number]
  : Extract<Declaration, FontFaceFormat>;

/** Optional identity and format assertion for one FontFace source. */
export type FontFaceConfig<Declaration = FontFaceFormatDeclaration> = {
  readonly family?: string;
  readonly format?: FontFaceFormatInput<Declaration>;
};

type RasterOfFormat<Format> = Format extends RasterFormatMetadata
  ? Format
  : Format extends RasterFormatRequest<infer Raster>
    ? Raster
    : Format extends RasterFormatRequestMetadata
      ? Format['raster']
      : RasterFormatMetadata;

/** Concrete raster carried by a typed FontFace selection; string/default selections remain handle-relative. */
export type FontFaceRasterOf<Selection> =
  Selection extends FontFaceSelection<infer Format> ? RasterOfFormat<Exclude<Format, undefined>> : RasterFormatMetadata;

type FormatKey<Format> = Format extends string
  ? Format
  : Format extends RasterFormatMetadata
    ? Format['kind']
    : Format extends RasterFormatRequest<infer Raster>
      ? Raster['kind']
      : Format extends RasterFormatRequestMetadata
        ? Format['raster']['kind']
        : never;

type FormatForKey<Format, Key extends PropertyKey> = Format extends unknown
  ? FormatKey<Format> extends Key
    ? Format
    : never
  : never;

/** One default or named format selection belonging to a FontFace. */
export interface FontFaceSelection<Format extends FontFaceFormat | undefined = FontFaceFormat | undefined> {
  readonly family: string;
  readonly format: Format;
  readonly face: FontFace;
  /** Load this exact declared format selection. */
  load(): Promise<FontFaceSelection<Format>>;
  /** Read this selection's readiness without observing its Promise. */
  isLoaded(): boolean;
  /** Explicitly copy this loaded selection into fresh structured-clone transfer buffers. */
  clone(): Promise<FontFaceTransfer>;
}

type FontFaceMembers<Formats extends FontFaceFormat> =
  string extends FormatKey<Formats>
    ? object
    : {
        readonly [Key in FormatKey<Formats>]: FontFaceSelection<FormatForKey<Formats, Key>>;
      };

/** Reusable FontFace declaration whose keyed selections are inferred from its asserted formats. */
export type FontFace<Formats extends FontFaceFormat = FontFaceFormat> = Omit<
  FontFaceSelection<Formats | undefined>,
  'face' | 'load'
> & {
  readonly face: FontFace<Formats>;
  readonly default: FontFace<Formats>;
  readonly disposed: boolean;
  load(): Promise<FontFace<Formats>>;
  /** Inspect the ordered format keys advertised by the authoritative main font. */
  formats(): Promise<readonly string[]>;
  dispose(): void;
} & FontFaceMembers<Formats>;

export type FontFormatMap = Readonly<object>;

interface FontFaceResourceOwner {
  readonly records: Map<RasterFormatMetadata, LoadedFaceRecord>;
  sourcePromise: Promise<FontFaceSourceLease> | undefined;
  sourceLease: FontFaceSourceLease | undefined;
  sourceController: AbortController | undefined;
  disposed: boolean;
}

interface FontFaceState {
  readonly library: FontLibrary;
  readonly source: FontFaceSource;
  readonly family: string;
  readonly formats: readonly FontFaceFormat[];
  readonly owner: FontFaceResourceOwner;
  readonly selections: ReadonlyMap<string, FontFaceSelection>;
  formatsPromise: Promise<readonly string[]> | undefined;
  aggregatePromise: Promise<FontFace> | undefined;
  aggregateLoaded: boolean;
}

interface FontFaceSelectionState {
  readonly face: FontFaceState;
  readonly format: FontFaceFormat | undefined;
  readonly aggregate: boolean;
  readonly promises: Map<RasterFormatMetadata, Promise<FontFaceSelection>>;
}

interface CatalogEntry {
  readonly generation: number;
  readonly face: WeakRef<FontFace>;
}

interface FinalizerRecord {
  readonly family: string;
  readonly generation: number;
  readonly owner: FontFaceResourceOwner;
}

const faceStates = new WeakMap<object, FontFaceSelectionState>();
const blobInputs = new WeakMap<Blob, Promise<LoadFontInput>>();
const catalog = new Map<string, CatalogEntry>();
let nextGeneratedFamily = 1;
let nextCatalogGeneration = 1;

const faceFinalizer = new FinalizationRegistry<FinalizerRecord>((record) => {
  disposeFontFaceResourceOwner(record.owner);
  const current = catalog.get(record.family);
  if (current?.generation === record.generation && current.face.deref() === undefined) catalog.delete(record.family);
});

/** Create one FontFace declaration and register its family as a weak root-catalog alias. */
export function createFontFace<const Declaration extends FontFaceFormatDeclaration = never>(
  library: FontLibrary,
  source: FontFaceSource,
  config?: FontFaceConfig<Declaration>,
): FontFace<FontFaceDeclaredFormat<Declaration>>;

export function createFontFace(library: FontLibrary, source: FontFaceSource, config: FontFaceConfig = {}): FontFace {
  assertFontFaceSource(source);
  assertFontFaceConfig(config);
  const family = config.family === undefined ? nextFamily() : normalizedFamily(config.family);
  const existing = catalog.get(family)?.face.deref();
  if (existing !== undefined && !existing.disposed) {
    throw new Error(`FontFace family ${JSON.stringify(family)} already exists`);
  }
  const ownedSource = isSerializedFontFace(source) ? claimSerializedFontFace(source) : source;

  const formats = formatList(config.format);
  const selections = new Map<string, FontFaceSelection>();
  const owner: FontFaceResourceOwner = {
    records: new Map(),
    sourcePromise: undefined,
    sourceLease: undefined,
    sourceController: undefined,
    disposed: false,
  };
  const state: FontFaceState = {
    library,
    source: ownedSource,
    family,
    formats,
    owner,
    selections,
    formatsPromise: undefined,
    aggregatePromise: undefined,
    aggregateLoaded: false,
  };
  let face!: FontFace;
  const defaultFormat = formats[0];
  const base: FontFace = {
    family,
    format: defaultFormat,
    get face(): FontFace {
      return face;
    },
    get default(): FontFace {
      return face;
    },
    get disposed(): boolean {
      return owner.disposed;
    },
    load(): Promise<FontFace> {
      return loadFontFace(face);
    },
    formats(): Promise<readonly string[]> {
      return fontFaceFormats(face);
    },
    isLoaded(): boolean {
      return isFontFaceLoaded(face);
    },
    clone(): Promise<FontFaceTransfer> {
      return cloneFontFace(face);
    },
    dispose(): void {
      disposeFontFace(face);
    },
  };
  face = base;
  faceStates.set(face, { face: state, format: defaultFormat, aggregate: true, promises: new Map() });
  for (const format of formats) {
    const key = formatName(format);
    if (selections.has(key)) throw new TypeError(`FontFace format ${JSON.stringify(key)} is declared more than once`);
    let selection!: FontFaceSelection;
    selection = Object.freeze({
      family,
      format,
      face,
      load(): Promise<FontFaceSelection> {
        return loadDeclaredFontFaceSelection(selection);
      },
      isLoaded(): boolean {
        return isDeclaredFontFaceSelectionLoaded(selection);
      },
      clone(): Promise<FontFaceTransfer> {
        return cloneFontFace(selection);
      },
    });
    faceStates.set(selection, { face: state, format, aggregate: false, promises: new Map() });
    selections.set(key, selection);
    Object.defineProperty(base, key, { enumerable: true, value: selection });
  }
  Object.freeze(base);

  const generation = nextCatalogGeneration++;
  catalog.set(family, { generation, face: new WeakRef(face) });
  faceFinalizer.register(face, { family, generation, owner }, face);
  return face;
}

/** Resolve one live family from Glyph's weak root catalog. */
export function resolveFontFace(family: string): FontFace | undefined {
  const normalized = normalizedFamily(family);
  const entry = catalog.get(normalized);
  const face = entry?.face.deref();
  if (face === undefined && entry !== undefined) catalog.delete(normalized);
  return face?.disposed === false ? face : undefined;
}

/** Dispose one authentic FontFace declaration or selection's shared owner. */
export function disposeFontFace(face: FontFace): void {
  if ((typeof face !== 'object' && typeof face !== 'function') || face === null) {
    throw new TypeError('FontFace.dispose() requires an authentic FontFace declaration');
  }
  const selection = faceStates.get(face);
  if (selection === undefined) throw new TypeError('FontFace.dispose() requires an authentic FontFace declaration');
  if (selection.format !== face.format || selection.face.family !== face.family) {
    throw new TypeError('FontFace.dispose() must be called on the declaration, not a format selection');
  }
  if (selection.face.owner.disposed) return;
  faceFinalizer.unregister(face);
  disposeFontFaceState(selection.face);
  const current = catalog.get(selection.face.family);
  if (current?.face.deref() === face) catalog.delete(selection.face.family);
}

/** Authenticate a selection and return its declaration state. */
export function fontFaceSelectionState(selection: unknown): FontFaceSelectionState {
  if ((typeof selection !== 'object' && typeof selection !== 'function') || selection === null) {
    throw new TypeError('font must be a FontFace selection');
  }
  const state = faceStates.get(selection);
  if (state === undefined) throw new TypeError('font was not created by glyph.fontFace()');
  if (state.face.owner.disposed) {
    throw new TypeError(`FontFace ${JSON.stringify(state.face.family)} has been disposed`);
  }
  return state;
}

/** @internal Test whether a value is an authentic live FontFace declaration or selection. */
export function isFontFaceSelection(selection: unknown): selection is FontFaceSelection {
  if ((typeof selection !== 'object' && typeof selection !== 'function') || selection === null) return false;
  const state = faceStates.get(selection);
  return state !== undefined && !state.face.owner.disposed;
}

/**
 * @internal Acquire an independent immutable Font lease without a configured handle.
 *
 * A configured renderer may resolve an omitted or string format through its own format table.
 * A caller outside a handle has no such config, so it must provide a selection whose declared format
 * resolves to an imported raster format. The caller owns and must dispose the returned lease.
 */
export function acquireLoadedFontFaceSelection<const Selection extends FontFaceSelection>(
  selection: Selection,
): Font<FontFaceRasterOf<Selection>>;

export function acquireLoadedFontFaceSelection(selection: FontFaceSelection): Font<RasterFormatMetadata> {
  const selected = fontFaceSelectionState(selection);
  if (selected.format === undefined) {
    throw new GlyphFontError(
      'FONT_FACE_FORMAT_REQUIRED',
      `FontFace ${JSON.stringify(selection.family)} requires an explicit format outside a configured handle`,
    );
  }
  const raster = resolveDeclaredFormat(selected.format);
  return cloneImmutableFont(requiredFontFaceFormat(selection, raster));
}

interface LoadedFaceRecord {
  promise: Promise<Font<RasterFormatMetadata>>;
  font: Font<RasterFormatMetadata> | undefined;
}

/** Handle-local format selection over FontFace-owned immutable loads. */
export class FontFaceHandleStore {
  readonly #formats: Readonly<Record<string, RasterFormatMetadata>>;
  readonly #defaultFormat: string;
  #disposed = false;

  constructor(formats: FontFormatMap, defaultFormat: string) {
    if (typeof defaultFormat !== 'string' || defaultFormat.length === 0) {
      throw new TypeError('font default format must be a nonempty string');
    }
    const keys = Object.keys(formats);
    if (keys.length === 0) throw new TypeError('font format map must not be empty');
    const normalized: Record<string, RasterFormatMetadata> = {};
    for (const key of keys) {
      const raster: unknown = Reflect.get(formats, key);
      if (key.length === 0 || !isRasterFormat(raster)) {
        throw new TypeError('font format map must contain authentic raster formats under nonempty keys');
      }
      normalized[key] = raster;
    }
    if (normalized[defaultFormat] === undefined) {
      throw new TypeError(`font default format ${JSON.stringify(defaultFormat)} is not registered`);
    }
    this.#formats = Object.freeze(normalized);
    this.#defaultFormat = defaultFormat;
  }

  isLoaded(selection: FontFaceSelection): boolean {
    this.#assertActive();
    return isFontFaceFormatLoaded(selection, this.#resolveFormat(fontFaceSelectionState(selection).format));
  }

  load<const Selection extends FontFaceSelection>(selection: Selection): Promise<Selection> {
    this.#assertActive();
    return loadFontFaceFormat(selection, this.#resolveFormat(fontFaceSelectionState(selection).format));
  }

  acquire<const Selection extends FontFaceSelection>(selection: Selection): Font<FontFaceRasterOf<Selection>>;

  acquire(selection: FontFaceSelection): Font<RasterFormatMetadata> {
    this.#assertActive();
    const raster = this.#resolveFormat(fontFaceSelectionState(selection).format);
    const font = requiredFontFaceFormat(selection, raster);
    return cloneImmutableFont(font);
  }

  /** Borrow the store-owned immutable source. Callers must not dispose this value. */
  peek<const Selection extends FontFaceSelection>(selection: Selection): Font<FontFaceRasterOf<Selection>>;

  peek(selection: FontFaceSelection): Font<RasterFormatMetadata> {
    this.#assertActive();
    const raster = this.#resolveFormat(fontFaceSelectionState(selection).format);
    return requiredFontFaceFormat(selection, raster);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
  }

  #resolveFormat(format: FontFaceFormat | undefined): RasterFormatInput<RasterFormatMetadata> {
    if (format === undefined) return this.#formats[this.#defaultFormat]!;
    if (typeof format === 'string') {
      const raster = this.#formats[format];
      if (raster === undefined) throw new TypeError(`font format ${JSON.stringify(format)} is not supported`);
      return raster;
    }
    const request = format;
    const raster = isRasterFormat(request) ? request : request.raster;
    const configured = Object.values(this.#formats).find((candidate) => candidate === raster);
    if (configured === undefined) {
      throw new TypeError(`font format ${JSON.stringify(raster.kind)} is not supported`);
    }
    return request;
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('font handle store has been disposed');
  }
}

function loadFontFace<Formats extends FontFaceFormat>(face: FontFace<Formats>): Promise<FontFace<Formats>>;

function loadFontFace(face: FontFace): Promise<FontFace> {
  const selection = fontFaceSelectionState(face);
  const state = selection.face;
  if (!selection.aggregate) throw new TypeError('FontFace aggregate loading requires the declaration object');
  if (state.aggregatePromise !== undefined) return state.aggregatePromise;
  let promise!: Promise<FontFace>;
  promise = Promise.resolve()
    .then(() => loadAllFontFaceFormats(state))
    .then(
      () => {
        if (state.owner.disposed || state.aggregatePromise !== promise) {
          throw new DOMException('FontFace load owner was disposed', 'AbortError');
        }
        state.aggregateLoaded = true;
        return face;
      },
      (error: unknown) => {
        if (state.aggregatePromise === promise) {
          state.aggregatePromise = undefined;
        }
        throw error;
      },
    );
  state.aggregatePromise = promise;
  return promise;
}

async function cloneFontFace(selection: FontFaceSelection): Promise<FontFaceTransfer> {
  const selected = fontFaceSelectionState(selection);
  if (selected.aggregate) {
    await loadFontFace(selection.face);
  } else {
    await loadDeclaredFontFaceSelection(selection);
  }
  const fonts = selected.aggregate
    ? [...selected.face.owner.records.values()].map((record) => {
        if (record.font === undefined) throw new Error('loaded FontFace record has no immutable Font');
        return record.font;
      })
    : [requiredFontFaceFormat(selection, resolveDeclaredFormat(selected.format!))];
  const source = await ensureFontFaceSource(
    selected.face.owner,
    selected.face.library,
    selected.face.source,
    selected.face.formats.map(resolveDeclaredFormat),
  );
  const serialized = await source.snapshot(fonts);
  return [serialized, serializedFontFaceBuffers(serialized)];
}

async function loadAllFontFaceFormats(state: FontFaceState): Promise<void> {
  const owner = state.owner;
  const declared = state.formats.map(resolveDeclaredFormat);
  const source = await ensureFontFaceSource(owner, state.library, state.source, declared);
  const operations: Promise<readonly Font<RasterFormatMetadata>[]>[] = [
    ...declared.map((raster) => source.load(raster).then((font) => [font])),
    source.loadAdvertised(declared.map(rasterOf)),
  ];
  let groups: readonly (readonly Font<RasterFormatMetadata>[])[];
  try {
    groups = await Promise.all(operations);
  } catch (error) {
    const settled = await Promise.allSettled(operations);
    for (const result of settled) {
      if (result.status === 'fulfilled') for (const font of result.value) font.dispose();
    }
    throw error;
  }
  const fonts = groups.flat();
  if (fonts.length === 0) {
    throw new GlyphFontError(
      'FONT_FACE_FORMAT_REQUIRED',
      `FontFace ${JSON.stringify(state.family)} advertises no raster formats; runtime font sources must declare the formats to bake`,
    );
  }
  if (owner.disposed) {
    for (const font of fonts) font.dispose();
    throw new DOMException('FontFace load owner was disposed', 'AbortError');
  }
  for (const font of fonts) {
    const existing = owner.records.get(font.raster);
    if (existing !== undefined) {
      font.dispose();
      continue;
    }
    owner.records.set(font.raster, {
      promise: Promise.resolve(font),
      font,
    });
  }
}

function loadDeclaredFontFaceSelection<const Selection extends FontFaceSelection>(
  selection: Selection,
): Promise<Selection> {
  const selected = fontFaceSelectionState(selection);
  if (selected.aggregate || selected.format === undefined) {
    throw new TypeError('FontFace format loading requires a declared format member');
  }
  return loadFontFaceFormat(selection, resolveDeclaredFormat(selected.format));
}

function isDeclaredFontFaceSelectionLoaded(selection: FontFaceSelection): boolean {
  const selected = fontFaceSelectionState(selection);
  if (selected.aggregate || selected.format === undefined) return false;
  const raster = tryResolveDeclaredFormat(selected.format);
  return raster !== undefined && isFontFaceFormatLoaded(selection, raster);
}

function loadFontFaceFormat<const Selection extends FontFaceSelection>(
  selection: Selection,
  raster: RasterFormatInput<RasterFormatMetadata>,
): Promise<Selection>;

function loadFontFaceFormat(
  selection: FontFaceSelection,
  raster: RasterFormatInput<RasterFormatMetadata>,
): Promise<FontFaceSelection> {
  const selected = fontFaceSelectionState(selection);
  const format = rasterOf(raster);
  const existingPromise = selected.promises.get(format);
  if (existingPromise !== undefined) return existingPromise;
  let record = selected.face.owner.records.get(format);
  if (record === undefined) {
    record = createLoadedFaceRecord(
      selected.face.owner,
      selected.face.family,
      selected.face.library,
      selected.face.source,
      raster,
      format,
    );
    selected.face.owner.records.set(format, record);
  }
  const exact = record;
  let promise!: Promise<FontFaceSelection>;
  promise = exact.promise.then(
    () => selection,
    (error: unknown) => {
      if (selected.promises.get(format) === promise) selected.promises.delete(format);
      throw error;
    },
  );
  selected.promises.set(format, promise);
  return promise;
}

function createLoadedFaceRecord(
  owner: FontFaceResourceOwner,
  family: string,
  library: FontLibrary,
  fontSource: FontFaceSource,
  raster: RasterFormatInput<RasterFormatMetadata>,
  format: RasterFormatMetadata,
): LoadedFaceRecord {
  let record!: LoadedFaceRecord;
  const promise = ensureFontFaceSource(owner, library, fontSource, [raster])
    .then((source) => source.load(raster))
    .then(
      (font) => {
        if (owner.disposed || owner.records.get(format) !== record) {
          font.dispose();
          throw new DOMException('FontFace load owner was disposed', 'AbortError');
        }
        record.font = font;
        return font;
      },
      (error: unknown) => {
        if (owner.records.get(format) === record) owner.records.delete(format);
        if (
          error instanceof GlyphFontError &&
          (error.reason === 'RASTER_NOT_FOUND' || error.reason === 'RASTER_SOURCE_UNAVAILABLE')
        ) {
          throw new GlyphFontError(
            'FONT_FACE_FORMAT_UNAVAILABLE',
            `FontFace ${JSON.stringify(family)} does not implement the declared ${JSON.stringify(format.kind)} format`,
            { cause: error },
          );
        }
        throw error;
      },
    );
  record = { promise, font: undefined };
  return record;
}

function fontFaceFormats(face: FontFace): Promise<readonly string[]> {
  const selected = fontFaceSelectionState(face);
  if (!selected.aggregate) throw new TypeError('FontFace format inspection requires the declaration object');
  const state = selected.face;
  if (state.formatsPromise !== undefined) return state.formatsPromise;
  let promise!: Promise<readonly string[]>;
  promise = ensureFontFaceSource(state.owner, state.library, state.source, []).then(
    (source) => source.formats,
    (error: unknown) => {
      if (state.formatsPromise === promise) state.formatsPromise = undefined;
      throw error;
    },
  );
  state.formatsPromise = promise;
  return promise;
}

function ensureFontFaceSource(
  owner: FontFaceResourceOwner,
  library: FontLibrary,
  fontSource: FontFaceSource,
  initialRasters: readonly RasterFormatInput<RasterFormatMetadata>[],
): Promise<FontFaceSourceLease> {
  if (owner.sourcePromise !== undefined) return owner.sourcePromise;
  const controller = new AbortController();
  owner.sourceController = controller;
  let promise!: Promise<FontFaceSourceLease>;
  promise = openDeclaredFontFaceSource(library, fontSource, initialRasters, controller.signal).then(
    (source) => {
      if (owner.disposed || owner.sourcePromise !== promise) {
        source.dispose();
        throw new DOMException('FontFace source owner was disposed', 'AbortError');
      }
      owner.sourceLease = source;
      return source;
    },
    (error: unknown) => {
      if (owner.sourcePromise === promise) {
        owner.sourcePromise = undefined;
        owner.sourceController = undefined;
      }
      throw error;
    },
  );
  owner.sourcePromise = promise;
  return promise;
}

function openDeclaredFontFaceSource(
  library: FontLibrary,
  source: FontFaceSource,
  initialRasters: readonly RasterFormatInput<RasterFormatMetadata>[],
  signal: AbortSignal,
): Promise<FontFaceSourceLease> {
  if (isSerializedFontFace(source)) return openSerializedFontFaceSource(library, source, { signal });
  return fontFaceLoadInput(source).then((input) => openFontFaceSource(library, input, initialRasters, { signal }));
}

function isFontFaceLoaded(face: FontFace): boolean {
  const selected = fontFaceSelectionState(face);
  if (!selected.aggregate) return false;
  return selected.face.aggregateLoaded;
}

function isFontFaceFormatLoaded(
  selection: FontFaceSelection,
  raster: RasterFormatInput<RasterFormatMetadata>,
): boolean {
  return fontFaceSelectionState(selection).face.owner.records.get(rasterOf(raster))?.font !== undefined;
}

function requiredFontFaceFormat(
  selection: FontFaceSelection,
  raster: RasterFormatInput<RasterFormatMetadata>,
): Font<RasterFormatMetadata> {
  const selected = fontFaceSelectionState(selection);
  const format = rasterOf(raster);
  const font = selected.face.owner.records.get(format)?.font;
  if (font === undefined) {
    throw new GlyphFontError(
      'FONT_FACE_FORMAT_NOT_LOADED',
      `FontFace ${JSON.stringify(selection.family)} format ${JSON.stringify(format.kind)} is not loaded`,
    );
  }
  return font;
}

function resolveDeclaredFormat(format: FontFaceFormat): RasterFormatInput<RasterFormatMetadata> {
  const resolved = tryResolveDeclaredFormat(format);
  if (resolved === undefined) {
    throw new GlyphFontError(
      'FONT_FACE_FORMAT_UNAVAILABLE',
      `font format ${JSON.stringify(format)} does not name an imported raster format`,
    );
  }
  return resolved;
}

function tryResolveDeclaredFormat(format: FontFaceFormat): RasterFormatInput<RasterFormatMetadata> | undefined {
  if (typeof format === 'string') return rasterFormatForKey(format);
  return format;
}

function rasterOf(raster: RasterFormatInput<RasterFormatMetadata>): RasterFormatMetadata {
  return isRasterFormat(raster) ? raster : raster.raster;
}

function disposeFontFaceState(state: FontFaceState): void {
  state.aggregateLoaded = false;
  state.aggregatePromise = undefined;
  state.formatsPromise = undefined;
  disposeFontFaceResourceOwner(state.owner);
}

function disposeFontFaceResourceOwner(owner: FontFaceResourceOwner): void {
  if (owner.disposed) return;
  owner.disposed = true;
  owner.sourceController?.abort(new DOMException('FontFace load owner was disposed', 'AbortError'));
  owner.sourceController = undefined;
  for (const record of owner.records.values()) {
    record.font?.dispose();
    record.font = undefined;
  }
  owner.records.clear();
  owner.sourceLease?.dispose();
  owner.sourceLease = undefined;
  owner.sourcePromise = undefined;
}

function formatList(format: unknown): readonly FontFaceFormat[] {
  if (format === undefined) return [];
  if (!Array.isArray(format)) {
    assertFormat(format);
    return [format];
  }
  if (format.length === 0) throw new TypeError('FontFace format array must not be empty');
  const values: FontFaceFormat[] = [];
  for (const value of format) {
    assertFormat(value);
    values.push(value);
  }
  return values;
}

function assertFormat(value: unknown): asserts value is FontFaceFormat {
  if (typeof value === 'string') {
    if (value.length === 0) throw new TypeError('FontFace format key must not be empty');
    return;
  }
  if (isRasterFormat(value)) return;
  if (isRasterFormatRequest(value)) return;
  throw new TypeError('FontFace format must be a key, raster format, or package-created raster-format request');
}

function formatName(format: FontFaceFormat): string {
  if (typeof format === 'string') return format;
  return isRasterFormat(format) ? format.kind : format.raster.kind;
}

function assertFontFaceConfig(config: unknown): asserts config is FontFaceConfig {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new TypeError('FontFace config must be an object');
  }
  const keys = Object.keys(config);
  if (keys.some((key) => key !== 'family' && key !== 'format')) {
    throw new TypeError('FontFace config only accepts family and format');
  }
  const family = Reflect.get(config, 'family');
  if (family !== undefined) normalizedFamily(family);
  formatList(Reflect.get(config, 'format'));
}

function assertFontFaceSource(source: unknown): asserts source is FontFaceSource {
  if (typeof Blob !== 'undefined' && source instanceof Blob) return;
  if (typeof source === 'string' || source instanceof URL) return;
  if (isSerializedFontFace(source)) return;
  throw new TypeError('FontFace source must be a URL, Blob, or SerializedFontFace');
}

function fontFaceLoadInput(source: FontFaceSource): Promise<LoadFontInput> {
  if (isSerializedFontFace(source)) throw new TypeError('SerializedFontFace uses the transfer loader');
  if (typeof source === 'string' || source instanceof URL) return Promise.resolve(source);
  const existing = blobInputs.get(source);
  if (existing !== undefined) return existing;
  const pending = source.arrayBuffer().then((buffer) => {
    const bytes = { bytes: new Uint8Array(buffer), ownership: 'copy' as const };
    const name = 'name' in source && typeof source.name === 'string' ? source.name : '';
    const runtimeSource =
      /\.(?:otf|ttf)$/iu.test(name) || /^(?:font\/(?:otf|ttf)|application\/x-font-(?:otf|ttf))$/iu.test(source.type);
    return runtimeSource ? { source: bytes } : { baked: bytes };
  });
  blobInputs.set(source, pending);
  return pending;
}

function normalizedFamily(family: unknown): string {
  if (typeof family !== 'string' || family.trim().length === 0) {
    throw new TypeError('FontFace family must be a nonempty string');
  }
  return family.trim();
}

function nextFamily(): string {
  while (true) {
    const family = `Font${nextGeneratedFamily++}`;
    const existing = catalog.get(family)?.face.deref();
    if (existing === undefined || existing.disposed) return family;
  }
}
