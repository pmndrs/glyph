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
  /** Identity of the prepared source this font was baked from; rasters are built from its outlines. */
  readonly sourceFingerprint: Fingerprint;
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

/**
 * How loading a font treats its glyph outlines, which a font carries only when it was baked with
 * `glyph bake --outlines`:
 *
 * - `'auto'` decodes them when the font has them and loads without them otherwise, silently: outlines are optional.
 * - `'require'` decodes them and rejects the load with `GlyphFontError` reason `FONT_OUTLINES_UNAVAILABLE` when the
 *   font has none.
 * - `'skip'` neither decodes nor retains them, which avoids their decode time and memory for a font whose outlines
 *   are never read; `outlineAt` then throws.
 */
export type FontOutlineMode = 'auto' | 'require' | 'skip';

/** Source font plus an optional explicit baked-artifact location. */
export interface FontSourceOverride {
  readonly source: string | URL | FontBytesInput;
  /** Explicitly set null to skip baked-sibling discovery for this load. */
  readonly baked?: string | URL | FontBytesInput | null;
  /**
   * Whether this load decodes the font's glyph outlines; `'auto'` when omitted, as for a bare URL. Loads of one font
   * that differ only in this mode converge on one font that only ever gains outlines: a later `'auto'` or `'require'`
   * adds them to a font an earlier `'skip'` left without, and a later `'skip'` removes none.
   */
  readonly outlines?: FontOutlineMode;
}

/** Baked-only font input that performs no source-sibling discovery. */
export interface BakedFontSource {
  readonly baked: string | URL | FontBytesInput;
  readonly source?: never;
  /** Whether this load decodes the font's glyph outlines; see `FontSourceOverride.outlines`. */
  readonly outlines?: FontOutlineMode;
}

/** Accepted source, baked artifact, or byte-backed font location. */
export type FontInput = string | URL | FontSourceOverride | BakedFontSource;
