export type GlyphSurfaceSize = Readonly<{
  dpr: number;
  height: number;
  width: number;
}>;

/** Size one shared renderer for the largest active logical surface, never their sum. */
export function largestGlyphSurface(sizes: readonly GlyphSurfaceSize[]): GlyphSurfaceSize {
  let dpr = 1;
  let height = 1;
  let width = 1;
  for (const size of sizes) {
    dpr = Math.max(dpr, size.dpr);
    height = Math.max(height, size.height);
    width = Math.max(width, size.width);
  }
  return { dpr, height, width };
}
