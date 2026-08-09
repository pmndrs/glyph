/**
 * Three.js/TSL fill-band traversal over the host-agnostic band math in `core/band.js`.
 *
 * The loop, its early terminator, and every texture read live here because they are
 * bound to Three.js control flow and to this page's texture layout. Each candidate
 * curve's coverage, weight, and terminator come from one portable core call.
 */
import type { Node } from 'three/webgpu';
import { If, float, int, lessThan, max, uint } from 'three/tsl';
import { d } from 'typegpu';
import * as t3 from '@typegpu/three';
import { coreValue } from './core-boundary.js';
import {
  slugBandCurveCount,
  slugBandIndex,
  slugBandReferenceOffset,
  slugHorizontalCurveContribution,
  slugVerticalCurveContribution,
} from './core/band.js';
import { loadCurve, loadHeader, loadReference, type SlugShaderCurve, type SlugShaderPage } from './slug-texture.js';
import { intLessThan, uintAdd, whileLoop } from './tsl-compat.js';

export interface SlugShaderGlyph {
  readonly curveBaseTexel: Node<'uint'>;
  readonly horizontalHeaderBase: Node<'uint'>;
  readonly verticalHeaderBase: Node<'uint'>;
  readonly referenceBase: Node<'uint'>;
  readonly horizontalBandCount: Node<'uint'>;
  readonly verticalBandCount: Node<'uint'>;
  readonly bandTransform: Node<'vec4'>;
}

interface SlugBandEvaluation {
  readonly coverage: Node<'float'>;
  readonly weight: Node<'float'>;
}

/** Signed coverage delta, antialiasing weight, and sorted-reference terminator of one curve. */
type SlugCurveContribution = (
  curveP0: d.v2f,
  curveP1: d.v2f,
  curveP2: d.v2f,
  renderCoordinate: d.v2f,
  pixelsPerEm: number,
  thickenFactor: number,
) => d.v3f;

function curveContribution(
  contribute: SlugCurveContribution,
  name: string,
  curve: SlugShaderCurve,
  renderCoordinate: Node<'vec2'>,
  pixelsPerEm: Node<'float'>,
  thickenFactor: Node<'float'>,
): Node<'vec3'> {
  return coreValue('vec3', name, () => {
    'use gpu';
    return contribute(
      t3.fromTSL(curve.p0, d.vec2f).$,
      t3.fromTSL(curve.p1, d.vec2f).$,
      t3.fromTSL(curve.p2, d.vec2f).$,
      t3.fromTSL(renderCoordinate, d.vec2f).$,
      t3.fromTSL(pixelsPerEm, d.f32).$,
      t3.fromTSL(thickenFactor, d.f32).$,
    );
  });
}

function evaluateBandCurve(
  index: Node<'int'>,
  curveCount: Node<'int'>,
  page: SlugShaderPage,
  glyph: SlugShaderGlyph,
  renderCoordinate: Node<'vec2'>,
  axis: 'horizontal' | 'vertical',
  pixelsPerEm: Node<'float'>,
  thickenFactor: Node<'float'>,
  localReferenceOffset: Node<'uint'>,
  coverage: Node<'float'>,
  weight: Node<'float'>,
): void {
  const referenceIndex: Node<'uint'> = uintAdd(uintAdd(glyph.referenceBase, localReferenceOffset), uint(index));
  const curveReference: Node<'uint'> = loadReference(page, referenceIndex);
  const curve = loadCurve(page, uintAdd(glyph.curveBaseTexel, curveReference));
  const namePrefix = axis === 'horizontal' ? 'slugHorizontal' : 'slugVertical';
  const contribution: Node<'vec3'> = curveContribution(
    axis === 'horizontal' ? slugHorizontalCurveContribution : slugVerticalCurveContribution,
    `${namePrefix}Contribution`,
    curve,
    renderCoordinate,
    pixelsPerEm,
    thickenFactor,
  );

  // The references of a band are sorted by descending ray-axis maximum, so the
  // first curve that cannot reach this fragment ends the band.
  If(lessThan(contribution.z, -0.5), () => {
    index.assign(curveCount);
  }).Else(() => {
    coverage.addAssign(contribution.x);
    weight.assign(max(weight, contribution.y));
    index.addAssign(1);
  });
}

export function evaluateBand(
  page: SlugShaderPage,
  glyph: SlugShaderGlyph,
  renderCoordinate: Node<'vec2'>,
  axis: 'horizontal' | 'vertical',
  pixelsPerEm: Node<'float'>,
  thickenFactor: Node<'float'>,
): SlugBandEvaluation {
  const namePrefix = axis === 'horizontal' ? 'slugHorizontal' : 'slugVertical';
  const coordinate: Node<'float'> = axis === 'horizontal' ? renderCoordinate.y : renderCoordinate.x;
  const transformScale: Node<'float'> = axis === 'horizontal' ? glyph.bandTransform.y : glyph.bandTransform.x;
  const transformOffset: Node<'float'> = axis === 'horizontal' ? glyph.bandTransform.w : glyph.bandTransform.z;
  const declaredBandCount: Node<'uint'> = axis === 'horizontal' ? glyph.horizontalBandCount : glyph.verticalBandCount;
  const headerBase: Node<'uint'> = axis === 'horizontal' ? glyph.horizontalHeaderBase : glyph.verticalHeaderBase;
  const bandIndex: Node<'uint'> = coreValue('uint', `${namePrefix}BandIndex`, () => {
    'use gpu';
    return slugBandIndex(
      t3.fromTSL(coordinate, d.f32).$,
      t3.fromTSL(transformScale, d.f32).$,
      t3.fromTSL(transformOffset, d.f32).$,
      t3.fromTSL(declaredBandCount, d.u32).$,
    );
  });
  const header: Node<'uint'> = loadHeader(page, uintAdd(headerBase, bandIndex), axis);
  const localReferenceOffset: Node<'uint'> = coreValue('uint', `${namePrefix}ReferenceOffset`, () => {
    'use gpu';
    return slugBandReferenceOffset(t3.fromTSL(header, d.u32).$);
  });
  const curveCount: Node<'int'> = int(
    coreValue('uint', `${namePrefix}CurveCount`, () => {
      'use gpu';
      return slugBandCurveCount(t3.fromTSL(header, d.u32).$);
    }),
  );
  const coverage: Node<'float'> = float(0).toVar(axis === 'horizontal' ? 'slugXCoverage' : 'slugYCoverage');
  const weight: Node<'float'> = float(0).toVar(axis === 'horizontal' ? 'slugXWeight' : 'slugYWeight');
  const curveIndex: Node<'int'> = int(0).toVar(`${namePrefix}CurveIndex`);
  whileLoop(intLessThan(curveIndex, curveCount), () =>
    evaluateBandCurve(
      curveIndex,
      curveCount,
      page,
      glyph,
      renderCoordinate,
      axis,
      pixelsPerEm,
      thickenFactor,
      localReferenceOffset,
      coverage,
      weight,
    ),
  );

  return { coverage, weight };
}
