/**
 * Copied from three-flatland Slug at 2935a89f (MIT). Coverage and the
 * one-band-per-axis performance policy are retained; addressing is adapted to
 * PMNDRS_font_slug V0's R32UI headers and pair-packed R16 reference grid.
 */
import type { Node } from 'three/webgpu'
import { If, float } from 'three/tsl'
import { distanceToQuadBezier } from './distance-to-quad-bezier.js'
import type { SlugShaderGlyph } from './slug-band.js'
import {
  bandCount,
  bandReferenceOffset,
  loadCurve,
  loadHeader,
  loadReference,
  type SlugShaderPage,
} from './slug-texture.js'
import {
  floatAdd,
  floatClamp,
  floatFromUint,
  floatLessThanEqual,
  floatMax,
  floatMin,
  floatMul,
  floatSmoothstep,
  floatSub,
  intFromFloat,
  intFromUint,
  intLoop,
  uintAdd,
  uintFromInt,
  vec2Fwidth,
} from './tsl-compat.js'

function evaluateStrokeBand(
  page: SlugShaderPage,
  glyph: SlugShaderGlyph,
  renderCoordinate: Node<'vec2'>,
  axis: 'horizontal' | 'vertical',
  minimumDistance: Node<'float'>,
  searchRadius: Node<'float'>,
): void {
  const coordinate = axis === 'horizontal' ? renderCoordinate.y : renderCoordinate.x
  const transformScale = axis === 'horizontal' ? glyph.bandTransform.y : glyph.bandTransform.x
  const transformOffset = axis === 'horizontal' ? glyph.bandTransform.w : glyph.bandTransform.z
  const declaredBandCount =
    axis === 'horizontal' ? glyph.horizontalBandCount : glyph.verticalBandCount
  const headerBase = axis === 'horizontal' ? glyph.horizontalHeaderBase : glyph.verticalHeaderBase
  const namePrefix = axis === 'horizontal' ? 'slugStrokeHorizontal' : 'slugStrokeVertical'
  const maximumBandIndex = floatSub(floatFromUint(declaredBandCount), float(1))
  const firstBandIndex = intFromFloat(
    floatClamp(
      floatAdd(floatMul(floatSub(coordinate, searchRadius), transformScale), transformOffset),
      float(0),
      maximumBandIndex,
    ),
  )
  const lastBandIndex = floatClamp(
    floatAdd(floatMul(floatAdd(coordinate, searchRadius), transformScale), transformOffset),
    float(0),
    maximumBandIndex,
  )
  const bandEnd = intFromFloat(floatAdd(lastBandIndex, float(1)))
  intLoop({ start: firstBandIndex, end: bandEnd, type: 'int' }, ({ i: bandIndex }) => {
    const header = loadHeader(page, uintAdd(headerBase, uintFromInt(bandIndex)), axis, namePrefix)
    const localReferenceOffset = bandReferenceOffset(header)
    const curveCount = intFromUint(bandCount(header))
    intLoop({ start: 0, end: curveCount, type: 'int' }, ({ i: curveIndex }) => {
      const referenceIndex = uintAdd(
        uintAdd(glyph.referenceBase, localReferenceOffset),
        uintFromInt(curveIndex),
      )
      const curveReference = loadReference(page, referenceIndex, axis, namePrefix)
      const curve = loadCurve(page, uintAdd(glyph.curveBaseTexel, curveReference))
      const accumulateDistance = (): void => {
        const result = distanceToQuadBezier(
          renderCoordinate,
          curve.p0,
          curve.p1,
          curve.p2,
          namePrefix,
        )
        minimumDistance.assign(floatMin(minimumDistance, result.x))
      }
      if (axis === 'horizontal') {
        accumulateDistance()
      } else {
        const minimumY = floatMin(floatMin(curve.p0.y, curve.p1.y), curve.p2.y)
        const maximumY = floatMax(floatMax(curve.p0.y, curve.p1.y), curve.p2.y)
        If(floatLessThanEqual(floatSub(maximumY, minimumY), float(1e-10)), accumulateDistance)
      }
    })
  })
}

/** Evaluate centered analytic stroke coverage for one Slug fragment. */
export function slugStroke(
  page: SlugShaderPage,
  glyph: SlugShaderGlyph,
  renderCoordinate: Node<'vec2'>,
  strokeHalfWidth: Node<'float'>,
): Node<'float'> {
  const emsPerPixel = vec2Fwidth(renderCoordinate).toVar('slugStrokeEmsPerPixel')
  const pixelEm = floatMax(emsPerPixel.x, emsPerPixel.y).toVar('slugStrokePixelEm')
  const antialiasHalfWidth = floatMul(pixelEm, float(0.5)).toVar('slugStrokeAaHalfWidth')
  const effectiveHalfWidth = floatMax(strokeHalfWidth, antialiasHalfWidth).toVar(
    'slugStrokeEffectiveHalfWidth',
  )
  const searchRadius = floatAdd(effectiveHalfWidth, antialiasHalfWidth).toVar(
    'slugStrokeSearchRadius',
  )
  const minimumDistance = float(1).toVar('slugStrokeMinimumDistance')
  evaluateStrokeBand(page, glyph, renderCoordinate, 'horizontal', minimumDistance, searchRadius)
  evaluateStrokeBand(page, glyph, renderCoordinate, 'vertical', minimumDistance, searchRadius)
  const lower = floatSub(effectiveHalfWidth, antialiasHalfWidth)
  const upper = floatAdd(effectiveHalfWidth, antialiasHalfWidth)
  return floatSub(float(1), floatSmoothstep(lower, upper, minimumDistance))
}
