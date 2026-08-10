import type { RegisteredFont } from './font.js';
import type { JsonValue, RasterOptionsArgument, RegisteredRaster, RuntimeRasterBakerLoader } from './raster.js';

declare const rasterTechniqueIdBrand: unique symbol;
declare const rasterResourceIdBrand: unique symbol;
declare const rasterTechniqueTypes: unique symbol;

/** Stable public identity for one portable raster technique. */
export type RasterTechniqueId = string & { readonly [rasterTechniqueIdBrand]: true };

/** Stable technique-authored identity for one physical raster resource. */
export type RasterResourceId = string & { readonly [rasterResourceIdBrand]: true };

interface RasterTechniqueTypeMap<Options, Descriptor, Data> {
  readonly options: Options;
  readonly descriptor: Descriptor;
  readonly data: Data;
}

/** Common identity retained when concrete technique-associated types are intentionally erased. */
export interface AnyRasterTechnique {
  readonly id: RasterTechniqueId;
  readonly kind: string;
  readonly extension: string;
  readonly version: number;
  readonly [rasterTechniqueTypes]?: RasterTechniqueTypeMap<unknown, JsonValue, unknown>;
}

/** Renderer-neutral raster identity, decoding, and ownership contract. */
export interface RasterTechnique<
  Id extends RasterTechniqueId,
  Kind extends string,
  Options,
  Descriptor extends JsonValue,
  Data,
> extends AnyRasterTechnique {
  readonly [rasterTechniqueTypes]?: RasterTechniqueTypeMap<Options, Descriptor, Data>;

  readonly id: Id;
  readonly kind: Kind;
  readonly extension: string;
  readonly version: number;
  readonly runtimeBaker?: RuntimeRasterBakerLoader<Kind, Options>;

  descriptor(options: RasterOptionsArgument<Options>): Descriptor;
  decode(font: RegisteredFont, raster: RegisteredRaster<Kind>, signal?: AbortSignal): Promise<Data>;
  dispose(data: Data): void;
}

export type RasterTechniqueTypesOf<Technique extends AnyRasterTechnique> =
  Technique extends RasterTechnique<infer _Id, infer _Kind, infer Options, infer Descriptor, infer Data>
    ? RasterTechniqueTypeMap<Options, Descriptor, Data>
    : RasterTechniqueTypeMap<unknown, JsonValue, unknown>;

export type RasterOptionsOf<Technique extends AnyRasterTechnique> = RasterTechniqueTypesOf<Technique>['options'];

export type RasterTechniqueOptionsOf<Technique extends AnyRasterTechnique> = RasterOptionsOf<Technique>;

export type RasterTechniqueRequest<Technique extends AnyRasterTechnique> = {
  readonly technique: Technique;
} & ([RasterOptionsOf<Technique>] extends [never]
  ? { readonly options?: never }
  : undefined extends RasterOptionsOf<Technique>
    ? { readonly options?: RasterOptionsOf<Technique> }
    : { readonly options: RasterOptionsOf<Technique> });

export type RasterTechniqueInput<Technique extends AnyRasterTechnique> = [RasterOptionsOf<Technique>] extends [never]
  ? Technique | RasterTechniqueRequest<Technique>
  : undefined extends RasterOptionsOf<Technique>
    ? Technique | RasterTechniqueRequest<Technique>
    : RasterTechniqueRequest<Technique>;

export type RasterTechniqueDescriptorOf<Technique extends AnyRasterTechnique> =
  RasterTechniqueTypesOf<Technique>['descriptor'];

export type RasterDataOf<Technique extends AnyRasterTechnique> = RasterTechniqueTypesOf<Technique>['data'];

type RasterTechniqueDefinition<
  Id extends string,
  Kind extends string,
  Options,
  Descriptor extends JsonValue,
  Data,
> = Omit<RasterTechnique<RasterTechniqueId & Id, Kind, Options, Descriptor, Data>, 'id'> & {
  readonly id: Id;
};

/** Define one portable technique while preserving every inferred associated type. */
export function defineRasterTechnique<
  const Id extends string,
  const Kind extends string,
  Options,
  Descriptor extends JsonValue,
  Data,
>(
  technique: RasterTechniqueDefinition<Id, Kind, Options, Descriptor, Data>,
): RasterTechnique<RasterTechniqueId & Id, Kind, Options, Descriptor, Data> {
  assertIdentifier(technique.id, 'raster technique ID');
  return technique as RasterTechnique<RasterTechniqueId & Id, Kind, Options, Descriptor, Data>;
}

/** Brand a stable resource identity produced by a portable technique. */
export function defineRasterResourceId<const Id extends string>(id: Id): RasterResourceId & Id {
  assertIdentifier(id, 'raster resource ID');
  return id as RasterResourceId & Id;
}

function assertIdentifier(value: string, label: string): void {
  if (value.length === 0) throw new TypeError(`${label} must not be empty`);
}
