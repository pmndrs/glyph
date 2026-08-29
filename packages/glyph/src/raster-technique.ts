import type { RasterDecodeFont } from './font.js';
import type { JsonValue, RasterDecodeArtifact, RasterOptionsArgument, RuntimeRasterBakerLoader } from './raster.js';

declare const rasterTechniqueIdBrand: unique symbol;
declare const rasterResourceIdBrand: unique symbol;
declare const rasterTechniqueTypes: unique symbol;
const rasterTechniqueInstances = new WeakSet<object>();

/** Stable public identity for one portable raster technique. */
export type RasterTechniqueId = string & { readonly [rasterTechniqueIdBrand]: true };

/** Stable technique-authored identity for one physical raster resource. */
export type RasterResourceId = string & { readonly [rasterResourceIdBrand]: true };

/** Text effects a technique's policy and shader can render. */
export type RasterTextEffect = 'outline' | 'shadow';

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
  readonly textEffects: readonly RasterTextEffect[];
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
  decode(font: RasterDecodeFont, raster: RasterDecodeArtifact<Kind>, signal?: AbortSignal): Promise<Data>;
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
  assertIdentifier(technique.kind, 'raster technique kind');
  assertIdentifier(technique.extension, 'raster technique extension');
  if (!Number.isSafeInteger(technique.version) || technique.version < 0) {
    throw new RangeError('raster technique version must be a nonnegative safe integer');
  }
  if (
    typeof technique.descriptor !== 'function' ||
    typeof technique.decode !== 'function' ||
    typeof technique.dispose !== 'function' ||
    (technique.runtimeBaker !== undefined && typeof technique.runtimeBaker !== 'function')
  ) {
    throw new TypeError('raster techniques need descriptor, decode, dispose, and optional runtimeBaker functions');
  }
  if (!Array.isArray(technique.textEffects)) throw new TypeError('raster technique textEffects must be an array');
  const textEffects = [...technique.textEffects];
  for (const effect of textEffects) {
    if (effect !== 'outline' && effect !== 'shadow') {
      throw new TypeError(`raster technique text effect "${String(effect)}" is not supported`);
    }
  }
  if (new Set(textEffects).size !== textEffects.length) {
    throw new TypeError('raster technique textEffects must not contain duplicates');
  }
  const defined = Object.freeze({
    id: technique.id,
    kind: technique.kind,
    extension: technique.extension,
    version: technique.version,
    textEffects: Object.freeze(textEffects),
    ...(technique.runtimeBaker === undefined ? {} : { runtimeBaker: technique.runtimeBaker }),
    descriptor: technique.descriptor,
    decode: technique.decode,
    dispose: technique.dispose,
  }) as RasterTechnique<RasterTechniqueId & Id, Kind, Options, Descriptor, Data>;
  rasterTechniqueInstances.add(defined);
  return defined;
}

/** @internal Authenticate the exact technique witness created by `defineRasterTechnique`. */
export function isRasterTechnique(value: unknown): value is AnyRasterTechnique {
  return typeof value === 'object' && value !== null && rasterTechniqueInstances.has(value);
}

/** Brand a stable resource identity produced by a portable technique. */
export function defineRasterResourceId<const Id extends string>(id: Id): RasterResourceId & Id {
  assertIdentifier(id, 'raster resource ID');
  return id as RasterResourceId & Id;
}

function assertIdentifier(value: string, label: string): void {
  if (value.length === 0) throw new TypeError(`${label} must not be empty`);
}
