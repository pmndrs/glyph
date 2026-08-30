import type { RasterDecodeFont, RegisteredFont } from './font.js';
import type { FontHandle, RasterHandle, RasterKey, Sha256Hex } from './identity.js';
import type { BakeProgressListener, RasterBakeArtifact } from './bake.js';

export type RasterKind = string;

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type RasterOptionsArgument<Options> = [Options] extends [never] ? undefined : Options;

export type StaticNumberTuple<Values extends readonly [number, ...number[]]> = number extends Values[number]
  ? never
  : Values;

export type RasterSource =
  | { readonly type: 'embedded' }
  | {
      readonly type: 'external';
      readonly uri: string;
      readonly artifactHash: Sha256Hex;
    }
  | {
      readonly type: 'external';
      readonly uri?: never;
      readonly artifactHash?: Sha256Hex;
    };

export interface RasterReference<Kind extends string = string> {
  readonly rasterKey: RasterKey;
  readonly kind: Kind;
  readonly extension: string;
  readonly version: number;
  readonly source: RasterSource;
}

export type RasterResourceSource =
  | { readonly type: 'bufferView'; readonly bufferView: number }
  | {
      readonly type: 'external';
      readonly uri: string;
      readonly byteLength: number;
      readonly artifactHash: Sha256Hex;
    };

export interface RasterSelection<Kind extends string = string> {
  readonly rasterKey: RasterKey | string;
  readonly kind?: Kind;
}

/** Immutable artifact reader exposed to a raster technique during decode. */
export interface RasterDecodeArtifact<Kind extends string = string> {
  readonly rasterKey: RasterKey;
  readonly kind: Kind;
  readonly extension: string;
  readonly version: number;
  /** Validated companion-extension JSON owned semantically by the raster module. */
  readonly extensionData: JsonValue;
  /** Borrow a bounds-checked view of immutable artifact storage. Technique providers must not mutate it. */
  view(bufferView: number): Uint8Array;
  /** Resolve an embedded or authenticated external extension resource. */
  resource(source: RasterResourceSource, signal?: AbortSignal): Promise<Uint8Array>;
}

export interface RegisteredRaster<Kind extends string = string> extends RasterDecodeArtifact<Kind> {
  readonly handle: RasterHandle;
  readonly font: FontHandle;
  dispose(): void;
}

export interface RasterLoadOptions {
  readonly resolve?: RasterResolver;
  readonly resolveResource?: RasterResourceResolver;
  readonly signal?: AbortSignal;
}

export interface RasterResolverContext {
  readonly font: RegisteredFont;
  readonly reference: RasterReference;
  readonly signal?: AbortSignal;
}

export type RasterResolver = (context: RasterResolverContext) => Promise<ArrayBufferView | undefined>;

export interface RasterResourceResolverContext {
  readonly font: RegisteredFont;
  readonly reference: RasterReference;
  readonly source: Extract<RasterResourceSource, { readonly type: 'external' }>;
  readonly signal?: AbortSignal;
}

export type RasterResourceResolver = (context: RasterResourceResolverContext) => Promise<ArrayBufferView | undefined>;

interface RuntimeRasterBakeRequestBase {
  readonly source: Uint8Array;
  readonly font: RasterDecodeFont;
  readonly fontFaceIndex: number;
  readonly rasterKey: RasterKey | string;
  readonly signal?: AbortSignal;
  readonly onProgress?: BakeProgressListener;
}

export type RuntimeRasterBakeRequest<Options> = RuntimeRasterBakeRequestBase &
  ([Options] extends [never] ? { readonly options?: never } : { readonly options: Options });

export interface RuntimeRasterBakerModule<Kind extends string, Options> {
  readonly kind: Kind;
  bake(request: RuntimeRasterBakeRequest<Options>): Promise<RasterBakeArtifact<Kind>>;
}

export type RuntimeRasterBakerLoader<Kind extends string, Options> = () => Promise<
  RuntimeRasterBakerModule<Kind, Options> | { readonly default: RuntimeRasterBakerModule<Kind, Options> }
>;

export type RasterKindOf<Raster extends { readonly kind: string }> = Raster['kind'];
