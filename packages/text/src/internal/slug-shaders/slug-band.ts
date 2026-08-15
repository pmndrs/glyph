/**
 * Three.js/TSL fill-band traversal over the host-agnostic band math in `core/band.js`.
 *
 * The loop, its early terminator, and every texture read live here because they are
 * bound to Three.js control flow and to this page's texture layout. Each candidate
 * curve's coverage, weight, and terminator come from one portable core call.
 */
import tgpu, { d, std } from 'typegpu';
import {
  slugBandCurveCount,
  slugBandIndex,
  slugBandReferenceOffset,
  slugHorizontalCurveContribution,
  slugVerticalCurveContribution,
} from './core/band.js';
import { loadCurve, loadHeader, loadReference, type SlugShaderCurve } from './slug-texture.js';

export const SlugShaderGlyph: d.WgslStruct<{
  curveBaseTexel: d.U32;
  horizontalHeaderBase: d.U32;
  verticalHeaderBase: d.U32;
  referenceBase: d.U32;
  horizontalBandCount: d.U32;
  verticalBandCount: d.U32;
  bandTransform: d.Vec4f;
}> = d.struct({
  curveBaseTexel: d.u32,
  horizontalHeaderBase: d.u32,
  verticalHeaderBase: d.u32,
  referenceBase: d.u32,
  horizontalBandCount: d.u32,
  verticalBandCount: d.u32,
  bandTransform: d.vec4f,
});

export type SlugShaderGlyph = d.InferGPU<typeof SlugShaderGlyph>;

export const SlugBandEvaluation: d.WgslStruct<{ coverage: d.F32; weight: d.F32 }> = d.struct({
  coverage: d.f32,
  weight: d.f32,
});

type SlugBandEvaluation = d.InferGPU<typeof SlugBandEvaluation>;

/** Signed coverage delta, antialiasing weight, and sorted-reference terminator of one curve. */
type SlugCurveContribution = (
  curveP0: d.v2f,
  curveP1: d.v2f,
  curveP2: d.v2f,
  renderCoordinate: d.v2f,
  pixelsPerEm: number,
  thickenFactor: number,
) => d.v3f;

const contributeSlot = tgpu.slot<SlugCurveContribution>();

/**
 * @note Uses `contributeSlot`
 */
function curveContribution(
  curve: SlugShaderCurve,
  renderCoordinate: d.v2f,
  pixelsPerEm: /* f32 */ number,
  thickenFactor: /* f32 */ number,
): d.v3f {
  'use gpu';
  return contributeSlot.$(curve.p0, curve.p1, curve.p2, renderCoordinate, pixelsPerEm, thickenFactor);
}

const getCurveContribution = tgpu.comptime((axis: 'vertical' | 'horizontal') =>
  tgpu
    .fn(curveContribution)
    .with(contributeSlot, axis === 'horizontal' ? slugHorizontalCurveContribution : slugVerticalCurveContribution),
);

const axisSlot = tgpu.slot<'vertical' | 'horizontal'>();

/**
 * @note Uses `pageSlot`
 */
function genericEvaluateBand(
  glyph: SlugShaderGlyph,
  renderCoordinate: d.v2f,
  pixelsPerEm: /* f32 */ number,
  thickenFactor: /* f32 */ number,
): SlugBandEvaluation {
  'use gpu';
  const coordinate: /* f32 */ number = axisSlot.$ === 'horizontal' ? renderCoordinate.y : renderCoordinate.x;
  const transformScale: /* f32 */ number = axisSlot.$ === 'horizontal' ? glyph.bandTransform.y : glyph.bandTransform.x;
  const transformOffset: /* f32 */ number = axisSlot.$ === 'horizontal' ? glyph.bandTransform.w : glyph.bandTransform.z;
  const declaredBandCount /* u32 */ = axisSlot.$ === 'horizontal' ? glyph.horizontalBandCount : glyph.verticalBandCount;
  const headerBase /* u32 */ = axisSlot.$ === 'horizontal' ? glyph.horizontalHeaderBase : glyph.verticalHeaderBase;
  const bandIndex /* u32 */ = slugBandIndex(coordinate, transformScale, transformOffset, declaredBandCount);
  const header /* u32 */ = loadHeader(headerBase + bandIndex);
  const localReferenceOffset /* u32 */ = slugBandReferenceOffset(header);
  const curveCount = slugBandCurveCount(header);

  let coverage /* f32 */ = d.f32(0);
  let weight /* f32 */ = d.f32(0);
  let curveIndex /* u32 */ = d.u32(0);

  while (curveIndex < curveCount) {
    const referenceIndex = /* u32 */ d.u32(glyph.referenceBase + localReferenceOffset + curveIndex);
    const curveReference = /* u32 */ loadReference(referenceIndex);
    const curve = loadCurve(glyph.curveBaseTexel + curveReference);
    const contribution = getCurveContribution(axisSlot.$)(curve, renderCoordinate, pixelsPerEm, thickenFactor);

    // The references of a band are sorted by descending ray-axis maximum, so the
    // first curve that cannot reach this fragment ends the band.
    if (contribution.z < -0.5) {
      curveIndex = curveCount;
    } else {
      coverage += contribution.x;
      weight = std.max(weight, contribution.y);
      curveIndex++;
    }
  }

  return SlugBandEvaluation({ coverage, weight });
}

export const evaluateBand: (axis: 'vertical' | 'horizontal') => typeof genericEvaluateBand = tgpu.comptime(
  (axis: 'vertical' | 'horizontal'): typeof genericEvaluateBand => tgpu.fn(genericEvaluateBand).with(axisSlot, axis),
);
