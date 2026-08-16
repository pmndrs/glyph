/** Linear RGBA values supplied to raster modules after author paint is resolved. */
export type LinearRgba = readonly [red: number, green: number, blue: number, alpha: number];

export interface ResolvedPaint {
  readonly color: LinearRgba;
  readonly outline?: {
    readonly color: LinearRgba;
    /** Paragraph-local layout units. */
    readonly width: number;
  };
  readonly shadow?: {
    readonly color: LinearRgba;
    /** Paragraph-local layout units: positive X is right and positive Y is down. */
    readonly offset: readonly [x: number, y: number];
  };
}

/**
 * Core-owned paint attribution parallel to a ParagraphLayout's glyph arrays.
 * Raster modules own how these resolved values enter their instance buffers.
 */
export interface GlyphPaint {
  readonly paintIndices: Uint16Array;
  readonly palette: readonly ResolvedPaint[];
}
