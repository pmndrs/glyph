/**
 * Adapted from three-flatland Slug at 2935a89f (MIT).
 * The texture addressing is adapted to PMNDRS_font_slug V0's exact R32UI
 * header grid and R16UI glyph-local reference grid.
 */
import type { Node } from 'three/webgpu'
import {
  Break,
  If,
  abs,
  add,
  clamp,
  float,
  int,
  greaterThan,
  lessThan,
  max,
  mul,
  saturate,
  select,
  sub,
  uint,
} from 'three/tsl'
import { calcRootCode } from './calc-root-code.js'
import { solveHorizontalPolynomial, solveVerticalPolynomial } from './solve-quadratic.js'
import {
  bandCount,
  bandReferenceOffset,
  loadCurve,
  loadHeader,
  loadReference,
  type SlugShaderPage,
} from './slug-texture.js'
import { intLoop, uintAdd, uintBitAnd, vec2Sub } from './tsl-compat.js'

export interface SlugShaderGlyph {
  readonly curveBaseTexel: Node<'uint'>
  readonly horizontalHeaderBase: Node<'uint'>
  readonly verticalHeaderBase: Node<'uint'>
  readonly referenceBase: Node<'uint'>
  readonly horizontalBandCount: Node<'uint'>
  readonly verticalBandCount: Node<'uint'>
  readonly bandTransform: Node<'vec4'>
}

interface SlugBandEvaluation {
  readonly coverage: Node<'float'>
  readonly weight: Node<'float'>
}

function namedBool(node: Node<'bool'>, name: string): Node<'bool'> {
  return node.toVar(name)
}

function namedFloat(node: Node<'float'>, name: string): Node<'float'> {
  return node.toVar(name)
}

function namedUint(node: Node<'uint'>, name: string): Node<'uint'> {
  return node.toVar(name)
}

function namedVec2(node: Node<'vec2'>, name: string): Node<'vec2'> {
  return node.toVar(name)
}

function accumulateCurveRoots(
  p0: Node<'vec2'>,
  p1: Node<'vec2'>,
  p2: Node<'vec2'>,
  axis: 'horizontal' | 'vertical',
  pixelsPerEm: Node<'float'>,
  thickenFactor: Node<'float'>,
  coverage: Node<'float'>,
  weight: Node<'float'>,
): void {
  const namePrefix = axis === 'horizontal' ? 'slugHorizontal' : 'slugVertical'
  const polynomial0: Node<'float'> = axis === 'horizontal' ? p0.y : p0.x
  const polynomial1: Node<'float'> = axis === 'horizontal' ? p1.y : p1.x
  const polynomial2: Node<'float'> = axis === 'horizontal' ? p2.y : p2.x
  const rootCode: Node<'uint'> = namedUint(
    calcRootCode(polynomial0, polynomial1, polynomial2),
    `${namePrefix}RootCode`,
  )
  If(greaterThan(float(rootCode), 0), () => {
    const roots =
      axis === 'horizontal'
        ? solveHorizontalPolynomial(p0, p1, p2)
        : solveVerticalPolynomial(p0, p1, p2)
    const firstRoot: Node<'float'> = namedFloat(mul(roots.x, pixelsPerEm), `${namePrefix}Root1`)
    const secondRoot: Node<'float'> = namedFloat(mul(roots.y, pixelsPerEm), `${namePrefix}Root2`)
    const hasFirstRoot: Node<'bool'> = namedBool(
      greaterThan(float(uintBitAnd(rootCode, uint(1))), 0),
      `${namePrefix}HasRoot1`,
    )
    const hasSecondRoot: Node<'bool'> = namedBool(
      greaterThan(float(uintBitAnd(rootCode, uint(0x100))), 0),
      `${namePrefix}HasRoot2`,
    )
    const firstContribution: Node<'float'> = select(
      hasFirstRoot,
      saturate(add(mul(firstRoot, thickenFactor), 0.5)),
      0,
    )
    const secondContribution: Node<'float'> = select(
      hasSecondRoot,
      saturate(add(mul(secondRoot, thickenFactor), 0.5)),
      0,
    )
    const coverageDelta: Node<'float'> =
      axis === 'horizontal'
        ? sub(firstContribution, secondContribution)
        : sub(secondContribution, firstContribution)
    coverage.addAssign(coverageDelta)
    const firstWeight: Node<'float'> = saturate(sub(1, mul(abs(firstRoot), 2)))
    const secondWeight: Node<'float'> = saturate(sub(1, mul(abs(secondRoot), 2)))
    const curveWeight: Node<'float'> = max(
      select(hasFirstRoot, firstWeight, 0),
      select(hasSecondRoot, secondWeight, 0),
    )
    weight.assign(max(weight, curveWeight))
  })
}

function evaluateBandCurve(
  index: Node<'int'>,
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
  const referenceIndex: Node<'uint'> = uintAdd(
    uintAdd(glyph.referenceBase, localReferenceOffset),
    uint(index),
  )
  const curveReference: Node<'uint'> = loadReference(page, referenceIndex, axis)
  const curveTexel: Node<'uint'> = uintAdd(glyph.curveBaseTexel, curveReference)
  const curve = loadCurve(page, curveTexel)
  const namePrefix = axis === 'horizontal' ? 'slugHorizontal' : 'slugVertical'
  const p0: Node<'vec2'> = namedVec2(vec2Sub(curve.p0, renderCoordinate), `${namePrefix}P0`)
  const p1: Node<'vec2'> = namedVec2(vec2Sub(curve.p1, renderCoordinate), `${namePrefix}P1`)
  const p2: Node<'vec2'> = namedVec2(vec2Sub(curve.p2, renderCoordinate), `${namePrefix}P2`)
  const maximum0: Node<'float'> = axis === 'horizontal' ? p0.x : p0.y
  const maximum1: Node<'float'> = axis === 'horizontal' ? p1.x : p1.y
  const maximum2: Node<'float'> = axis === 'horizontal' ? p2.x : p2.y
  const maximum: Node<'float'> = mul(max(max(maximum0, maximum1), maximum2), pixelsPerEm)
  If(lessThan(maximum, -0.5), () => Break())
  accumulateCurveRoots(p0, p1, p2, axis, pixelsPerEm, thickenFactor, coverage, weight)
}

export function evaluateBand(
  page: SlugShaderPage,
  glyph: SlugShaderGlyph,
  renderCoordinate: Node<'vec2'>,
  axis: 'horizontal' | 'vertical',
  pixelsPerEm: Node<'float'>,
  thickenFactor: Node<'float'>,
): SlugBandEvaluation {
  const coordinate: Node<'float'> = axis === 'horizontal' ? renderCoordinate.y : renderCoordinate.x
  const transformScale: Node<'float'> =
    axis === 'horizontal' ? glyph.bandTransform.y : glyph.bandTransform.x
  const transformOffset: Node<'float'> =
    axis === 'horizontal' ? glyph.bandTransform.w : glyph.bandTransform.z
  const declaredBandCount: Node<'uint'> =
    axis === 'horizontal' ? glyph.horizontalBandCount : glyph.verticalBandCount
  const headerBase: Node<'uint'> =
    axis === 'horizontal' ? glyph.horizontalHeaderBase : glyph.verticalHeaderBase
  const scaledCoordinate: Node<'float'> = mul(coordinate, transformScale)
  const transformedCoordinate: Node<'float'> = add(scaledCoordinate, transformOffset)
  const maximumBandIndex: Node<'float'> = sub(float(declaredBandCount), 1)
  const clampedBandIndex: Node<'float'> = clamp(transformedCoordinate, 0, maximumBandIndex)
  const bandIndex: Node<'uint'> = uint(clampedBandIndex)
  const header: Node<'uint'> = loadHeader(page, uintAdd(headerBase, bandIndex), axis)
  const localReferenceOffset: Node<'uint'> = namedUint(
    bandReferenceOffset(header),
    axis === 'horizontal' ? 'slugHorizontalReferenceOffset' : 'slugVerticalReferenceOffset',
  )
  const coverage: Node<'float'> = namedFloat(
    float(0),
    axis === 'horizontal' ? 'slugXCoverage' : 'slugYCoverage',
  )
  const weight: Node<'float'> = namedFloat(
    float(0),
    axis === 'horizontal' ? 'slugXWeight' : 'slugYWeight',
  )
  const curveCount: Node<'int'> = int(bandCount(header))
  intLoop({ start: 0, end: curveCount, type: 'int' }, ({ i }) =>
    evaluateBandCurve(
      i,
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
  )

  return { coverage, weight }
}
