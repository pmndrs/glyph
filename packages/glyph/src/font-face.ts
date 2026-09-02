import type { Font } from './font.js';
import type { GlyphHandle } from './core/glyph-config.js';
import { cloneImmutableFont } from './loaded-font.js';
import type { FontLibrary, LoadFontInput } from './loader.js';
import {
  isRasterTechnique,
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
  /** Load this exact selection through one handle's configured technique vocabulary. */
  load(handle: GlyphHandle): Promise<FontFaceSelection<Format>>;
  /** Read this selection's handle-relative readiness without observing its Promise. */
  isLoaded(handle: GlyphHandle): boolean;
}

interface FontFaceBase<Formats extends FontFaceFormat> extends FontFaceSelection<Formats | undefined> {
  readonly source: FontFaceSource;
  readonly default: FontFace<Formats>;
  readonly disposed: boolean;
  dispose(): void;
}

/** Reusable FontFace declaration whose keyed selections are inferred from its asserted formats. */
export type FontFace<Formats extends FontFaceFormat = FontFaceFormat> = FontFaceBase<Formats> & {
  readonly [Key in FormatKey<Formats>]: FontFaceSelection<FormatForKey<Formats, Key>>;
};

/** Technique-erased FontFace used at catalog and integration boundaries. */
export type AnyFontFace = FontFace<FontFaceFormat>;

/** Technique-erased FontFace selection used at handle boundaries. */
export type AnyFontFaceSelection = FontFaceSelection<FontFaceFormat | undefined>;

export type FontTechniqueMap = Readonly<object>;

interface FontFaceState {
  readonly source: FontFaceSource;
  readonly family: string;
  readonly releaseListeners: Set<() => void>;
  disposed: boolean;
}

interface FontFaceSelectionState {
  readonly face: FontFaceState;
  readonly format: FontFaceFormat | undefined;
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
const handleStores = new WeakMap<object, FontFaceHandleStore>();
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
export function createFontFace<const Declaration extends FontFaceFormatDeclaration = FontFaceFormat>(
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
  const state: FontFaceState = { source, family, releaseListeners: new Set(), disposed: false };
  const selections = new Map<string, AnyFontFaceSelection>();
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
    load(handle: GlyphHandle): Promise<AnyFontFace> {
      return fontFaceHandleStore(handle).load(face) as Promise<AnyFontFace>;
    },
    isLoaded(handle: GlyphHandle): boolean {
      return fontFaceHandleStore(handle).isLoaded(face);
    },
    dispose(): void {
      disposeFontFace(face);
    },
  };
  face = base as unknown as AnyFontFace;
  faceStates.set(face, { face: state, format: defaultFormat });
  for (const format of formats) {
    const key = formatName(format);
    if (selections.has(key)) throw new TypeError(`FontFace format ${JSON.stringify(key)} is declared more than once`);
    if (format === defaultFormat) {
      selections.set(key, face);
      Object.defineProperty(base, key, { enumerable: true, value: face });
      continue;
    }
    let selection!: AnyFontFaceSelection;
    selection = Object.freeze({
      family,
      format,
      face,
      load(handle: GlyphHandle): Promise<AnyFontFaceSelection> {
        return fontFaceHandleStore(handle).load(selection);
      },
      isLoaded(handle: GlyphHandle): boolean {
        return fontFaceHandleStore(handle).isLoaded(selection);
      },
    });
    faceStates.set(selection, { face: state, format });
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
  readonly selection: AnyFontFaceSelection;
  promise: Promise<AnyFontFaceSelection>;
  font: Font<AnyRasterTechnique> | undefined;
  releaseFace: (() => void) | undefined;
}

/** Handle-local loading state over the root FontFace catalog and FontLibrary cache. */
export class FontFaceHandleStore {
  readonly #library: FontLibrary;
  readonly #techniques: Readonly<Record<string, AnyRasterTechnique>>;
  readonly #defaultFormat: string;
  readonly #loadTechnique: ((technique: AnyRasterTechnique) => Promise<void>) | undefined;
  readonly #records = new Map<AnyFontFaceSelection, LoadedFaceRecord>();
  #disposed = false;

  constructor(
    library: FontLibrary,
    techniques: FontTechniqueMap,
    defaultFormat: string,
    loadTechnique?: (technique: AnyRasterTechnique) => Promise<void>,
  ) {
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
    this.#library = library;
    this.#techniques = Object.freeze(normalized);
    this.#defaultFormat = defaultFormat;
    this.#loadTechnique = loadTechnique;
  }

  isLoaded(selection: AnyFontFaceSelection): boolean {
    this.#assertActive();
    fontFaceSelectionState(selection);
    return this.#records.get(selection)?.font !== undefined;
  }

  load(selection: AnyFontFaceSelection): Promise<AnyFontFaceSelection> {
    this.#assertActive();
    const selected = fontFaceSelectionState(selection);
    const existing = this.#records.get(selection);
    if (existing !== undefined) return existing.promise;
    const raster = this.#resolveFormat(selected.format);
    const technique = isRasterTechnique(raster) ? raster : raster.technique;
    const controller = new AbortController();
    const record: LoadedFaceRecord = {
      controller,
      selection,
      promise: undefined as never,
      font: undefined,
      releaseFace: undefined,
    };
    const releaseFace = (): void => this.#releaseRecord(selection, record);
    selected.face.releaseListeners.add(releaseFace);
    record.releaseFace = releaseFace;
    const activated = this.#loadTechnique?.(technique) ?? Promise.resolve();
    const promise = activated
      .then(() => fontFaceLoadInput(selected.face.source))
      .then((input) => this.#library.loadFont(input, raster, { signal: controller.signal }))
      .then(
        (font) => {
          if (this.#records.get(selection) !== record || selected.face.disposed || this.#disposed) {
            font.dispose();
            throw new DOMException('FontFace load owner was disposed', 'AbortError');
          }
          record.font = font;
          return selection;
        },
        (error: unknown) => {
          this.#releaseRecord(selection, record, false);
          throw error;
        },
      );
    record.promise = promise;
    this.#records.set(selection, record);
    return promise;
  }

  acquire<Technique extends AnyRasterTechnique>(selection: FontFaceSelection): Font<Technique> {
    this.#assertActive();
    fontFaceSelectionState(selection);
    const font = this.#records.get(selection as AnyFontFaceSelection)?.font;
    if (font === undefined) throw new Error(`FontFace ${JSON.stringify(selection.family)} is not loaded`);
    return cloneImmutableFont(font) as Font<Technique>;
  }

  /** Borrow the store-owned immutable source. Callers must not dispose this value. */
  peek(selection: FontFaceSelection): Font<AnyRasterTechnique> {
    this.#assertActive();
    fontFaceSelectionState(selection);
    const font = this.#records.get(selection as AnyFontFaceSelection)?.font;
    if (font === undefined) throw new Error(`FontFace ${JSON.stringify(selection.family)} is not loaded`);
    return font;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const [selection, record] of this.#records) this.#releaseRecord(selection, record);
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

  #releaseRecord(selection: AnyFontFaceSelection, record: LoadedFaceRecord, abort = true): void {
    if (this.#records.get(selection) === record) this.#records.delete(selection);
    const state = faceStates.get(selection)?.face;
    if (record.releaseFace !== undefined && state !== undefined) state.releaseListeners.delete(record.releaseFace);
    record.releaseFace = undefined;
    if (abort && !record.controller.signal.aborted) {
      record.controller.abort(new DOMException('FontFace load owner was disposed', 'AbortError'));
    }
    record.font?.dispose();
    record.font = undefined;
  }

  #assertActive(): void {
    if (this.#disposed) throw new Error('font handle store has been disposed');
  }
}

/** @internal Attach one renderer handle to its renderer-neutral FontFace loading store. */
export function registerFontFaceHandleStore(handle: GlyphHandle, store: FontFaceHandleStore): void {
  if (handleStores.has(handle)) throw new TypeError('Glyph handle already has a FontFace loading store');
  handleStores.set(handle, store);
}

/** @internal Detach a renderer handle before disposing its FontFace loading store. */
export function unregisterFontFaceHandleStore(handle: GlyphHandle): void {
  handleStores.delete(handle);
}

function fontFaceHandleStore(handle: GlyphHandle): FontFaceHandleStore {
  const store = handleStores.get(handle);
  if (store === undefined) {
    throw new TypeError('FontFace loading requires a live Glyph handle whose config declares font techniques');
  }
  return store;
}

function disposeFontFaceState(state: FontFaceState): void {
  if (state.disposed) return;
  state.disposed = true;
  for (const release of [...state.releaseListeners]) release();
  state.releaseListeners.clear();
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
