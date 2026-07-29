/**
 * CPU reference math adapted from three-flatland Slug at 2935a89f
 * (MIT). It is independent of TSL and GPU texture behavior.
 */

export interface DecodedSlugHeader {
  readonly curveCount: number
  readonly glyphRelativeReferenceOffset: number
}

export interface SlugDilationResult {
  readonly position: readonly [number, number]
  readonly textureCoordinate: readonly [number, number]
}

export interface SlugQuadraticDistanceResult {
  readonly distance: number
  readonly t: number
}

export interface SlugReferenceCurve {
  readonly p0: readonly [number, number]
  readonly p1: readonly [number, number]
  readonly p2: readonly [number, number]
}

/** Decode PMNDRS_font_slug V0's exact `(count << 16) | offset` header. */
export function decodeSlugHeader(header: number): DecodedSlugHeader {
  const unsignedHeader = header >>> 0
  return {
    curveCount: unsignedHeader >>> 16,
    glyphRelativeReferenceOffset: unsignedHeader & 0xffff,
  }
}

/** Map a nonnegative logical texel index into its declared upload grid. */
export function slugGridCoordinate(index: number, width: number): readonly [number, number] {
  if (!Number.isSafeInteger(index) || index < 0) {
    throw new RangeError('Slug grid index must be a nonnegative safe integer')
  }
  if (!Number.isSafeInteger(width) || width <= 0) {
    throw new RangeError('Slug grid width must be a positive safe integer')
  }
  return [index % width, Math.floor(index / width)]
}

/** Resolve a V0 glyph-local u16 curve reference to its absolute page texel. */
export function resolveSlugCurveTexel(curveBaseTexel: number, localReference: number): number {
  if (!Number.isSafeInteger(curveBaseTexel) || curveBaseTexel < 0) {
    throw new RangeError('Slug curve base must be a nonnegative safe integer')
  }
  if (!Number.isInteger(localReference) || localReference < 0 || localReference > 0xffff) {
    throw new RangeError('Slug curve reference must be an unsigned 16-bit integer')
  }
  const result = curveBaseTexel + localReference
  if (!Number.isSafeInteger(result))
    throw new RangeError('Slug curve address exceeds safe integer range')
  return result
}

/** CPU authority for the fill band's capped, sorted-reference early termination. */
export function referenceSlugBandTraversal(
  curveMaximums: readonly number[],
  declaredCurveCount: number = curveMaximums.length,
): readonly number[] {
  if (!Number.isSafeInteger(declaredCurveCount) || declaredCurveCount < 0) {
    throw new RangeError('Slug band curve count must be a nonnegative safe integer')
  }
  if (!curveMaximums.every(Number.isFinite)) {
    throw new TypeError('Slug band curve maxima must be finite')
  }
  const visited: number[] = []
  const curveCount = Math.min(declaredCurveCount, curveMaximums.length, 512)
  for (let index = 0; index < curveCount; index += 1) {
    visited.push(index)
    if (curveMaximums[index]! < -0.5) break
  }
  return visited
}

export function referenceRootCode(y1: number, y2: number, y3: number): number {
  const s1 = y1 < 0 ? 1 : 0
  const s2 = y2 < 0 ? 1 : 0
  const s3 = y3 < 0 ? 1 : 0
  const shift = s1 | (s2 << 1) | (s3 << 2)
  return (0x2e74 >>> shift) & 0x0101
}

/** CPU mirror of the shader's stable q-form root solver. */
function stableRoots(a: number, b: number, c: number): readonly [number, number] {
  const discriminant = b * b - a * c
  if (Math.abs(a) < 1 / 65_536) {
    const root = c / (2 * b)
    return [root, root]
  }
  if (discriminant <= 0) {
    const root = b / a
    return [root, root]
  }

  const distance = Math.sqrt(discriminant)
  const q = b + (b >= 0 ? distance : -distance)
  const rootA = q / a
  const rootB = c / q
  return b >= 0 ? [rootB, rootA] : [rootA, rootB]
}

export function referenceHorizontalIntersections(
  p0x: number,
  p0y: number,
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
): readonly [number, number] {
  const a = p0y - 2 * p1y + p2y
  const b = p0y - p1y
  const [t1, t2] = stableRoots(a, b, p0y)
  const ax = p0x - 2 * p1x + p2x
  const bx = p0x - p1x
  return [(ax * t1 - bx * 2) * t1 + p0x, (ax * t2 - bx * 2) * t2 + p0x]
}

export function referenceVerticalIntersections(
  p0x: number,
  p0y: number,
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
): readonly [number, number] {
  const a = p0x - 2 * p1x + p2x
  const b = p0x - p1x
  const [t1, t2] = stableRoots(a, b, p0x)
  const ay = p0y - 2 * p1y + p2y
  const by = p0y - p1y
  return [(ay * t1 - by * 2) * t1 + p0y, (ay * t2 - by * 2) * t2 + p0y]
}

export function referenceCoverage(
  xCoverage: number,
  xWeight: number,
  yCoverage: number,
  yWeight: number,
  evenOdd = false,
  weightBoost = false,
  stemDarken = 0,
  pixelsPerEm: number = Number.POSITIVE_INFINITY,
): number {
  const weighted =
    Math.abs(xCoverage * xWeight + yCoverage * yWeight) / Math.max(xWeight + yWeight, 1 / 65_536)
  const fallback = Math.min(Math.abs(xCoverage), Math.abs(yCoverage))
  const rawCoverage = Math.max(weighted, fallback)
  let coverage = evenOdd
    ? 1 - Math.abs(1 - (rawCoverage * 0.5 - Math.floor(rawCoverage * 0.5)) * 2)
    : Math.min(Math.max(rawCoverage, 0), 1)
  if (weightBoost) coverage = Math.sqrt(coverage)
  if (stemDarken > 0 && Number.isFinite(pixelsPerEm)) {
    const darken = stemDarken * Math.max(0, 1 - pixelsPerEm / 24)
    coverage = Math.min(coverage + darken * coverage * (1 - coverage), 1)
  }
  return coverage
}

/**
 * Independent three-seed closest-point authority copied from the reviewed
 * three-flatland stroke reference. The shipping TSL candidate deliberately
 * uses fewer seeds and must be checked against this stronger calculation.
 */
export function referenceDistanceToQuadratic(
  point: readonly [number, number],
  curve: SlugReferenceCurve,
): SlugQuadraticDistanceResult {
  const ax = curve.p2[0] - 2 * curve.p1[0] + curve.p0[0]
  const ay = curve.p2[1] - 2 * curve.p1[1] + curve.p0[1]
  const dx = curve.p1[0] - curve.p0[0]
  const dy = curve.p1[1] - curve.p0[1]
  const mx = curve.p0[0] - point[0]
  const my = curve.p0[1] - point[1]
  const c3 = ax * ax + ay * ay
  const c2 = 3 * (ax * dx + ay * dy)
  const c1 = 2 * (dx * dx + dy * dy) + mx * ax + my * ay
  const c0 = mx * dx + my * dy

  if (c3 < 1e-12 && dx * dx + dy * dy < 1e-12) {
    return { distance: Math.hypot(mx, my), t: 0 }
  }

  const evaluate = (t: number): number => ((c3 * t + c2) * t + c1) * t + c0
  const derivative = (t: number): number => (3 * c3 * t + 2 * c2) * t + c1
  const refine = (seed: number): number => {
    let t = seed
    for (let iteration = 0; iteration < 3; iteration += 1) {
      const slope = derivative(t)
      if (Math.abs(slope) < 1e-12) break
      t = Math.min(1, Math.max(0, t - evaluate(t) / slope))
    }
    return t
  }

  let bestT = 0
  let bestDistanceSquared = Number.POSITIVE_INFINITY
  for (const t of [0, 1, refine(0), refine(0.5), refine(1)]) {
    const complement = 1 - t
    const x =
      complement * complement * curve.p0[0] + 2 * complement * t * curve.p1[0] + t * t * curve.p2[0]
    const y =
      complement * complement * curve.p0[1] + 2 * complement * t * curve.p1[1] + t * t * curve.p2[1]
    const offsetX = x - point[0]
    const offsetY = y - point[1]
    const distanceSquared = offsetX * offsetX + offsetY * offsetY
    if (distanceSquared < bestDistanceSquared) {
      bestDistanceSquared = distanceSquared
      bestT = t
    }
  }
  return { distance: Math.sqrt(bestDistanceSquared), t: bestT }
}

/** CPU authority for the copied Slug hairline and antialiasing policy. */
export function referenceSlugStrokeCoverage(
  curves: readonly SlugReferenceCurve[],
  point: readonly [number, number],
  halfWidth: number,
  emsPerPixel: number,
): number {
  const antialiasHalfWidth = emsPerPixel * 0.5
  const effectiveHalfWidth = Math.max(halfWidth, antialiasHalfWidth)
  let minimumDistance = Number.POSITIVE_INFINITY
  for (const curve of curves) {
    minimumDistance = Math.min(minimumDistance, referenceDistanceToQuadratic(point, curve).distance)
  }
  const lower = effectiveHalfWidth - antialiasHalfWidth
  const upper = effectiveHalfWidth + antialiasHalfWidth
  if (minimumDistance <= lower) return 1
  if (minimumDistance >= upper) return 0
  const t = (minimumDistance - lower) / (upper - lower)
  return 1 - t * t * (3 - 2 * t)
}

/** Half-open band interval required to cover a stroke's complete AA support. */
export function referenceSlugStrokeBandRange(
  coordinate: number,
  searchRadius: number,
  transformScale: number,
  transformOffset: number,
  bandCount: number,
): readonly [number, number] {
  if (![coordinate, searchRadius, transformScale, transformOffset].every(Number.isFinite)) {
    throw new TypeError('Slug stroke band inputs must be finite')
  }
  if (searchRadius < 0 || transformScale <= 0) {
    throw new RangeError('Slug stroke band radius and scale must be nonnegative and positive')
  }
  if (!Number.isSafeInteger(bandCount) || bandCount <= 0) {
    throw new RangeError('Slug stroke band count must be a positive safe integer')
  }
  const clampIndex = (value: number): number =>
    Math.min(bandCount - 1, Math.max(0, Math.floor(value * transformScale + transformOffset)))
  return [clampIndex(coordinate - searchRadius), clampIndex(coordinate + searchRadius) + 1]
}

export function referenceSlugDilate(
  position: readonly [number, number],
  outwardNormal: readonly [number, number],
  textureCoordinate: readonly [number, number],
  inverseScale: number,
  mvpRow0: readonly [number, number, number, number],
  mvpRow1: readonly [number, number, number, number],
  mvpRow3: readonly [number, number, number, number],
  viewport: readonly [number, number],
): SlugDilationResult {
  const normalLength = Math.hypot(outwardNormal[0], outwardNormal[1])
  if (normalLength === 0) return { position, textureCoordinate }
  const nx = outwardNormal[0] / normalLength
  const ny = outwardNormal[1] / normalLength
  const homogeneousW = mvpRow3[0] * position[0] + mvpRow3[1] * position[1] + mvpRow3[3]
  const wGradient = mvpRow3[0] * nx + mvpRow3[1] * ny
  const projectedX =
    (homogeneousW * (mvpRow0[0] * nx + mvpRow0[1] * ny) -
      wGradient * (mvpRow0[0] * position[0] + mvpRow0[1] * position[1] + mvpRow0[3])) *
    viewport[0]
  const projectedY =
    (homogeneousW * (mvpRow1[0] * nx + mvpRow1[1] * ny) -
      wGradient * (mvpRow1[0] * position[0] + mvpRow1[1] * position[1] + mvpRow1[3])) *
    viewport[1]
  const squaredW = homogeneousW * homogeneousW
  const wTimesGradient = homogeneousW * wGradient
  const projectedLengthSquared = projectedX * projectedX + projectedY * projectedY
  const denominator = projectedLengthSquared - squaredW * wGradient * wGradient
  const distance =
    denominator === 0
      ? 0
      : (squaredW * (wTimesGradient + Math.sqrt(projectedLengthSquared))) / denominator
  const dx = nx * distance
  const dy = ny * distance
  return {
    position: [position[0] + dx, position[1] + dy],
    textureCoordinate: [
      textureCoordinate[0] + dx * inverseScale,
      textureCoordinate[1] + dy * inverseScale,
    ],
  }
}
