import type { RasterLoadOptions, RasterReference, RasterSelection, RegisteredRaster } from './raster.js';
import type { AnyRasterTechnique, RasterTechniqueInput, RasterTechniqueRequest } from './raster-technique.js';
import type { FontHandle, FontKey, RasterKey, Sha256Hex } from './identity.js';

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

export interface RegisteredFont {
  readonly key: FontKey;
  readonly handle: FontHandle;
  readonly shapingHash: Sha256Hex;
  readonly glyphCount: number;
  readonly glyphIdWidth: 16;
  readonly metrics: FontMetrics;
  readonly rasterReferences: readonly RasterReference[];

  getRaster(rasterKey: RasterKey | string): RegisteredRaster | undefined;

  loadRaster<const Kind extends string>(
    selection: RasterSelection<Kind> & { readonly kind: Kind },
    options?: RasterLoadOptions,
  ): Promise<RegisteredRaster<Kind>>;

  loadRaster(selection: RasterSelection, options?: RasterLoadOptions): Promise<RegisteredRaster>;

  dispose(): void;
}

export interface FontSourceOverride {
  readonly source: string | URL;
  /** Explicitly set null to skip baked-sibling discovery for this load. */
  readonly baked?: string | URL | null;
}

export interface BakedFontSource {
  readonly baked: string | URL;
  readonly source?: never;
}

export type FontInput = string | URL | FontSourceOverride | BakedFontSource;

export interface FontToken<Technique extends AnyRasterTechnique, Input extends FontInput = FontInput> {
  readonly input: Input;
  readonly raster: RasterTechniqueRequest<Technique>;
}

export interface AnyFontToken {
  readonly input: FontInput;
  readonly raster: {
    readonly technique: AnyRasterTechnique;
    readonly options?: unknown;
  };
}

export type FontInputOf<Token extends AnyFontToken> = Token['input'];

export type FontRasterTechniqueOf<Token extends AnyFontToken> = Token['raster']['technique'];

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
