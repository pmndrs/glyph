/**
 * CPU reference math for the Slug technique, independent of TypeGPU and GPU texture
 * behavior. Every function mirrors one exported shader function of
 * `slug-shader.js` operation for operation, so a simulation of the shipped TypeGPU
 * functions can be pinned to these values exactly.
 */

export type SlugVec2 = readonly [number, number];

/**
 * CPU mirror of `stableRoots`, including the branch order and the q-form reciprocal
 * structure of the emitted shader.
 */
export function referenceStableRoots(a: number, b: number, c: number): SlugVec2 {
  const discriminant = b * b - a * c;
  if (Math.abs(a) < 1 / 65_536) {
    const linearRoot = c / (b * 2);
    return [linearRoot, linearRoot];
  }
  if (discriminant <= 0) {
    const extremum = b / a;
    return [extremum, extremum];
  }
  const distance = Math.sqrt(discriminant);
  const sign = b >= 0 ? 1 : -1;
  const q = b + sign * distance;
  const rootA = q / a;
  const rootB = c / q;
  return b >= 0 ? [rootB, rootA] : [rootA, rootB];
}

/** CPU mirror of `solveHorizontalPolynomial`. */
export function referenceSolveHorizontalPolynomial(
  p0x: number,
  p0y: number,
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
): SlugVec2 {
  const roots = referenceStableRoots(p0y - p1y * 2 + p2y, p0y - p1y, p0y);
  const ax = p0x - p1x * 2 + p2x;
  const bx = p0x - p1x;
  return [(ax * roots[0] - bx * 2) * roots[0] + p0x, (ax * roots[1] - bx * 2) * roots[1] + p0x];
}

/** CPU mirror of `solveVerticalPolynomial`. */
export function referenceSolveVerticalPolynomial(
  p0x: number,
  p0y: number,
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
): SlugVec2 {
  const roots = referenceStableRoots(p0x - p1x * 2 + p2x, p0x - p1x, p0x);
  const ay = p0y - p1y * 2 + p2y;
  const by = p0y - p1y;
  return [(ay * roots[0] - by * 2) * roots[0] + p0y, (ay * roots[1] - by * 2) * roots[1] + p0y];
}

/** CPU mirror of `calcRootCode`. */
export function referenceCalcRootCode(y1: number, y2: number, y3: number): number {
  const s1 = y1 < 0 ? 1 : 0;
  const s2 = y2 < 0 ? 1 : 0;
  const s3 = y3 < 0 ? 1 : 0;
  const shift = s1 | (s2 << 1) | (s3 << 2);
  return (0x2e74 >>> shift) & 0x0101;
}

/** CPU mirror of `slugGridCoordinate`: the logical row-major texel address. */
export function referenceSlugGridCoordinate(index: number, width: number): SlugVec2 {
  return [index % width, Math.floor(index / width)];
}

/** CPU mirror of `loadSlugHeader` over one header word per logical texel. */
export function referenceLoadSlugHeader(headers: readonly number[], index: number): number {
  return headers[index]!;
}

/** CPU mirror of `loadSlugReference` over packed u16 reference pairs in u32 words. */
export function referenceLoadSlugReference(references: readonly number[], index: number): number {
  const pair = references[Math.floor(index / 2)]!;
  return (pair >>> ((index & 1) * 16)) & 0xffff;
}

/** CPU mirror of `slugBandCurveCount`: the capped high-half count. */
export function referenceSlugBandCurveCount(header: number): number {
  return Math.min(Math.fround(header >>> 16), 512);
}

/** CPU mirror of `calcSlugCoverage`, including the weighted blend's guard reciprocal. */
export function referenceCalcSlugCoverage(
  xCoverage: number,
  xWeight: number,
  yCoverage: number,
  yWeight: number,
  evenOdd = false,
  weightBoost = false,
): number {
  const weightedNumerator = Math.abs(xCoverage * xWeight + yCoverage * yWeight);
  const weighted = weightedNumerator / Math.max(xWeight + yWeight, 1 / 65_536);
  const fallback = Math.min(Math.abs(xCoverage), Math.abs(yCoverage));
  const rawCoverage = Math.max(weighted, fallback);
  const nonzeroCoverage = Math.min(Math.max(rawCoverage, 0), 1);
  const evenOddCoverage = 1 - Math.abs(1 - (rawCoverage * 0.5 - Math.floor(rawCoverage * 0.5)) * 2);
  const filledCoverage = evenOdd ? evenOddCoverage : nonzeroCoverage;
  return weightBoost ? Math.sqrt(filledCoverage) : filledCoverage;
}

/** CPU mirror of `slugThickenFactor`. */
export function referenceSlugThickenFactor(thicken: number, pixelsPerEm: number): number {
  return 1 + thicken * Math.max(0, 1 - pixelsPerEm / 24);
}

/** CPU mirror of `slugStemDarken`. */
export function referenceSlugStemDarken(coverage: number, darken: number): number {
  return Math.min(coverage + darken * coverage * (1 - coverage), 1);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

/** Shared dilation body behind both projection variants. */
function dilateFromProjection(
  position: SlugVec2,
  normal: SlugVec2,
  textureCoordinate: SlugVec2,
  inverseScale: number,
  homogeneousW: number,
  wGradient: number,
  projectedXValue: number,
  projectedYValue: number,
  viewport: SlugVec2,
): { position: SlugVec2; textureCoordinate: SlugVec2 } {
  const projectedX = projectedXValue * viewport[0];
  const projectedY = projectedYValue * viewport[1];
  const squaredW = homogeneousW * homogeneousW;
  const wTimesGradient = homogeneousW * wGradient;
  const projectedLengthSquared = projectedX * projectedX + projectedY * projectedY;
  const denominator = projectedLengthSquared - squaredW * wGradient * wGradient;
  const distance = (squaredW * (wTimesGradient + Math.sqrt(projectedLengthSquared))) / denominator;
  const dx = normal[0] * distance;
  const dy = normal[1] * distance;
  return {
    position: [position[0] + dx, position[1] + dy],
    textureCoordinate: [textureCoordinate[0] + dx * inverseScale, textureCoordinate[1] + dy * inverseScale],
  };
}

/** CPU mirror of `slugDilate` over the projection's three significant rows. */
export function referenceSlugDilate(
  position: SlugVec2,
  outwardNormal: SlugVec2,
  textureCoordinate: SlugVec2,
  inverseScale: number,
  mvpRow0: readonly [number, number, number, number],
  mvpRow1: readonly [number, number, number, number],
  mvpRow3: readonly [number, number, number, number],
  viewport: SlugVec2,
): { position: SlugVec2; textureCoordinate: SlugVec2 } {
  const normalLength = Math.hypot(outwardNormal[0], outwardNormal[1]);
  const normal: SlugVec2 = [outwardNormal[0] / normalLength, outwardNormal[1] / normalLength];
  const homogeneousW = mvpRow3[0] * position[0] + mvpRow3[1] * position[1] + mvpRow3[3];
  const wGradient = mvpRow3[0] * normal[0] + mvpRow3[1] * normal[1];
  return dilateFromProjection(
    position,
    normal,
    textureCoordinate,
    inverseScale,
    homogeneousW,
    wGradient,
    homogeneousW * (mvpRow0[0] * normal[0] + mvpRow0[1] * normal[1]) -
      wGradient * (mvpRow0[0] * position[0] + mvpRow0[1] * position[1] + mvpRow0[3]),
    homogeneousW * (mvpRow1[0] * normal[0] + mvpRow1[1] * normal[1]) -
      wGradient * (mvpRow1[0] * position[0] + mvpRow1[1] * position[1] + mvpRow1[3]),
    viewport,
  );
}

/**
 * CPU mirror of `slugDilateMatrix` over an explicit column-major matrix:
 * `clip = mvp * vec4(v, z, w)` with WGSL's column-times-vector contraction.
 */
export function referenceSlugDilateMatrix(
  position: SlugVec2,
  outwardNormal: SlugVec2,
  textureCoordinate: SlugVec2,
  inverseScale: number,
  mvp: readonly number[],
  viewport: SlugVec2,
): { position: SlugVec2; textureCoordinate: SlugVec2 } {
  const normalLength = Math.hypot(outwardNormal[0], outwardNormal[1]);
  const normal: SlugVec2 = [outwardNormal[0] / normalLength, outwardNormal[1] / normalLength];
  const project = (x: number, y: number, z: number, w: number): readonly [number, number, number, number] => [
    mvp[0]! * x + mvp[4]! * y + mvp[8]! * z + mvp[12]! * w,
    mvp[1]! * x + mvp[5]! * y + mvp[9]! * z + mvp[13]! * w,
    mvp[2]! * x + mvp[6]! * y + mvp[10]! * z + mvp[14]! * w,
    mvp[3]! * x + mvp[7]! * y + mvp[11]! * z + mvp[15]! * w,
  ];
  const clipPosition = project(position[0], position[1], 0, 1);
  const clipNormal = project(normal[0], normal[1], 0, 0);
  return dilateFromProjection(
    position,
    normal,
    textureCoordinate,
    inverseScale,
    clipPosition[3],
    clipNormal[3],
    clipPosition[3] * clipNormal[0] - clipNormal[3] * clipPosition[0],
    clipPosition[3] * clipNormal[1] - clipNormal[3] * clipPosition[1],
    viewport,
  );
}

/** CPU mirror of the vertex stage's placement: quad position, outward normal, and em coordinate. */
export function referenceSlugPlacement(
  quadPosition: SlugVec2,
  origin: SlugVec2,
  size: SlugVec2,
  emOrigin: SlugVec2,
  emSize: SlugVec2,
): { localPosition: SlugVec2; outwardNormal: SlugVec2; emCoordinate: SlugVec2 } {
  return {
    localPosition: [origin[0] + quadPosition[0] * size[0], -(origin[1] + quadPosition[1] * size[1])],
    outwardNormal: [(quadPosition[0] - 0.5) * size[0], -((quadPosition[1] - 0.5) * size[1])],
    emCoordinate: [emOrigin[0] + quadPosition[0] * emSize[0], emOrigin[1] - quadPosition[1] * emSize[1]],
  };
}

/** Clamp helper reused by band-index mirroring in tests. */
export function referenceSlugBandIndex(
  coordinate: number,
  scale: number,
  offset: number,
  declaredBandCount: number,
): number {
  return clamp(coordinate * scale + offset, 0, declaredBandCount - 1);
}
