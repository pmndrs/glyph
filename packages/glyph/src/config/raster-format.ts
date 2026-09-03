import type { RasterDecodeFont } from '../font.js';
import type { JsonValue, RasterDecodeArtifact, RasterOptionsArgument, RuntimeRasterBakerLoader } from '../raster.js';
import { registerRasterFormat } from '../internal/raster-format-registry.js';

declare const rasterFormatIdBrand: unique symbol;
declare const rasterResourceIdBrand: unique symbol;
declare const rasterFormatTypes: unique symbol;

/** Stable public identity for one portable raster format. */
export type RasterFormatId = string & { readonly [rasterFormatIdBrand]: true };

/** Stable raster-authored identity for one physical raster resource. */
export type RasterResourceId = string & { readonly [rasterResourceIdBrand]: true };

/** Text effects a raster format and its shader can render. */
export type RasterTextEffect = 'outline' | 'shadow';

interface RasterFormatTypeMap<Options, Descriptor, Data> {
  readonly options: Options;
  readonly descriptor: Descriptor;
  readonly data: Data;
}

/** Common identity retained when concrete raster-format types are intentionally erased. */
export interface AnyRasterFormat {
  readonly id: RasterFormatId;
  readonly kind: string;
  readonly extension: string;
  readonly version: number;
  readonly textEffects: readonly RasterTextEffect[];
  readonly [rasterFormatTypes]?: RasterFormatTypeMap<unknown, JsonValue, unknown>;
}

/** Renderer-neutral raster identity, decoding, and ownership contract. */
export interface RasterFormat<
  Id extends RasterFormatId,
  Kind extends string,
  Options,
  Descriptor extends JsonValue,
  Data,
> extends AnyRasterFormat {
  (
    ...options: [Options] extends [never] ? [] : undefined extends Options ? [options?: Options] : [options: Options]
  ): RasterFormatRequest<RasterFormat<Id, Kind, Options, Descriptor, Data>>;

  readonly [rasterFormatTypes]?: RasterFormatTypeMap<Options, Descriptor, Data>;

  readonly id: Id;
  readonly kind: Kind;
  readonly extension: string;
  readonly version: number;
  readonly runtimeBaker?: RuntimeRasterBakerLoader<Kind, Options>;

  descriptor(options: RasterOptionsArgument<Options>): Descriptor;
  decode(font: RasterDecodeFont, raster: RasterDecodeArtifact<Kind>, signal?: AbortSignal): Promise<Data>;
  dispose(data: Data): void;
}

export type RasterFormatTypesOf<Format extends AnyRasterFormat> =
  Format extends RasterFormat<infer _Id, infer _Kind, infer Options, infer Descriptor, infer Data>
    ? RasterFormatTypeMap<Options, Descriptor, Data>
    : RasterFormatTypeMap<unknown, JsonValue, unknown>;

export type RasterOptionsOf<Format extends AnyRasterFormat> = RasterFormatTypesOf<Format>['options'];

export type RasterFormatRequest<Format extends AnyRasterFormat> = {
  readonly raster: Format;
} & ([RasterOptionsOf<Format>] extends [never]
  ? { readonly options?: never }
  : undefined extends RasterOptionsOf<Format>
    ? { readonly options?: RasterOptionsOf<Format> }
    : { readonly options: RasterOptionsOf<Format> });

export type RasterFormatInput<Format extends AnyRasterFormat> = [RasterOptionsOf<Format>] extends [never]
  ? Format | RasterFormatRequest<Format>
  : undefined extends RasterOptionsOf<Format>
    ? Format | RasterFormatRequest<Format>
    : RasterFormatRequest<Format>;

export type RasterFormatDescriptorOf<Format extends AnyRasterFormat> = RasterFormatTypesOf<Format>['descriptor'];

export type RasterDataOf<Format extends AnyRasterFormat> = RasterFormatTypesOf<Format>['data'];

type RasterFormatDefinition<Id extends string, Kind extends string, Options, Descriptor extends JsonValue, Data> = Omit<
  RasterFormat<RasterFormatId & Id, Kind, Options, Descriptor, Data>,
  'id'
> & {
  readonly id: Id;
};

/** Define one portable raster format while preserving every inferred associated type. */
export function defineRasterFormat<
  const Id extends string,
  const Kind extends string,
  Options,
  Descriptor extends JsonValue,
  Data,
>(
  format: RasterFormatDefinition<Id, Kind, Options, Descriptor, Data>,
): RasterFormat<RasterFormatId & Id, Kind, Options, Descriptor, Data> {
  assertIdentifier(format.id, 'raster format ID');
  assertIdentifier(format.kind, 'raster format kind');
  assertIdentifier(format.extension, 'raster format extension');
  if (!Number.isSafeInteger(format.version) || format.version < 0) {
    throw new RangeError('raster format version must be a nonnegative safe integer');
  }
  if (
    typeof format.descriptor !== 'function' ||
    typeof format.decode !== 'function' ||
    typeof format.dispose !== 'function' ||
    (format.runtimeBaker !== undefined && typeof format.runtimeBaker !== 'function')
  ) {
    throw new TypeError('raster formats need descriptor, decode, dispose, and optional runtimeBaker functions');
  }
  if (!Array.isArray(format.textEffects)) throw new TypeError('raster format textEffects must be an array');
  const textEffects = [...format.textEffects];
  for (const effect of textEffects) {
    if (effect !== 'outline' && effect !== 'shadow') {
      throw new TypeError(`raster format text effect "${String(effect)}" is not supported`);
    }
  }
  if (new Set(textEffects).size !== textEffects.length) {
    throw new TypeError('raster format textEffects must not contain duplicates');
  }
  type Defined = RasterFormat<RasterFormatId & Id, Kind, Options, Descriptor, Data>;
  let defined!: Defined;
  const select = (...options: readonly [Options?]): RasterFormatRequest<Defined> =>
    (options.length === 0 || options[0] === undefined
      ? { raster: defined }
      : { raster: defined, options: options[0] }) as unknown as RasterFormatRequest<Defined>;
  defined = Object.freeze(
    Object.assign(select, {
      id: format.id,
      kind: format.kind,
      extension: format.extension,
      version: format.version,
      textEffects: Object.freeze(textEffects),
      ...(format.runtimeBaker === undefined ? {} : { runtimeBaker: format.runtimeBaker }),
      descriptor: format.descriptor,
      decode: format.decode,
      dispose: format.dispose,
    }),
  ) as unknown as Defined;
  registerRasterFormat(defined);
  return defined;
}

/** Brand a stable resource identity produced by a portable technique. */
export function defineRasterResourceId<const Id extends string>(id: Id): RasterResourceId & Id {
  assertIdentifier(id, 'raster resource ID');
  return id as RasterResourceId & Id;
}

function assertIdentifier(value: string, label: string): void {
  if (value.length === 0) throw new TypeError(`${label} must not be empty`);
}
