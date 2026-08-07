import type { RegisteredFont } from './font.js';
import type { GlyphPaint, ResolvedPaint } from './paint.js';
import type {
  AnyRasterModule,
  JsonValue,
  RasterModuleOptionsOf,
  RasterOptionsArgument,
  RegisteredRaster,
  RuntimeRasterBakerLoader,
} from './raster.js';

declare const rasterTechniqueIdBrand: unique symbol;
declare const rasterResourceIdBrand: unique symbol;
declare const rasterTechniqueTypes: unique symbol;

/** Stable public identity for one portable raster technique. */
export type RasterTechniqueId = string & { readonly [rasterTechniqueIdBrand]: true };

/** Stable technique-authored identity for one physical raster resource. */
export type RasterResourceId = string & { readonly [rasterResourceIdBrand]: true };

/** One logical glyph-instance range. */
export interface GlyphRange {
  readonly start: number;
  readonly count: number;
}

/** Every public canonical storage field is an independently addressable typed-array view. */
export type GlyphBatchStorageShape<Storage> = {
  readonly [Field in keyof Storage]: ArrayBufferView;
};

/** Type-erased canonical storage at heterogeneous runtime boundaries. */
export type GlyphBatchStorage = Readonly<Partial<Record<PropertyKey, ArrayBufferView>>>;

interface RasterTechniqueTypeMap<Options, Descriptor, Data, Binding, Storage> {
  readonly options: Options;
  readonly descriptor: Descriptor;
  readonly data: Data;
  readonly binding: Binding;
  readonly storage: Storage;
}

/** Common identity retained when concrete technique-associated types are intentionally erased. */
export interface AnyRasterTechnique {
  readonly id: RasterTechniqueId;
  readonly kind: string;
  readonly extension: string;
  readonly version: number;
  readonly [rasterTechniqueTypes]?: RasterTechniqueTypeMap<unknown, JsonValue, unknown, unknown, unknown>;
}

export interface RasterGlyphInput<Data> {
  readonly data: Data;
  readonly glyphId: number;
  readonly fontSize: number;
  /** Paragraph-local displayed origin after any caller-authored glyph override. */
  readonly originX: number;
  /** Paragraph-local displayed origin after any caller-authored glyph override. */
  readonly originY: number;
  readonly rasterPixelRatio: number;
  readonly paint: ResolvedPaint;
}

export interface RasterGlyphWriteInput<Data, Binding> {
  readonly data: Data;
  /** The selection already used by core to form this physical glyph batch. */
  readonly binding: Binding;
  readonly glyphs: readonly RasterGlyphInput<Data>[];
}

export interface RasterGlyphSelection<Binding> {
  readonly resource: RasterResourceId;
  readonly pipelineVariant: number;
  readonly binding: Binding;
}

export interface RasterTechnique<
  Id extends RasterTechniqueId,
  Kind extends string,
  Options,
  Descriptor extends JsonValue,
  Data,
  Binding,
  Storage extends GlyphBatchStorageShape<Storage>,
> extends AnyRasterTechnique {
  readonly [rasterTechniqueTypes]?: RasterTechniqueTypeMap<Options, Descriptor, Data, Binding, Storage>;

  readonly id: Id;
  readonly kind: Kind;
  readonly extension: string;
  readonly version: number;
  readonly runtimeBaker?: RuntimeRasterBakerLoader<Kind, Options>;

  descriptor(options: RasterOptionsArgument<Options>): Descriptor;
  decode(font: RegisteredFont, raster: RegisteredRaster<Kind>, signal?: AbortSignal): Promise<Data>;
  /** Return undefined when a shaped glyph intentionally has no renderable raster instance. */
  select(input: RasterGlyphInput<Data>): RasterGlyphSelection<Binding> | undefined;
  createStorage(capacity: number): Storage;
  writeStorage(storage: Storage, range: GlyphRange, input: RasterGlyphWriteInput<Data, Binding>): void;
  validatePaint?(paint: GlyphPaint): void;
  dispose(data: Data): void;
}

export type RasterTechniqueTypesOf<Technique extends AnyRasterTechnique> =
  Technique extends RasterTechnique<
    infer _Id,
    infer _Kind,
    infer Options,
    infer Descriptor,
    infer Data,
    infer Binding,
    infer Storage
  >
    ? RasterTechniqueTypeMap<Options, Descriptor, Data, Binding, Storage>
    : RasterTechniqueTypeMap<unknown, JsonValue, unknown, unknown, GlyphBatchStorage>;

export type RasterTechniqueOptionsOf<Technique extends AnyRasterTechnique> =
  RasterTechniqueTypesOf<Technique>['options'];

/** Options inferred from either the target-v1 technique or the merged-v0 raster module. */
export type RasterOptionsOf<Raster extends AnyRasterTechnique | AnyRasterModule> = Raster extends AnyRasterTechnique
  ? RasterTechniqueOptionsOf<Raster>
  : Raster extends AnyRasterModule
    ? RasterModuleOptionsOf<Raster>
    : never;

export type RasterTechniqueDescriptorOf<Technique extends AnyRasterTechnique> =
  RasterTechniqueTypesOf<Technique>['descriptor'];

export type RasterDataOf<Technique extends AnyRasterTechnique> = RasterTechniqueTypesOf<Technique>['data'];

export type RasterBindingOf<Technique extends AnyRasterTechnique> = RasterTechniqueTypesOf<Technique>['binding'];

export type GlyphBatchStorageOf<Technique extends AnyRasterTechnique> = RasterTechniqueTypesOf<Technique>['storage'];

type RasterTechniqueDefinition<
  Id extends string,
  Kind extends string,
  Options,
  Descriptor extends JsonValue,
  Data,
  Binding,
  Storage extends GlyphBatchStorageShape<Storage>,
> = Omit<RasterTechnique<RasterTechniqueId & Id, Kind, Options, Descriptor, Data, Binding, Storage>, 'id'> & {
  readonly id: Id;
};

/** Define one portable technique while preserving every inferred associated type. */
export function defineRasterTechnique<
  const Id extends string,
  const Kind extends string,
  Options,
  Descriptor extends JsonValue,
  Data,
  Binding,
  Storage extends GlyphBatchStorageShape<Storage>,
>(
  technique: RasterTechniqueDefinition<Id, Kind, Options, Descriptor, Data, Binding, Storage>,
): RasterTechnique<RasterTechniqueId & Id, Kind, Options, Descriptor, Data, Binding, Storage> {
  assertIdentifier(technique.id, 'raster technique ID');
  return technique as RasterTechnique<RasterTechniqueId & Id, Kind, Options, Descriptor, Data, Binding, Storage>;
}

/** Brand a stable resource identity produced by a portable technique. */
export function defineRasterResourceId<const Id extends string>(id: Id): RasterResourceId & Id {
  assertIdentifier(id, 'raster resource ID');
  return id as RasterResourceId & Id;
}

function assertIdentifier(value: string, label: string): void {
  if (value.length === 0) throw new TypeError(`${label} must not be empty`);
}
