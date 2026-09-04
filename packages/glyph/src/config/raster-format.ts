import type { RasterDecodeFont } from '../font.js';
import type { JsonValue, RasterDecodeArtifact, RasterOptionsArgument, RuntimeRasterBakerLoader } from '../raster.js';
import {
  rasterFormatDescriptor,
  rasterFormatOperation,
  registerRasterFormat,
  registerRasterFormatRequest,
  type RasterFormatOperation,
  type RasterFormatOperationVisitor,
} from '../internal/raster-format-registry.js';
import {
  bindRasterFormatCompiler,
  installRasterFormatCompiler,
  type RasterFontCompileInput,
  type RasterFormatCompiler,
  type RasterFormatCompilerWitness,
} from '../internal/raster-format-compiler.js';

declare const rasterFormatIdBrand: unique symbol;
declare const rasterResourceIdBrand: unique symbol;
declare const rasterFormatTypes: unique symbol;
declare const rasterFormatRequestBrand: unique symbol;

/** Stable public identity for one portable raster format. */
export type RasterFormatId = string & { readonly [rasterFormatIdBrand]: true };

/** Raster-authored identity for one renderer resource realization. Equal IDs must describe the same format, schema role, companion set, metadata, and bytes — mint a new ID whenever any part changes. */
export type RasterResourceId = string & { readonly [rasterResourceIdBrand]: true };

/** Text effects a raster format and its shader can render. */
export type RasterTextEffect = 'outline' | 'shadow';

interface RasterFormatTypeMap<Options, Descriptor, Data> {
  readonly options: Options;
  readonly descriptor: Descriptor;
  readonly data: Data;
}

/** Renderer-neutral identity and capabilities shared by every concrete raster format. */
export interface RasterFormatMetadata {
  readonly id: RasterFormatId;
  readonly kind: string;
  readonly extension: string;
  readonly version: number;
  readonly textEffects: readonly RasterTextEffect[];
}

/** Renderer-neutral raster identity, decoding, and ownership contract. */
export interface RasterFormat<
  Id extends RasterFormatId,
  Kind extends string,
  Options,
  Descriptor extends JsonValue,
  Data,
> extends RasterFormatMetadata {
  (
    ...options: [Options] extends [never] ? [] : undefined extends Options ? [options?: Options] : [options: Options]
  ): RasterFormatRequest<RasterFormat<Id, Kind, Options, Descriptor, Data>>;

  readonly [rasterFormatTypes]?: RasterFormatTypeMap<Options, Descriptor, Data>;

  readonly id: Id;
  readonly kind: Kind;
  readonly extension: string;
  readonly version: number;
  readonly runtimeBaker?: RuntimeRasterBakerLoader<Kind, Options>;

  /** Package-private: concrete data stays paired with its compiler through this private witness. */
  readonly [installRasterFormatCompiler]: RasterFormatCompilerWitness<Data>[typeof installRasterFormatCompiler];
  /** Package-private: produces an ids-only compiler closed over concrete decoded data. */
  readonly [bindRasterFormatCompiler]: RasterFormatCompilerWitness<Data>[typeof bindRasterFormatCompiler];

  descriptor(options: RasterOptionsArgument<Options>): Descriptor;
  decode(font: RasterDecodeFont, raster: RasterDecodeArtifact<Kind>, signal?: AbortSignal): Promise<Data>;
  dispose(data: Data): void;
}

export type RasterFormatTypesOf<Format extends RasterFormatMetadata> =
  Format extends RasterFormat<infer _Id, infer _Kind, infer Options, infer Descriptor, infer Data>
    ? RasterFormatTypeMap<Options, Descriptor, Data>
    : never;

export type RasterOptionsOf<Format extends RasterFormatMetadata> = RasterFormatTypesOf<Format>['options'];

/** Identity-only view of an options-bound raster request. */
export interface RasterFormatRequestMetadata {
  readonly [rasterFormatRequestBrand]: true;
  readonly raster: RasterFormatMetadata;
}

export type RasterFormatRequest<Format extends RasterFormatMetadata> = RasterFormatRequestMetadata & {
  readonly raster: Format;
} & ([RasterOptionsOf<Format>] extends [never]
    ? { readonly options?: never }
    : undefined extends RasterOptionsOf<Format>
      ? { readonly options?: RasterOptionsOf<Format> }
      : { readonly options: RasterOptionsOf<Format> });

export type RasterFormatInput<Format extends RasterFormatMetadata> = [RasterOptionsOf<Format>] extends [never]
  ? Format | RasterFormatRequest<Format>
  : undefined extends RasterOptionsOf<Format>
    ? Format | RasterFormatRequest<Format>
    : RasterFormatRequest<Format>;

export type RasterFormatDescriptorOf<Format extends RasterFormatMetadata> = RasterFormatTypesOf<Format>['descriptor'];

export type RasterDataOf<Format extends RasterFormatMetadata> = RasterFormatTypesOf<Format>['data'];

type RasterFormatDefinition<Id extends string, Kind extends string, Options, Descriptor extends JsonValue, Data> = Omit<
  RasterFormat<RasterFormatId & Id, Kind, Options, Descriptor, Data>,
  'id' | typeof installRasterFormatCompiler | typeof bindRasterFormatCompiler
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
  assertPattern(
    format.kind,
    /^[A-Za-z][A-Za-z0-9]*(?:[.-][A-Za-z0-9]+)*$/,
    'raster format kind',
    'bitmap or vendor.name',
  );
  assertPattern(
    format.extension,
    /^[A-Z][A-Z0-9]*(?:_[A-Za-z0-9]+)+$/,
    'raster format extension',
    'VENDOR_feature_name',
  );
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
  let compiler: RasterFormatCompiler<Data> | undefined;
  let defined!: Defined;
  const select = (...options: readonly [Options?]): RasterFormatRequest<Defined> => {
    const request = (
      options.length === 0 || options[0] === undefined
        ? Object.freeze({ raster: defined })
        : Object.freeze({ raster: defined, options: options[0] })
    ) as RasterFormatRequest<Defined>;
    const operation: RasterFormatOperation = {
      format: defined,
      visit<Result>(visitor: RasterFormatOperationVisitor<Result>): Result {
        return visitor.visit(defined, request);
      },
    };
    registerRasterFormatRequest(request, () => format.descriptor(options[0]!), operation);
    return request;
  };
  const id = format.id as RasterFormatId & Id;
  defined = Object.freeze(
    Object.assign(select, {
      id,
      kind: format.kind,
      extension: format.extension,
      version: format.version,
      textEffects: Object.freeze(textEffects),
      ...(format.runtimeBaker === undefined ? {} : { runtimeBaker: format.runtimeBaker }),
      descriptor: format.descriptor,
      decode: format.decode,
      dispose: format.dispose,
      [installRasterFormatCompiler](next: RasterFormatCompiler<Data>): void {
        if (compiler !== undefined && compiler !== next) {
          throw new TypeError(`a different raster codec is already registered for "${format.id}"`);
        }
        compiler = next;
      },
      [bindRasterFormatCompiler](data: Data) {
        return (input: RasterFontCompileInput) => compiler?.(input, data);
      },
    }),
  );
  const defaultRequest = select();
  registerRasterFormat(defined, () => rasterFormatDescriptor(defaultRequest), rasterFormatOperation(defaultRequest));
  return defined;
}

/** Brand a stable renderer-resource identity produced by a portable raster format. */
export function defineRasterResourceId<const Id extends string>(id: Id): RasterResourceId & Id {
  assertIdentifier(id, 'raster resource ID');
  return id as RasterResourceId & Id;
}

function assertIdentifier(value: string, label: string): void {
  if (value.length === 0) throw new TypeError(`${label} must not be empty`);
}

/**
 * A kind is interpolated into the compatibility digest's canonical form and into resource
 * identities, so it is restricted to characters that need no escaping in either. Rust builds that
 * canonical string by interpolation rather than serialization; a kind carrying a quote or a
 * backslash would hash differently there than it does here. A glTF extension name is an uppercase
 * vendor prefix followed by underscore-separated parts.
 */
function assertPattern(value: string, pattern: RegExp, label: string, shape: string): void {
  assertIdentifier(value, label);
  if (!pattern.test(value)) throw new TypeError(`${label} ${JSON.stringify(value)} must look like ${shape}`);
}
