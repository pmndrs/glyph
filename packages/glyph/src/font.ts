import type { RasterLoadOptions, RasterReference, RasterSelection, RegisteredRaster } from './raster.js';
import type { RasterFormatMetadata } from './config/raster-format.js';
import type { FontHandle, FontKey, RasterKey, Fingerprint } from './identity.js';

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

/** Immutable font metadata exposed to a raster format while decoding its artifact. */
export interface RasterDecodeFont {
  readonly shapingFingerprint: Fingerprint;
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

/** Immutable application font lease for one raster format. */
export interface Font<Format extends RasterFormatMetadata> {
  readonly metrics: FontMetrics;
  readonly glyphCount: number;
  readonly raster: Format;
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
