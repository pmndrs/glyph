/**
 * Adapted from three-flatland Slug at 2935a89f (MIT).
 *
 * These functions are the whole per-fragment fill algorithm apart from resource
 * access: a host supplies band headers, glyph-local curve references, and curve
 * control points however its backend stores them, and evaluates the same math.
 */
import { d, std } from 'typegpu';
import { calcRootCode } from './root-code.js';
import { solveHorizontalPolynomial } from './solve-quadratic.js';

const HEADER_REFERENCE_MASK = 0xffff;
const HEADER_COUNT_SHIFT = 16;

/** Maximum curves one fragment may evaluate from a hostile artifact. */
export const MAX_SAFE_SLUG_BAND_CURVES = 512;

/**
 * Screen-space glyph scale for one fragment: `x` and `y` hold the per-axis
 * pixels per em that drive each fill band, and `z` their mean, which drives the
 * resolution-dependent stem darkening and thickening.
 */
export function slugPixelsPerEm(renderCoordinate: d.v2f): d.v3f {
  'use gpu';

  const emsPerPixel = std.fwidth(renderCoordinate);
  const pixelsPerEmX = 1 / std.max(emsPerPixel.x, 1 / 65_536);
  const pixelsPerEmY = 1 / std.max(emsPerPixel.y, 1 / 65_536);

  return d.vec3f(pixelsPerEmX, pixelsPerEmY, (pixelsPerEmX + pixelsPerEmY) * 0.5);
}

/** Coverage widening applied below 24 pixels per em. Zero `thicken` is exactly 1. */
export function slugThickenFactor(thicken: number, pixelsPerEm: number): number {
  'use gpu';

  return 1 + thicken * std.max(d.f32(0), 1 - pixelsPerEm / 24);
}

/** Clamp a glyph-em coordinate into its axis band grid through the glyph's band transform. */
export function slugBandIndex(coordinate: number, scale: number, offset: number, declaredBandCount: number): number {
  'use gpu';

  return d.u32(std.clamp(coordinate * scale + offset, d.f32(0), d.f32(declaredBandCount) - 1));
}

/** Curve count of a V0 `(count << 16) | offset` band header, capped against hostile artifacts. */
export function slugBandCurveCount(header: number): number {
  'use gpu';

  return std.min(header >> HEADER_COUNT_SHIFT, d.u32(MAX_SAFE_SLUG_BAND_CURVES));
}

/** Glyph-local reference offset of a V0 `(count << 16) | offset` band header. */
export function slugBandReferenceOffset(header: number): number {
  'use gpu';

  return header & d.u32(HEADER_REFERENCE_MASK);
}

/** Unpack one V0 u16 curve reference from the u32 pair holding it. */
export function slugReferenceFromPair(pair: number, referenceIndex: number): number {
  'use gpu';

  return (pair >> ((referenceIndex & d.u32(1)) * 16)) & d.u32(HEADER_REFERENCE_MASK);
}

/**
 * One candidate curve's contribution to a fill band, in the band's ray frame.
 *
 * The ray travels along +x through y=0: `x` is the signed coverage delta, `y` the
 * curve's antialiasing weight, and `z` its largest ray-axis coordinate in pixels,
 * which the caller compares against -0.5 to stop traversing sorted references.
 */
function curveContribution(
  curveP0: d.v2f,
  curveP1: d.v2f,
  curveP2: d.v2f,
  renderCoordinate: d.v2f,
  pixelsPerEm: number,
  thickenFactor: number,
): d.v3f {
  'use gpu';

  const p0 = curveP0.sub(renderCoordinate);
  const p1 = curveP1.sub(renderCoordinate);
  const p2 = curveP2.sub(renderCoordinate);
  const maximum = std.max(p0.x, p1.x, p2.x) * pixelsPerEm;
  const rootCode = calcRootCode(p0.y, p1.y, p2.y);
  let coverage = d.f32(0);
  let weight = d.f32(0);

  if (rootCode > 0) {
    const roots = solveHorizontalPolynomial(p0, p1, p2);
    const firstRoot = roots.x * pixelsPerEm;
    const secondRoot = roots.y * pixelsPerEm;
    const hasFirstRoot = (rootCode & d.u32(1)) > 0;
    const hasSecondRoot = (rootCode & d.u32(0x100)) > 0;
    const firstContribution = std.select(d.f32(0), std.saturate(firstRoot * thickenFactor + 0.5), hasFirstRoot);
    const secondContribution = std.select(d.f32(0), std.saturate(secondRoot * thickenFactor + 0.5), hasSecondRoot);
    coverage = firstContribution - secondContribution;
    weight = std.max(
      std.select(d.f32(0), std.saturate(1 - std.abs(firstRoot) * 2), hasFirstRoot),
      std.select(d.f32(0), std.saturate(1 - std.abs(secondRoot) * 2), hasSecondRoot),
    );
  }

  return d.vec3f(coverage, weight, maximum);
}

/** One candidate curve's contribution to a horizontal fill band. */
export function slugHorizontalCurveContribution(
  curveP0: d.v2f,
  curveP1: d.v2f,
  curveP2: d.v2f,
  renderCoordinate: d.v2f,
  pixelsPerEm: number,
  thickenFactor: number,
): d.v3f {
  'use gpu';

  return curveContribution(curveP0, curveP1, curveP2, renderCoordinate, pixelsPerEm, thickenFactor);
}

/**
 * One candidate curve's contribution to a vertical fill band.
 *
 * A vertical band is the horizontal band in the transposed frame with the
 * opposite winding sense, so both axes share one curve evaluator.
 */
export function slugVerticalCurveContribution(
  curveP0: d.v2f,
  curveP1: d.v2f,
  curveP2: d.v2f,
  renderCoordinate: d.v2f,
  pixelsPerEm: number,
  thickenFactor: number,
): d.v3f {
  'use gpu';

  const contribution = curveContribution(
    curveP0.yx,
    curveP1.yx,
    curveP2.yx,
    renderCoordinate.yx,
    pixelsPerEm,
    thickenFactor,
  );

  return d.vec3f(-contribution.x, contribution.y, contribution.z);
}
