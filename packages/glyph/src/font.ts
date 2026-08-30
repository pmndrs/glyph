import type { RasterLoadOptions, RasterReference, RasterSelection, RegisteredRaster } from './raster.js';
import type { AnyRasterTechnique, RasterTechniqueInput, RasterTechniqueRequest } from './raster-technique.js';
import type { FontHandle, FontKey, RasterKey, Sha256Hex } from './identity.js';

/** Renderer-independent metrics expressed in font units. */
export interface FontMetrics {
  readonly unitsPerEm: number;
  readonly ascender: number;
  readonly descender: number;
  readonly lineGap: number;
  readonly underlinePosition: number;
  readonly underlineThickness: number;
  readonly strikeoutPosition: number;
  readonly strikeoutSize: number;
}

/** Immutable font metadata exposed to a raster technique while decoding its artifact. */
export interface RasterDecodeFont {
  readonly shapingHash: Sha256Hex;
  readonly glyphCount: number;
  readonly glyphIdWidth: 16;
  readonly metrics: FontMetrics;
}

/** Internal registered shaping font used while decoding and binding raster data. */
export interface RegisteredFont extends RasterDecodeFont {
  readonly key: FontKey;
  readonly handle: FontHandle;
  readonly rasterReferences: readonly RasterReference[];

  getRaster(rasterKey: RasterKey | string): RegisteredRaster | undefined;

  loadRaster<const Kind extends string>(
    selection: RasterSelection<Kind> & { readonly kind: Kind },
    options?: RasterLoadOptions,
  ): Promise<RegisteredRaster<Kind>>;

  loadRaster(selection: RasterSelection, options?: RasterLoadOptions): Promise<RegisteredRaster>;

  dispose(): void;
}

/** Byte-backed font input with explicit copy or transfer ownership. */
export type FontBytesInput =
  | { readonly bytes: ArrayBufferView; readonly ownership?: 'copy' }
  | { readonly bytes: ArrayBufferView; readonly ownership: 'transfer' };

/** Immutable application font lease for one raster technique. */
export interface Font<Technique extends AnyRasterTechnique> {
  readonly metrics: FontMetrics;
  readonly glyphCount: number;
  readonly technique: Technique;
  readonly disposed: boolean;
  dispose(): void;
}

/** Source font plus an optional explicit baked-artifact location. */
export interface FontSourceOverride {
  readonly source: string | URL | FontBytesInput;
  /** Explicitly set null to skip baked-sibling discovery for this load. */
  readonly baked?: string | URL | FontBytesInput | null;
}

/** Baked-only font input that performs no source-sibling discovery. */
export interface BakedFontSource {
  readonly baked: string | URL | FontBytesInput;
  readonly source?: never;
}

/** Accepted source, baked artifact, or byte-backed font location. */
export type FontInput = string | URL | FontSourceOverride | BakedFontSource;

/** Static bake-discovery token pairing one font input with one raster request. */
export interface FontToken<Technique extends AnyRasterTechnique, Input extends FontInput = FontInput> {
  readonly input: Input;
  readonly raster: RasterTechniqueRequest<Technique>;
}

/** Technique-erased font token used by build-time discovery. */
export interface AnyFontToken {
  readonly input: FontInput;
  readonly raster: {
    readonly technique: AnyRasterTechnique;
    readonly options?: unknown;
  };
}

/** Extracts the input type carried by a font token. */
export type FontInputOf<Token extends AnyFontToken> = Token['input'];

/** Extracts the raster-technique type carried by a font token. */
export type FontRasterTechniqueOf<Token extends AnyFontToken> = Token['raster']['technique'];

/** Defines a statically discoverable font bake request without loading the font. */
export function defineFont<const Input extends FontInput, const Technique extends AnyRasterTechnique>(
  input: Input,
  raster: RasterTechniqueInput<Technique>,
): FontToken<Technique, Input>;

export function defineFont(
  input: FontInput,
  raster: AnyRasterTechnique | RasterTechniqueRequest<AnyRasterTechnique>,
): AnyFontToken {
  return {
    input,
    raster: 'technique' in raster ? raster : { technique: raster },
  };
}
