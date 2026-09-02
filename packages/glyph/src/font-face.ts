import type { Font } from './font.js';
import { cloneImmutableFont } from './loaded-font.js';
import { FontLoadError, loadAdvertisedFontFormats, type FontLibrary, type LoadFontInput } from './loader.js';
import {
  isRasterTechnique,
  rasterTechniqueForFormatKey,
  type AnyRasterTechnique,
  type RasterTechniqueInput,
  type RasterTechniqueRequest,
} from './raster-technique.js';
import { canonicalJson } from './internal/raster-identity.js';

/** Source accepted by a reusable FontFace declaration. */
export type FontFaceSource = LoadFontInput | Blob;

/** One format assertion accepted by a FontFace declaration. */
export type FontFaceFormat<Technique extends AnyRasterTechnique = AnyRasterTechnique> =
  | string
  | Technique
  | RasterTechniqueRequest<Technique>;

export type FontFaceFormatDeclaration = FontFaceFormat | readonly [FontFaceFormat, ...FontFaceFormat[]];

export type FontFaceDeclaredFormat<Declaration> = Declaration extends readonly FontFaceFormat[]
  ? Declaration[number]
  : Extract<Declaration, FontFaceFormat>;

/** Optional identity and format assertion for one FontFace source. */
export interface FontFaceConfig<Declaration extends FontFaceFormatDeclaration = FontFaceFormatDeclaration> {
  readonly family?: string;
  readonly format?: Declaration;
}

type TechniqueOfFormat<Format> = Format extends AnyRasterTechnique
  ? Format
  : Format extends RasterTechniqueRequest<infer Technique>
    ? Technique
    : AnyRasterTechnique;

/** Concrete technique carried by a typed FontFace selection; string/default selections remain handle-relative. */
export type FontFaceTechniqueOf<Selection> =
  Selection extends FontFaceSelection<infer Format>
    ? TechniqueOfFormat<Exclude<Format, undefined>>
    : AnyRasterTechnique;

type FormatKey<Format> = Format extends string
  ? Format
  : Format extends AnyRasterTechnique
    ? Format['kind']
    : Format extends RasterTechniqueRequest<infer Technique>
      ? Technique['kind']
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
  /** Load this exact declared technique selection. */
  load(): Promise<FontFaceSelection<Format>>;
  /** Read this selection's readiness without observing its Promise. */
  isLoaded(): boolean;
}

interface FontFaceBase<Formats extends FontFaceFormat> extends Omit<FontFaceSelection<Formats | undefined>, 'load'> {
  readonly source: FontFaceSource;
  readonly default: FontFace<Formats>;
  readonly disposed: boolean;
  /** Load every declared format, or every imported format advertised by an undeclared main font. */
  load(): Promise<FontFace<Formats>>;
  dispose(): void;
}

/** Reusable FontFace declaration whose keyed selections are inferred from its asserted formats. */
export type FontFace<Formats extends FontFaceFormat = never> = FontFaceBase<Formats> & {
  readonly [Key in FormatKey<Formats>]: FontFaceSelection<FormatForKey<Formats, Key>>;
};

/** Technique-erased FontFace used at catalog and integration boundaries. */
export type AnyFontFace = FontFace<FontFaceFormat>;

/** Technique-erased FontFace selection used at handle boundaries. */
export type AnyFontFaceSelection = FontFaceSelection<FontFaceFormat | undefined>;

export type FontTechniqueMap = Readonly<object>;

interface FontFaceState {
  readonly library: FontLibrary;
  readonly source: FontFaceSource;
  readonly family: string;
  readonly formats: readonly FontFaceFormat[];
  readonly selections: ReadonlyMap<string, AnyFontFaceSelection>;
  readonly records: Map<AnyRasterTechnique, LoadedFaceRecord>;
  aggregatePromise: Promise<AnyFontFace> | undefined;
  aggregateController: AbortController | undefined;
  aggregateLoaded: boolean;
  disposed: boolean;
}

interface FontFaceSelectionState {
  readonly face: FontFaceState;
  readonly format: FontFaceFormat | undefined;
  readonly aggregate: boolean;
  readonly promises: Map<AnyRasterTechnique, Promise<AnyFontFaceSelection>>;
}

interface CatalogEntry {
  readonly generation: number;
  readonly face: WeakRef<AnyFontFace>;
}

interface FinalizerRecord {
  readonly family: string;
  readonly generation: number;
  readonly state: FontFaceState;
}

const faceStates = new WeakMap<object, FontFaceSelectionState>();
const blobInputs = new WeakMap<Blob, Promise<LoadFontInput>>();
const sourceIds = new WeakMap<object, number>();
const catalog = new Map<string, CatalogEntry>();
let nextGeneratedFamily = 1;
let nextCatalogGeneration = 1;
let nextSourceId = 1;

const faceFinalizer = new FinalizationRegistry<FinalizerRecord>((record) => {
  disposeFontFaceState(record.state);
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

  const formats = formatList(config.format);
  const selections = new Map<string, AnyFontFaceSelection>();
  const state: FontFaceState = {
    library,
    source,
    family,
    formats,
    selections,
    records: new Map(),
    aggregatePromise: undefined,
    aggregateController: undefined,
    aggregateLoaded: false,
    disposed: false,
  };
  let face!: AnyFontFace;
  const defaultFormat = formats[0];
  const base = {
    family,
    source,
    format: defaultFormat,
    get face(): AnyFontFace {
      return face;
    },
    get default(): AnyFontFace {
      return face;
    },
    get disposed(): boolean {
      return state.disposed;
    },
    load(): Promise<AnyFontFace> {
      return loadFontFace(face);
    },
    isLoaded(): boolean {
      return isFontFaceLoaded(face);
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
    });
    faceStates.set(selection, { face: state, format, aggregate: false, promises: new Map() });
    selections.set(key, selection);
    Object.defineProperty(base, key, { enumerable: true, value: selection });
  }
  Object.freeze(base);

  const generation = nextCatalogGeneration++;
  catalog.set(family, { generation, face: new WeakRef(face) });
  faceFinalizer.register(face, { family, generation, state }, face);
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
  if (selection.face.disposed) return;
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
  if (state.face.disposed) throw new TypeError(`FontFace ${JSON.stringify(state.face.family)} has been disposed`);
  return state;
}

/** @internal Test whether a value is an authentic live FontFace declaration or selection. */
export function isFontFaceSelection(selection: unknown): selection is AnyFontFaceSelection {
  if ((typeof selection !== 'object' && typeof selection !== 'function') || selection === null) return false;
  const state = faceStates.get(selection);
  return state !== undefined && !state.face.disposed;
}

/** @internal Canonical identity shared by React declarations and the loader's raster request policy. */
export function fontFaceResourceKey(source: FontFaceSource, format: FontFaceConfig['format']): string {
  return `${fontFaceSourceKey(source)}:${fontFaceFormatIdentity(format)}`;
}

interface LoadedFaceRecord {
  readonly controller: AbortController;
  readonly technique: AnyRasterTechnique;
  promise: Promise<Font<AnyRasterTechnique>>;
  font: Font<AnyRasterTechnique> | undefined;
}

/** Handle-local format selection over FontFace-owned immutable loads. */
export class FontFaceHandleStore {
  readonly #techniques: Readonly<Record<string, AnyRasterTechnique>>;
  readonly #defaultFormat: string;
  #disposed = false;

  constructor(techniques: FontTechniqueMap, defaultFormat: string) {
    if (typeof defaultFormat !== 'string' || defaultFormat.length === 0) {
      throw new TypeError('font default format must be a nonempty string');
    }
    const entries = Object.entries(techniques as Readonly<Record<string, unknown>>);
    if (entries.length === 0) throw new TypeError('font technique map must not be empty');
    const normalized: Record<string, AnyRasterTechnique> = {};
    for (const [key, technique] of entries) {
      if (key.length === 0 || !isRasterTechnique(technique)) {
        throw new TypeError('font technique map must contain authentic techniques under nonempty keys');
      }
      normalized[key] = technique;
    }
    if (normalized[defaultFormat] === undefined) {
      throw new TypeError(`font default format ${JSON.stringify(defaultFormat)} is not registered`);
    }
    this.#techniques = Object.freeze(normalized);
    this.#defaultFormat = defaultFormat;
  }

  isLoaded(selection: AnyFontFaceSelection): boolean {
    this.#assertActive();
    return isFontFaceTechniqueLoaded(selection, this.#resolveFormat(fontFaceSelectionState(selection).format));
  }

  load(selection: AnyFontFaceSelection): Promise<AnyFontFaceSelection> {
    this.#assertActive();
    return loadFontFaceTechnique(selection, this.#resolveFormat(fontFaceSelectionState(selection).format));
  }

  acquire<Technique extends AnyRasterTechnique>(selection: FontFaceSelection): Font<Technique> {
    this.#assertActive();
    const raster = this.#resolveFormat(fontFaceSelectionState(selection).format);
    const font = requiredFontFaceTechnique(selection as AnyFontFaceSelection, raster);
    return cloneImmutableFont(font) as Font<Technique>;
  }

  /** Borrow the store-owned immutable source. Callers must not dispose this value. */
  peek(selection: FontFaceSelection): Font<AnyRasterTechnique> {
    this.#assertActive();
    const raster = this.#resolveFormat(fontFaceSelectionState(selection).format);
    return requiredFontFaceTechnique(selection as AnyFontFaceSelection, raster);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
  }

  #resolveFormat(format: FontFaceFormat | undefined): RasterTechniqueInput<AnyRasterTechnique> {
    if (format === undefined) return this.#techniques[this.#defaultFormat]!;
    if (typeof format === 'string') {
      const technique = this.#techniques[format];
      if (technique === undefined) throw new TypeError(`font format ${JSON.stringify(format)} is not supported`);
      return technique;
    }
    const request = format;
    const technique = isRasterTechnique(request) ? request : request.technique;
    const configured = Object.values(this.#techniques).find((candidate) => candidate === technique);
    if (configured === undefined) {
      throw new TypeError(`font technique ${JSON.stringify(technique.kind)} is not supported`);
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
  const controller = new AbortController();
  state.aggregateController = controller;
  const operation = Promise.resolve().then(() =>
    state.formats.length === 0
      ? loadUndeclaredFontFace(state, controller.signal)
      : Promise.all(
          state.formats.map((format) => {
            const declared = state.selections.get(formatName(format));
            if (declared === undefined) throw new Error('FontFace declared selection is missing');
            return loadFontFaceTechnique(declared, resolveDeclaredFormat(format));
          }),
        ).then(() => undefined),
  );
  let promise!: Promise<AnyFontFace>;
  promise = operation.then(
    () => {
      if (state.disposed || state.aggregatePromise !== promise) {
        throw new DOMException('FontFace load owner was disposed', 'AbortError');
      }
      state.aggregateLoaded = true;
      return face;
    },
    (error: unknown) => {
      if (state.aggregatePromise === promise) {
        state.aggregatePromise = undefined;
        state.aggregateController = undefined;
      }
      throw error;
    },
  );
  state.aggregatePromise = promise;
  return promise;
}

async function loadUndeclaredFontFace(state: FontFaceState, signal: AbortSignal): Promise<void> {
  const input = await fontFaceLoadInput(state.source);
  const fonts = await loadAdvertisedFontFormats(state.library, input, { signal });
  if (state.disposed) {
    for (const font of fonts) font.dispose();
    throw new DOMException('FontFace load owner was disposed', 'AbortError');
  }
  for (const font of fonts) {
    const existing = state.records.get(font.technique);
    if (existing !== undefined) {
      font.dispose();
      continue;
    }
    const controller = new AbortController();
    state.records.set(font.technique, {
      controller,
      technique: font.technique,
      promise: Promise.resolve(font),
      font,
    });
  }
}

function loadDeclaredFontFaceSelection(selection: AnyFontFaceSelection): Promise<AnyFontFaceSelection> {
  const selected = fontFaceSelectionState(selection);
  if (selected.aggregate || selected.format === undefined) {
    throw new TypeError('FontFace technique loading requires a declared format member');
  }
  return loadFontFaceTechnique(selection, resolveDeclaredFormat(selected.format));
}

function isDeclaredFontFaceSelectionLoaded(selection: AnyFontFaceSelection): boolean {
  const selected = fontFaceSelectionState(selection);
  if (selected.aggregate || selected.format === undefined) return false;
  const raster = tryResolveDeclaredFormat(selected.format);
  return raster !== undefined && isFontFaceTechniqueLoaded(selection, raster);
}

function loadFontFaceTechnique(
  selection: AnyFontFaceSelection,
  raster: RasterTechniqueInput<AnyRasterTechnique>,
): Promise<AnyFontFaceSelection> {
  const selected = fontFaceSelectionState(selection);
  const technique = techniqueOf(raster);
  const existingPromise = selected.promises.get(technique);
  if (existingPromise !== undefined) return existingPromise;
  let record = selected.face.records.get(technique);
  if (record === undefined) {
    record = createLoadedFaceRecord(selected.face, raster, technique);
    selected.face.records.set(technique, record);
  }
  const exact = record;
  let promise!: Promise<AnyFontFaceSelection>;
  promise = exact.promise.then(
    () => selection,
    (error: unknown) => {
      if (selected.promises.get(technique) === promise) selected.promises.delete(technique);
      throw error;
    },
  );
  selected.promises.set(technique, promise);
  return promise;
}

function createLoadedFaceRecord(
  state: FontFaceState,
  raster: RasterTechniqueInput<AnyRasterTechnique>,
  technique: AnyRasterTechnique,
): LoadedFaceRecord {
  const controller = new AbortController();
  let record!: LoadedFaceRecord;
  const promise = fontFaceLoadInput(state.source)
    .then((input) => state.library.loadFont(input, raster, { signal: controller.signal }))
    .then(
      (font) => {
        if (state.disposed || state.records.get(technique) !== record) {
          font.dispose();
          throw new DOMException('FontFace load owner was disposed', 'AbortError');
        }
        record.font = font;
        return font;
      },
      (error: unknown) => {
        if (state.records.get(technique) === record) state.records.delete(technique);
        if (
          error instanceof FontLoadError &&
          (error.code === 'RASTER_NOT_FOUND' || error.code === 'RASTER_SOURCE_UNAVAILABLE')
        ) {
          throw new FontLoadError(
            'FONT_FACE_TECHNIQUE_UNAVAILABLE',
            `FontFace ${JSON.stringify(state.family)} does not implement the declared ${JSON.stringify(technique.kind)} technique`,
            { cause: error },
          );
        }
        throw error;
      },
    );
  record = { controller, technique, promise, font: undefined };
  return record;
}

function isFontFaceLoaded(face: AnyFontFace): boolean {
  const selected = fontFaceSelectionState(face);
  if (!selected.aggregate) return false;
  const state = selected.face;
  if (state.formats.length === 0) return state.aggregateLoaded;
  return state.formats.every((format) => {
    const raster = tryResolveDeclaredFormat(format);
    return raster !== undefined && state.records.get(techniqueOf(raster))?.font !== undefined;
  });
}

function isFontFaceTechniqueLoaded(
  selection: AnyFontFaceSelection,
  raster: RasterTechniqueInput<AnyRasterTechnique>,
): boolean {
  return fontFaceSelectionState(selection).face.records.get(techniqueOf(raster))?.font !== undefined;
}

function requiredFontFaceTechnique(
  selection: AnyFontFaceSelection,
  raster: RasterTechniqueInput<AnyRasterTechnique>,
): Font<AnyRasterTechnique> {
  const selected = fontFaceSelectionState(selection);
  const technique = techniqueOf(raster);
  const font = selected.face.records.get(technique)?.font;
  if (font === undefined) {
    throw new FontLoadError(
      'FONT_FACE_TECHNIQUE_NOT_LOADED',
      `FontFace ${JSON.stringify(selection.family)} technique ${JSON.stringify(technique.kind)} is not loaded`,
    );
  }
  return font;
}

function resolveDeclaredFormat(format: FontFaceFormat): RasterTechniqueInput<AnyRasterTechnique> {
  const resolved = tryResolveDeclaredFormat(format);
  if (resolved === undefined) {
    throw new FontLoadError(
      'FONT_FACE_TECHNIQUE_UNAVAILABLE',
      `font format ${JSON.stringify(format)} does not name an imported raster technique`,
    );
  }
  return resolved;
}

function tryResolveDeclaredFormat(format: FontFaceFormat): RasterTechniqueInput<AnyRasterTechnique> | undefined {
  if (typeof format === 'string') return rasterTechniqueForFormatKey(format);
  return format;
}

function techniqueOf(raster: RasterTechniqueInput<AnyRasterTechnique>): AnyRasterTechnique {
  return isRasterTechnique(raster) ? raster : raster.technique;
}

function disposeFontFaceState(state: FontFaceState): void {
  if (state.disposed) return;
  state.disposed = true;
  state.aggregateLoaded = false;
  state.aggregateController?.abort(new DOMException('FontFace load owner was disposed', 'AbortError'));
  state.aggregateController = undefined;
  state.aggregatePromise = undefined;
  for (const record of state.records.values()) {
    if (!record.controller.signal.aborted) {
      record.controller.abort(new DOMException('FontFace load owner was disposed', 'AbortError'));
    }
    record.font?.dispose();
    record.font = undefined;
  }
  state.records.clear();
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
  if (isRasterTechnique(value)) return;
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !Object.hasOwn(value, 'technique') ||
    !isRasterTechnique((value as { readonly technique?: unknown }).technique)
  ) {
    throw new TypeError('FontFace format must be a key, technique, or technique request');
  }
}

function formatName(format: FontFaceFormat): string {
  if (typeof format === 'string') return format;
  return isRasterTechnique(format) ? format.kind : format.technique.kind;
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
  const request = isRasterTechnique(format) ? { technique: format, options: undefined } : format;
  const operation = request.technique as AnyRasterTechnique & {
    descriptor(options: unknown): Parameters<typeof canonicalJson>[0];
  };
  return `raster:${request.technique.id}:${canonicalJson(operation.descriptor(request.options))}`;
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
