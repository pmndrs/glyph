import type { Font } from './font.js';
import { cloneImmutableFont } from './loaded-font.js';
import {
  FontLoadError,
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
import {
  isRasterFormat,
  rasterFormatForKey,
  type AnyRasterFormat,
  type RasterFormatInput,
  type RasterFormatRequest,
} from './raster-format.js';
import { canonicalJson } from './internal/raster-identity.js';

/** Source accepted by a reusable FontFace declaration. */
export type FontFaceSource = LoadFontInput | Blob | SerializedFontFace;

/** One format assertion accepted by a FontFace declaration. */
export type FontFaceFormat<Format extends AnyRasterFormat = AnyRasterFormat> =
  | string
  | Format
  | RasterFormatRequest<Format>;

export type FontFaceFormatDeclaration = FontFaceFormat | readonly [FontFaceFormat, ...FontFaceFormat[]];

export type FontFaceDeclaredFormat<Declaration> = Declaration extends readonly FontFaceFormat[]
  ? Declaration[number]
  : Extract<Declaration, FontFaceFormat>;

/** Optional identity and format assertion for one FontFace source. */
export interface FontFaceConfig<Declaration extends FontFaceFormatDeclaration = FontFaceFormatDeclaration> {
  readonly family?: string;
  readonly format?: Declaration;
}

type RasterOfFormat<Format> = Format extends AnyRasterFormat
  ? Format
  : Format extends RasterFormatRequest<infer Raster>
    ? Raster
    : AnyRasterFormat;

/** Concrete raster carried by a typed FontFace selection; string/default selections remain handle-relative. */
export type FontFaceRasterOf<Selection> =
  Selection extends FontFaceSelection<infer Format> ? RasterOfFormat<Exclude<Format, undefined>> : AnyRasterFormat;

type FormatKey<Format> = Format extends string
  ? Format
  : Format extends AnyRasterFormat
    ? Format['kind']
    : Format extends RasterFormatRequest<infer Raster>
      ? Raster['kind']
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
  readonly face: AnyFontFace;
  /** Load this exact declared format selection. */
  load(): Promise<FontFaceSelection<Format>>;
  /** Read this selection's readiness without observing its Promise. */
  isLoaded(): boolean;
  /** Explicitly copy this loaded selection into fresh structured-clone transfer buffers. */
  clone(): Promise<FontFaceTransfer>;
}

interface FontFaceBase<Formats extends FontFaceFormat> extends Omit<FontFaceSelection<Formats | undefined>, 'load'> {
  readonly default: FontFace<Formats>;
  readonly disposed: boolean;
  /** Load every declared format, or every imported format advertised by an undeclared main font. */
  load(): Promise<FontFace<Formats>>;
  /** Inspect the ordered format keys advertised by the authoritative main font. */
  formats(): Promise<readonly string[]>;
  dispose(): void;
}

/** Reusable FontFace declaration whose keyed selections are inferred from its asserted formats. */
export type FontFace<Formats extends FontFaceFormat = never> = FontFaceBase<Formats> & {
  readonly [Key in FormatKey<Formats>]: FontFaceSelection<FormatForKey<Formats, Key>>;
};

/** Format-erased FontFace used at catalog and integration boundaries. */
export type AnyFontFace = FontFace<FontFaceFormat>;

/** Format-erased FontFace selection used at handle boundaries. */
export type AnyFontFaceSelection = FontFaceSelection<FontFaceFormat | undefined>;

export type FontFormatMap = Readonly<object>;

interface FontFaceResourceOwner {
  readonly records: Map<AnyRasterFormat, LoadedFaceRecord>;
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
  readonly selections: ReadonlyMap<string, AnyFontFaceSelection>;
  formatsPromise: Promise<readonly string[]> | undefined;
  aggregatePromise: Promise<AnyFontFace> | undefined;
  aggregateLoaded: boolean;
}

interface FontFaceSelectionState {
  readonly face: FontFaceState;
  readonly format: FontFaceFormat | undefined;
  readonly aggregate: boolean;
  readonly promises: Map<AnyRasterFormat, Promise<AnyFontFaceSelection>>;
}

interface CatalogEntry {
  readonly generation: number;
  readonly face: WeakRef<AnyFontFace>;
}

interface FinalizerRecord {
  readonly family: string;
  readonly generation: number;
  readonly owner: FontFaceResourceOwner;
}

const faceStates = new WeakMap<object, FontFaceSelectionState>();
const blobInputs = new WeakMap<Blob, Promise<LoadFontInput>>();
const sourceIds = new WeakMap<object, number>();
const catalog = new Map<string, CatalogEntry>();
let nextGeneratedFamily = 1;
let nextCatalogGeneration = 1;
let nextSourceId = 1;

const faceFinalizer = new FinalizationRegistry<FinalizerRecord>((record) => {
  disposeFontFaceResourceOwner(record.owner);
  const current = catalog.get(record.family);
  if (current?.generation === record.generation && current.face.deref() === undefined) catalog.delete(record.family);
});

/** Create one FontFace declaration and register its family as a weak root-catalog alias. */
export function createFontFace<const Declaration extends FontFaceFormatDeclaration = never>(
  library: FontLibrary,
  source: FontFaceSource,
  config: FontFaceConfig<Declaration> = {},
): FontFace<FontFaceDeclaredFormat<Declaration>> {
  assertFontFaceSource(source);
  assertFontFaceConfig(config);
  const family = config.family === undefined ? nextFamily() : normalizedFamily(config.family);
  const existing = catalog.get(family)?.face.deref();
  if (existing !== undefined && !existing.disposed) {
    throw new Error(`FontFace family ${JSON.stringify(family)} already exists`);
  }
  const ownedSource = isSerializedFontFace(source) ? claimSerializedFontFace(source) : source;

  const formats = formatList(config.format);
  const selections = new Map<string, AnyFontFaceSelection>();
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
  let face!: AnyFontFace;
  const defaultFormat = formats[0];
  const base = {
    family,
    format: defaultFormat,
    get face(): AnyFontFace {
      return face;
    },
    get default(): AnyFontFace {
      return face;
    },
    get disposed(): boolean {
      return owner.disposed;
    },
    load(): Promise<AnyFontFace> {
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
  face = base as unknown as AnyFontFace;
  faceStates.set(face, { face: state, format: defaultFormat, aggregate: true, promises: new Map() });
  for (const format of formats) {
    const key = formatName(format);
    if (selections.has(key)) throw new TypeError(`FontFace format ${JSON.stringify(key)} is declared more than once`);
    let selection!: AnyFontFaceSelection;
    selection = Object.freeze({
      family,
      format,
      face,
      load(): Promise<AnyFontFaceSelection> {
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
  return face as FontFace<FontFaceDeclaredFormat<Declaration>>;
}

/** Resolve one live family from Glyph's weak root catalog. */
export function resolveFontFace(family: string): AnyFontFace | undefined {
  const normalized = normalizedFamily(family);
  const entry = catalog.get(normalized);
  const face = entry?.face.deref();
  if (face === undefined && entry !== undefined) catalog.delete(normalized);
  return face?.disposed === false ? face : undefined;
}

/** Dispose one authentic FontFace declaration or selection's shared owner. */
export function disposeFontFace(face: AnyFontFace): void {
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
export function isFontFaceSelection(selection: unknown): selection is AnyFontFaceSelection {
  if ((typeof selection !== 'object' && typeof selection !== 'function') || selection === null) return false;
  const state = faceStates.get(selection);
  return state !== undefined && !state.face.owner.disposed;
}

/** @internal Canonical identity shared by React declarations and the loader's raster request policy. */
export function fontFaceResourceKey(source: FontFaceSource, format: FontFaceConfig['format']): string {
  return `${fontFaceSourceKey(source)}:${fontFaceFormatIdentity(format)}`;
}

interface LoadedFaceRecord {
  readonly raster: AnyRasterFormat;
  promise: Promise<Font<AnyRasterFormat>>;
  font: Font<AnyRasterFormat> | undefined;
}

/** Handle-local format selection over FontFace-owned immutable loads. */
export class FontFaceHandleStore {
  readonly #formats: Readonly<Record<string, AnyRasterFormat>>;
  readonly #defaultFormat: string;
  #disposed = false;

  constructor(formats: FontFormatMap, defaultFormat: string) {
    if (typeof defaultFormat !== 'string' || defaultFormat.length === 0) {
      throw new TypeError('font default format must be a nonempty string');
    }
    const entries = Object.entries(formats as Readonly<Record<string, unknown>>);
    if (entries.length === 0) throw new TypeError('font format map must not be empty');
    const normalized: Record<string, AnyRasterFormat> = {};
    for (const [key, raster] of entries) {
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

  isLoaded(selection: AnyFontFaceSelection): boolean {
    this.#assertActive();
    return isFontFaceFormatLoaded(selection, this.#resolveFormat(fontFaceSelectionState(selection).format));
  }

  load(selection: AnyFontFaceSelection): Promise<AnyFontFaceSelection> {
    this.#assertActive();
    return loadFontFaceFormat(selection, this.#resolveFormat(fontFaceSelectionState(selection).format));
  }

  acquire<Format extends AnyRasterFormat>(selection: FontFaceSelection): Font<Format> {
    this.#assertActive();
    const raster = this.#resolveFormat(fontFaceSelectionState(selection).format);
    const font = requiredFontFaceFormat(selection as AnyFontFaceSelection, raster);
    return cloneImmutableFont(font) as Font<Format>;
  }

  /** Borrow the store-owned immutable source. Callers must not dispose this value. */
  peek(selection: FontFaceSelection): Font<AnyRasterFormat> {
    this.#assertActive();
    const raster = this.#resolveFormat(fontFaceSelectionState(selection).format);
    return requiredFontFaceFormat(selection as AnyFontFaceSelection, raster);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
  }

  #resolveFormat(format: FontFaceFormat | undefined): RasterFormatInput<AnyRasterFormat> {
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

function loadFontFace(face: AnyFontFace): Promise<AnyFontFace> {
  const selection = fontFaceSelectionState(face);
  const state = selection.face;
  if (!selection.aggregate) throw new TypeError('FontFace aggregate loading requires the declaration object');
  if (state.aggregatePromise !== undefined) return state.aggregatePromise;
  const operation = Promise.resolve().then(() => loadAllFontFaceFormats(state));
  let promise!: Promise<AnyFontFace>;
  promise = operation.then(
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

async function cloneFontFace(selection: AnyFontFaceSelection): Promise<FontFaceTransfer> {
  const selected = fontFaceSelectionState(selection);
  if (selected.aggregate) {
    await loadFontFace(selection as AnyFontFace);
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
  const operations: Promise<readonly Font<AnyRasterFormat>[]>[] = [
    ...declared.map((raster) => source.load(raster).then((font) => [font])),
    source.loadAdvertised(declared.map(rasterOf)),
  ];
  let groups: readonly (readonly Font<AnyRasterFormat>[])[];
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
    throw new FontLoadError(
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
      raster: font.raster,
      promise: Promise.resolve(font),
      font,
    });
  }
}

function loadDeclaredFontFaceSelection(selection: AnyFontFaceSelection): Promise<AnyFontFaceSelection> {
  const selected = fontFaceSelectionState(selection);
  if (selected.aggregate || selected.format === undefined) {
    throw new TypeError('FontFace format loading requires a declared format member');
  }
  return loadFontFaceFormat(selection, resolveDeclaredFormat(selected.format));
}

function isDeclaredFontFaceSelectionLoaded(selection: AnyFontFaceSelection): boolean {
  const selected = fontFaceSelectionState(selection);
  if (selected.aggregate || selected.format === undefined) return false;
  const raster = tryResolveDeclaredFormat(selected.format);
  return raster !== undefined && isFontFaceFormatLoaded(selection, raster);
}

function loadFontFaceFormat(
  selection: AnyFontFaceSelection,
  raster: RasterFormatInput<AnyRasterFormat>,
): Promise<AnyFontFaceSelection> {
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
  let promise!: Promise<AnyFontFaceSelection>;
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
  raster: RasterFormatInput<AnyRasterFormat>,
  format: AnyRasterFormat,
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
          error instanceof FontLoadError &&
          (error.code === 'RASTER_NOT_FOUND' || error.code === 'RASTER_SOURCE_UNAVAILABLE')
        ) {
          throw new FontLoadError(
            'FONT_FACE_FORMAT_UNAVAILABLE',
            `FontFace ${JSON.stringify(family)} does not implement the declared ${JSON.stringify(format.kind)} format`,
            { cause: error },
          );
        }
        throw error;
      },
    );
  record = { raster: format, promise, font: undefined };
  return record;
}

function fontFaceFormats(face: AnyFontFace): Promise<readonly string[]> {
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
  initialRasters: readonly RasterFormatInput<AnyRasterFormat>[],
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
  initialRasters: readonly RasterFormatInput<AnyRasterFormat>[],
  signal: AbortSignal,
): Promise<FontFaceSourceLease> {
  if (isSerializedFontFace(source)) return openSerializedFontFaceSource(library, source, { signal });
  return fontFaceLoadInput(source).then((input) => openFontFaceSource(library, input, initialRasters, { signal }));
}

function isFontFaceLoaded(face: AnyFontFace): boolean {
  const selected = fontFaceSelectionState(face);
  if (!selected.aggregate) return false;
  return selected.face.aggregateLoaded;
}

function isFontFaceFormatLoaded(selection: AnyFontFaceSelection, raster: RasterFormatInput<AnyRasterFormat>): boolean {
  return fontFaceSelectionState(selection).face.owner.records.get(rasterOf(raster))?.font !== undefined;
}

function requiredFontFaceFormat(
  selection: AnyFontFaceSelection,
  raster: RasterFormatInput<AnyRasterFormat>,
): Font<AnyRasterFormat> {
  const selected = fontFaceSelectionState(selection);
  const format = rasterOf(raster);
  const font = selected.face.owner.records.get(format)?.font;
  if (font === undefined) {
    throw new FontLoadError(
      'FONT_FACE_FORMAT_NOT_LOADED',
      `FontFace ${JSON.stringify(selection.family)} format ${JSON.stringify(format.kind)} is not loaded`,
    );
  }
  return font;
}

function resolveDeclaredFormat(format: FontFaceFormat): RasterFormatInput<AnyRasterFormat> {
  const resolved = tryResolveDeclaredFormat(format);
  if (resolved === undefined) {
    throw new FontLoadError(
      'FONT_FACE_FORMAT_UNAVAILABLE',
      `font format ${JSON.stringify(format)} does not name an imported raster format`,
    );
  }
  return resolved;
}

function tryResolveDeclaredFormat(format: FontFaceFormat): RasterFormatInput<AnyRasterFormat> | undefined {
  if (typeof format === 'string') return rasterFormatForKey(format);
  return format;
}

function rasterOf(raster: RasterFormatInput<AnyRasterFormat>): AnyRasterFormat {
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

function formatList(format: FontFaceConfig['format']): readonly FontFaceFormat[] {
  if (format === undefined) return [];
  const values: readonly FontFaceFormat[] = Array.isArray(format)
    ? (format as readonly FontFaceFormat[])
    : [format as FontFaceFormat];
  if (values.length === 0) throw new TypeError('FontFace format array must not be empty');
  for (const value of values) assertFormat(value);
  return values;
}

function assertFormat(value: unknown): asserts value is FontFaceFormat {
  if (typeof value === 'string') {
    if (value.length === 0) throw new TypeError('FontFace format key must not be empty');
    return;
  }
  if (isRasterFormat(value)) return;
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !Object.hasOwn(value, 'raster') ||
    !isRasterFormat((value as { readonly raster?: unknown }).raster)
  ) {
    throw new TypeError('FontFace format must be a key, raster format, or raster-format request');
  }
}

function formatName(format: FontFaceFormat): string {
  if (typeof format === 'string') return format;
  return isRasterFormat(format) ? format.kind : format.raster.kind;
}

function assertFontFaceConfig(config: unknown): asserts config is FontFaceConfig {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new TypeError('FontFace config must be an object');
  }
  const value = config as { readonly family?: unknown; readonly format?: unknown };
  const keys = Object.keys(value);
  if (keys.some((key) => key !== 'family' && key !== 'format')) {
    throw new TypeError('FontFace config only accepts family and format');
  }
  if (value.family !== undefined) normalizedFamily(value.family);
  formatList(value.format as FontFaceConfig['format']);
}

function assertFontFaceSource(source: unknown): asserts source is FontFaceSource {
  if (typeof Blob !== 'undefined' && source instanceof Blob) return;
  if (typeof source === 'string' || source instanceof URL) return;
  if (typeof source !== 'object' || source === null || Array.isArray(source)) {
    throw new TypeError('FontFace source must be a URL or font source object');
  }
}

function fontFaceLoadInput(source: FontFaceSource): Promise<LoadFontInput> {
  if (isSerializedFontFace(source)) throw new TypeError('SerializedFontFace uses the transfer loader');
  if (!(typeof Blob !== 'undefined' && source instanceof Blob)) return Promise.resolve(source as LoadFontInput);
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

function fontFaceSourceKey(source: FontFaceSource): string {
  if (typeof source === 'string') return `string:${source}`;
  if (source instanceof URL) return `url:${source.href}`;
  let id = sourceIds.get(source);
  if (id === undefined) {
    id = nextSourceId++;
    sourceIds.set(source, id);
  }
  return `object:${id}`;
}

function fontFaceFormatIdentity(format: FontFaceConfig['format']): string {
  if (format === undefined) return 'default';
  const values: readonly FontFaceFormat[] = Array.isArray(format)
    ? (format as readonly FontFaceFormat[])
    : [format as FontFaceFormat];
  return values.map(singleFormatIdentity).join('|');
}

function singleFormatIdentity(format: FontFaceFormat): string {
  if (typeof format === 'string') return `key:${format}`;
  const request = isRasterFormat(format) ? { raster: format, options: undefined } : format;
  const operation = request.raster as AnyRasterFormat & {
    descriptor(options: unknown): Parameters<typeof canonicalJson>[0];
  };
  return `raster:${request.raster.id}:${canonicalJson(operation.descriptor(request.options))}`;
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
