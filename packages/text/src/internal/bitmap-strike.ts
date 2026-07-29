export function nearestBitmapStrikeIndex(
  strikes: readonly { readonly ppem: number }[],
  cssFontSize: number,
  rasterPixelRatio: number,
): number {
  if (strikes.length === 0) throw new TypeError('bitmap resource has no strikes');
  if (!Number.isFinite(cssFontSize) || cssFontSize < 0)
    throw new TypeError('bitmap CSS font size must be finite and non-negative');
  if (!Number.isFinite(rasterPixelRatio) || rasterPixelRatio <= 0)
    throw new TypeError('bitmap raster pixel ratio must be finite and positive');
  const targetPpem = cssFontSize * rasterPixelRatio;
  let selectedIndex = 0;
  for (let index = 1; index < strikes.length; index += 1) {
    if (Math.abs(strikes[index]!.ppem - targetPpem) < Math.abs(strikes[selectedIndex]!.ppem - targetPpem)) {
      selectedIndex = index;
    }
  }
  return selectedIndex;
}
