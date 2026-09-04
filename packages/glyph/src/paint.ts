/** Linear RGBA values supplied to raster modules after author paint is resolved. */
export type LinearRgba = readonly [red: number, green: number, blue: number, alpha: number];

export interface ResolvedPaint {
  readonly color: LinearRgba;
  readonly outline?: {
    readonly color: LinearRgba;
    /** Paragraph-local units. */
    readonly width: number;
  };
  readonly shadow?: {
    readonly color: LinearRgba;
    /** Paragraph-local units: positive X is right and positive Y is down. */
    readonly offset: readonly [x: number, y: number];
  };
}

/** Paint attribution parallel to a GlyphLayout's glyph arrays; raster modules map these into their own instance buffers. */
export interface GlyphPaint {
  readonly paintIndices: Uint16Array;
  readonly palette: readonly ResolvedPaint[];
}
