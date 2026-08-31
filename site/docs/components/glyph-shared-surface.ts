export type GlyphSurfaceSize = Readonly<{
  dpr: number;
  height: number;
  width: number;
}>;

export type GlyphPoint = Readonly<{
  x: number;
  y: number;
}>;

export type GlyphProxySize = Readonly<{
  height: number;
  width: number;
}>;

/** Size one page-level virtual frame for the largest registered proxy, never their sum. */
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

/** Translate a point in a centered proxy clipping window into the page-level virtual frame. */
export function proxyPointToVirtualFrame(frame: GlyphProxySize, proxy: GlyphProxySize, point: GlyphPoint): GlyphPoint {
  return {
    x: point.x + (frame.width - proxy.width) / 2,
    y: point.y + (frame.height - proxy.height) / 2,
  };
}
