export interface BitmapTextScale {
  readonly fontSize: number;
  readonly rasterPixelRatio: number;
}

/** Converts a logical CSS ppem into Three world units while preserving physical strike selection. */
export function bitmapTextScale(
  cssPpem: number,
  viewportHeight: number,
  canvasCssHeight: number,
  renderPixelRatio: number,
): BitmapTextScale {
  const worldUnitsPerCssPixel = viewportHeight / canvasCssHeight;
  return {
    fontSize: cssPpem * worldUnitsPerCssPixel,
    rasterPixelRatio: renderPixelRatio / worldUnitsPerCssPixel,
  };
}
