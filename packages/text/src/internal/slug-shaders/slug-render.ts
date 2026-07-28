/**
 * Adapted from three-flatland Slug at 2935a89f (MIT).
 * The texture addressing is adapted to PMNDRS_font_slug V0's exact R32UI
 * header grid and R16UI glyph-local reference grid.
 */
import type { DataTexture, Node } from 'three/webgpu'
import {
  Break,
  If,
  Loop,
  abs,
  add,
  clamp,
  div,
  float,
  int,
  ivec2,
  greaterThan,
  lessThan,
  max,
  min,
  mul,
  saturate,
  select,
  sub,
  textureLoad,
  uint,
  vec2,
} from 'three/tsl'
import { calcCoverage } from './calc-coverage.js'
import { calcRootCode } from './calc-root-code.js'
import { solveHorizontalPolynomial, solveVerticalPolynomial } from './solve-quadratic.js'

const HEADER_REFERENCE_MASK = 0xffff
const HEADER_COUNT_SHIFT = 16

/**
 * A hostile artifact cannot turn one fragment into an unbounded GPU workload.
 * Valid bakers reject u16 overflow, while the runtime cap remains deliberately
 * above expected dense CJK bands.
 */
export const MAX_SAFE_SLUG_BAND_CURVES = 512

export interface SlugShaderPage {
  readonly curveTexture: DataTexture
  readonly curveWidth: number
  readonly headerTexture: DataTexture
  readonly headerWidth: number
  readonly referenceTexture: DataTexture
  readonly referenceWidth: number
}

export interface SlugShaderGlyph {
  readonly curveBaseTexel: Node<'uint'>
  readonly horizontalHeaderBase: Node<'uint'>
  readonly verticalHeaderBase: Node<'uint'>
  readonly referenceBase: Node<'uint'>
  readonly horizontalBandCount: Node<'uint'>
  readonly verticalBandCount: Node<'uint'>
  readonly bandTransform: Node<'vec4'>
}

export interface SlugRenderOptions {
  readonly evenOdd: Node<'bool'>
  readonly weightBoost: Node<'bool'>
  readonly stemDarken?: Node<'float'>
  readonly thicken?: Node<'float'>
}

interface SlugShaderCurve {
  readonly p0: Node<'vec2'>
  readonly p1: Node<'vec2'>
  readonly p2: Node<'vec2'>
}

interface SlugBandEvaluation {
  readonly coverage: Node<'float'>
  readonly weight: Node<'float'>
}

function gridCoordinate(index: Node<'uint'>, width: number): Node<'ivec2'> {
  const integerIndex: Node<'int'> = int(index)
  const integerWidth: Node<'int'> = int(width)
  const column: Node<'int'> = integerIndex.mod(integerWidth)
  const row: Node<'int'> = integerIndex.div(integerWidth)
  return ivec2(column, row)
}

function loadHeader(
  page: SlugShaderPage,
  index: Node<'uint'>,
  axis: 'horizontal' | 'vertical',
): Node<'uint'> {
  const texel: Node<'vec4'> = loadTextureTexel(
    page.headerTexture,
    gridCoordinate(index, page.headerWidth),
  )
  return namedUint(
    uint(texel.x),
    axis === 'horizontal' ? 'slugHorizontalHeader' : 'slugVerticalHeader',
  )
}

function loadReference(
  page: SlugShaderPage,
  index: Node<'uint'>,
  axis: 'horizontal' | 'vertical',
): Node<'uint'> {
  const texel: Node<'uvec4'> = loadUnsignedTextureTexel(
    page.referenceTexture,
    gridCoordinate(index.shiftRight(uint(1)), page.referenceWidth),
  )
  const bitOffset = index.bitAnd(uint(1)).mul(uint(16))
  return namedUint(
    texel.x.shiftRight(bitOffset).bitAnd(uint(HEADER_REFERENCE_MASK)),
    axis === 'horizontal' ? 'slugHorizontalReference' : 'slugVerticalReference',
  )
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

function loadTextureTexel(texture: DataTexture, coordinate: Node<'ivec2'>): Node<'vec4'> {
  return textureLoad(texture, coordinate)
}

function loadUnsignedTextureTexel(texture: DataTexture, coordinate: Node<'ivec2'>): Node<'uvec4'> {
  return textureLoad(texture, coordinate)
}

function loadCurve(page: SlugShaderPage, texelIndex: Node<'uint'>): SlugShaderCurve {
  const first: Node<'vec4'> = loadTextureTexel(
    page.curveTexture,
    gridCoordinate(texelIndex, page.curveWidth),
  )
  const second: Node<'vec4'> = loadTextureTexel(
    page.curveTexture,
    gridCoordinate(texelIndex.add(uint(1)), page.curveWidth),
  )
  return {
    p0: vec2(first.x, first.y),
    p1: vec2(first.z, first.w),
    p2: vec2(second.x, second.y),
  }
}

function bandCount(header: Node<'uint'>): Node<'uint'> {
  return uint(min(float(header.shiftRight(uint(HEADER_COUNT_SHIFT))), MAX_SAFE_SLUG_BAND_CURVES))
}

function bandReferenceOffset(header: Node<'uint'>): Node<'uint'> {
  return header.bitAnd(uint(HEADER_REFERENCE_MASK))
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
      greaterThan(float(rootCode.bitAnd(uint(1))), 0),
      `${namePrefix}HasRoot1`,
    )
    const hasSecondRoot: Node<'bool'> = namedBool(
      greaterThan(float(rootCode.bitAnd(uint(0x100))), 0),
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
  const referenceIndex: Node<'uint'> = glyph.referenceBase
    .add(localReferenceOffset)
    .add(uint(index))
  const curveReference: Node<'uint'> = loadReference(page, referenceIndex, axis)
  const curveTexel: Node<'uint'> = glyph.curveBaseTexel.add(curveReference)
  const curve = loadCurve(page, curveTexel)
  const namePrefix = axis === 'horizontal' ? 'slugHorizontal' : 'slugVertical'
  const p0: Node<'vec2'> = namedVec2(curve.p0.sub(renderCoordinate), `${namePrefix}P0`)
  const p1: Node<'vec2'> = namedVec2(curve.p1.sub(renderCoordinate), `${namePrefix}P1`)
  const p2: Node<'vec2'> = namedVec2(curve.p2.sub(renderCoordinate), `${namePrefix}P2`)
  const maximum0: Node<'float'> = axis === 'horizontal' ? p0.x : p0.y
  const maximum1: Node<'float'> = axis === 'horizontal' ? p1.x : p1.y
  const maximum2: Node<'float'> = axis === 'horizontal' ? p2.x : p2.y
  const maximum: Node<'float'> = mul(max(max(maximum0, maximum1), maximum2), pixelsPerEm)
  If(lessThan(maximum, -0.5), () => Break())
  accumulateCurveRoots(p0, p1, p2, axis, pixelsPerEm, thickenFactor, coverage, weight)
}

function evaluateBand(
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
  const header: Node<'uint'> = loadHeader(page, headerBase.add(bandIndex), axis)
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
  Loop({ start: 0, end: curveCount, type: 'int' }, ({ i }) =>
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

/** Evaluate analytic Slug fill coverage for one fragment. */
export function slugRender(
  page: SlugShaderPage,
  glyph: SlugShaderGlyph,
  renderCoordinate: Node<'vec2'>,
  options: SlugRenderOptions,
): Node<'float'> {
  // These derivatives and reciprocal footprints are loop-invariant. Explicit
  // variables prevent TSL from re-emitting them once per candidate curve.
  const emsPerPixel: Node<'vec2'> = namedVec2(renderCoordinate.fwidth(), 'slugEmsPerPixel')
  const minimumFootprintX: Node<'float'> = max(emsPerPixel.x, 1 / 65_536)
  const minimumFootprintY: Node<'float'> = max(emsPerPixel.y, 1 / 65_536)
  const pixelsPerEmX: Node<'float'> = namedFloat(div(1, minimumFootprintX), 'slugPixelsPerEmX')
  const pixelsPerEmY: Node<'float'> = namedFloat(div(1, minimumFootprintY), 'slugPixelsPerEmY')
  const pixelsPerEmSum: Node<'float'> = add(pixelsPerEmX, pixelsPerEmY)
  const pixelsPerEm: Node<'float'> = namedFloat(mul(pixelsPerEmSum, 0.5), 'slugPixelsPerEm')
  const thickenFactor: Node<'float'> =
    options.thicken === undefined
      ? float(1)
      : namedFloat(
          add(1, mul(options.thicken, max(0, sub(1, div(pixelsPerEm, 24))))),
          'slugThickenFactor',
        )

  const horizontal = evaluateBand(
    page,
    glyph,
    renderCoordinate,
    'horizontal',
    pixelsPerEmX,
    thickenFactor,
  )
  const vertical = evaluateBand(
    page,
    glyph,
    renderCoordinate,
    'vertical',
    pixelsPerEmY,
    thickenFactor,
  )

  return calcCoverage(
    horizontal.coverage,
    horizontal.weight,
    vertical.coverage,
    vertical.weight,
    options.evenOdd,
    options.weightBoost,
    options.stemDarken,
    pixelsPerEm,
  )
}
