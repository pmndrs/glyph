import tgpu, { type TgpuBindGroupLayout, type TgpuFn, type TgpuLayoutTexture } from 'typegpu';
import * as d from 'typegpu/data';
import * as std from 'typegpu/std';

/**
 * Maximum curves one fragment may evaluate from a hostile artifact.
 */
export const MAX_SAFE_SLUG_BAND_CURVES = 512;

/** The V0 band header keeps its curve count in the high half and its reference offset in the low half. */
const HEADER_REFERENCE_MASK = 0xffff;

/**
 * One decoded Slug glyph's band-table addressing, as a typed GPU schema. Core owns what each field means; how a program
 * addresses it — storage buffers, instanced attributes, or a uniform — stays the program's own choice. The grid widths
 * travel beside the bases because a page's tables are addressed through them.
 */
export const TypeGpuSlugGlyphAddressing: d.WgslStruct<{
  curveWidth: d.U32;
  headerWidth: d.U32;
  referenceWidth: d.U32;
  curveBaseTexel: d.U32;
  horizontalHeaderBase: d.U32;
  verticalHeaderBase: d.U32;
  referenceBase: d.U32;
  horizontalBandCount: d.U32;
  verticalBandCount: d.U32;
  bandTransform: d.Vec4f;
}> = d.struct({
  /** Width of the declared upload grid the curve table addresses into. */
  curveWidth: d.u32,
  /** Width of the declared upload grid the R32UI header table addresses into. */
  headerWidth: d.u32,
  /** Width of the declared upload grid the packed-reference table addresses into. */
  referenceWidth: d.u32,
  /** Page texel where this glyph's curve records begin. */
  curveBaseTexel: d.u32,
  /** Header-grid texel where the horizontal band headers begin. */
  horizontalHeaderBase: d.u32,
  /** Header-grid texel where the vertical band headers begin. */
  verticalHeaderBase: d.u32,
  /** Glyph-local base added to every band's reference offset. */
  referenceBase: d.u32,
  /** Declared horizontal band count of this glyph. */
  horizontalBandCount: d.u32,
  /** Declared vertical band count of this glyph. */
  verticalBandCount: d.u32,
  /** Band grid placement as `(originX, originY, scaleX, scaleY)` in em space. */
  bandTransform: d.vec4f,
});
export type TypeGpuSlugGlyphAddressing = d.InferGPU<typeof TypeGpuSlugGlyphAddressing>;

/**
 * One glyph instance's canonical Slug fields, as a typed GPU schema. Core owns what each field means; how a program
 * addresses it — storage buffers, instanced attributes, or a uniform — stays the program's own choice.
 */
export const TypeGpuSlugInstance: d.WgslStruct<{
  origin: d.Vec2f;
  size: d.Vec2f;
  emOrigin: d.Vec2f;
  emSize: d.Vec2f;
  inverseScale: d.F32;
  color: d.Vec4f;
  glyph: typeof TypeGpuSlugGlyphAddressing;
}> = d.struct({
  /** Paragraph-local glyph origin, in layout units, with y measured downward. */
  origin: d.vec2f,
  /** Glyph quad extent in layout units. */
  size: d.vec2f,
  /** Upper-left em-space coordinate of the glyph quad. */
  emOrigin: d.vec2f,
  /** Em-space extent of the glyph quad. */
  emSize: d.vec2f,
  /** Layout units per em, used to carry the dilation back into em space. */
  inverseScale: d.f32,
  /** Resolved paint colour with alpha, unpremultiplied. */
  color: d.vec4f,
  /** Band-table addressing shared with the fragment stage through this varying. */
  glyph: TypeGpuSlugGlyphAddressing,
});
export type TypeGpuSlugInstance = d.InferGPU<typeof TypeGpuSlugInstance>;

/**
 * The GPU resource one Slug glyph batch binds: the three integer/half-float tables one decoded page publishes. Every
 * read is an exact integer texel load — the fetch the `/tsl` realization compiles to for data textures — so no sampler
 * enters the layout.
 */
export const TypeGpuSlugPageLayout: TgpuBindGroupLayout<{
  curves: TgpuLayoutTexture<d.WgslTexture2d<d.F32>> & { visibility?: readonly ['fragment'] };
  headers: TgpuLayoutTexture<d.WgslTexture2d<d.U32>> & { visibility?: readonly ['fragment'] };
  references: TgpuLayoutTexture<d.WgslTexture2d<d.U32>> & { visibility?: readonly ['fragment'] };
}> = tgpu.bindGroupLayout({
  curves: { texture: d.texture2d(d.f32), visibility: ['fragment'] },
  headers: { texture: d.texture2d(d.u32), visibility: ['fragment'] },
  references: { texture: d.texture2d(d.u32), visibility: ['fragment'] },
});

/** Everything the vertex stage reads besides the instance: the unit quad, the draw's projection, and the viewport. */
export const TypeGpuSlugVertexInput: d.WgslStruct<{
  quadPosition: d.Vec2f;
  instance: typeof TypeGpuSlugInstance;
  modelViewProjectionRow0: d.Vec4f;
  modelViewProjectionRow1: d.Vec4f;
  modelViewProjectionRow3: d.Vec4f;
  viewport: d.Vec2f;
}> = d.struct({
  /**
   * Unit-quad coordinate spanning `[0, 1]` with the origin at the glyph's upper-left corner. This is the coordinate
   * `/tsl` reads from `positionLocal`; a program supplying different geometry owns that correspondence.
   */
  quadPosition: d.vec2f,
  instance: TypeGpuSlugInstance,
  /** Rows 0, 1, and 3 of the column-major model-view-projection: the x/y clip axes and the perspective row. */
  modelViewProjectionRow0: d.vec4f,
  modelViewProjectionRow1: d.vec4f,
  modelViewProjectionRow3: d.vec4f,
  /** Drawing-buffer size in device pixels. Drives the analytic half-pixel dilation footprint. */
  viewport: d.vec2f,
});
export type TypeGpuSlugVertexInput = d.InferGPU<typeof TypeGpuSlugVertexInput>;

/** The matrix-projection vertex variant's inputs: one whole model-view-projection instead of three rows. */
export const TypeGpuSlugMatrixVertexInput: d.WgslStruct<{
  quadPosition: d.Vec2f;
  instance: typeof TypeGpuSlugInstance;
  modelViewProjection: d.Mat4x4f;
  viewport: d.Vec2f;
}> = d.struct({
  quadPosition: d.vec2f,
  instance: TypeGpuSlugInstance,
  /** Exact MVP selected per glyph when a renderer batches multiple model transforms into one draw. */
  modelViewProjection: d.mat4x4f,
  viewport: d.vec2f,
});
export type TypeGpuSlugMatrixVertexInput = d.InferGPU<typeof TypeGpuSlugMatrixVertexInput>;

/**
 * Everything the canonical Slug vertex stage produces, so a program can consume a stage or compose over its output.
 *
 * Unlike Bitmap there is no pixel-snapped variant and no published clip position: Slug integrates coverage analytically
 * from outlines, so it is correct at any subpixel placement and keeps the renderer's default projection. A program
 * assigns its own clip placement from `position`.
 */
export const TypeGpuSlugVertexOutput: d.WgslStruct<{
  position: d.Vec3f;
  renderCoordinate: d.Vec2f;
  color: d.Vec4f;
  glyph: typeof TypeGpuSlugGlyphAddressing;
}> = d.struct({
  /** Dilated glyph-quad position in paragraph space, y upward, z zero. */
  position: d.vec3f,
  /** Dilated em-space coordinate the coverage integral is evaluated at. Interpolate this across the quad. */
  renderCoordinate: d.vec2f,
  /** Resolved paint colour passed through to the fragment stage. */
  color: d.vec4f,
  /** Band-table addressing passed through to the fragment stage. Treat this varying as flat. */
  glyph: TypeGpuSlugGlyphAddressing,
});
export type TypeGpuSlugVertexOutput = d.InferGPU<typeof TypeGpuSlugVertexOutput>;

/** Everything the fragment stage reads: the interpolated varyings of one glyph quad. */
export const TypeGpuSlugFragmentInput: d.WgslStruct<{
  renderCoordinate: d.Vec2f;
  color: d.Vec4f;
  glyph: typeof TypeGpuSlugGlyphAddressing;
}> = d.struct({
  renderCoordinate: d.vec2f,
  color: d.vec4f,
  glyph: TypeGpuSlugGlyphAddressing,
});
export type TypeGpuSlugFragmentInput = d.InferGPU<typeof TypeGpuSlugFragmentInput>;

/**
 * Everything the canonical Slug fragment stage produces, so a program can consume the final result or compose over
 * its coverage before paint alpha.
 */
export const TypeGpuSlugFragmentOutput: d.WgslStruct<{
  coverage: d.F32;
  color: d.Vec3f;
  opacity: d.F32;
}> = d.struct({
  /** Analytic fill coverage before paint alpha. */
  coverage: d.f32,
  color: d.vec3f,
  opacity: d.f32,
});
export type TypeGpuSlugFragmentOutput = d.InferGPU<typeof TypeGpuSlugFragmentOutput>;

/** One quadratic curve's three control points relative to the fragment being shaded. */
export const TypeGpuSlugCurve: d.WgslStruct<{ p0: d.Vec2f; p1: d.Vec2f; p2: d.Vec2f }> = d.struct({
  p0: d.vec2f,
  p1: d.vec2f,
  p2: d.vec2f,
});
export type TypeGpuSlugCurve = d.InferGPU<typeof TypeGpuSlugCurve>;

/** One fill band's accumulated winding coverage and antialiasing weight. */
export const TypeGpuSlugBandEvaluation: d.WgslStruct<{ coverage: d.F32; weight: d.F32 }> = d.struct({
  coverage: d.f32,
  weight: d.f32,
});
export type TypeGpuSlugBandEvaluation = d.InferGPU<typeof TypeGpuSlugBandEvaluation>;

/** One glyph-quad vertex's half-pixel dilation, in plane space and em space at once. */
export const TypeGpuSlugDilation: d.WgslStruct<{ position: d.Vec2f; textureCoordinate: d.Vec2f }> = d.struct({
  position: d.vec2f,
  textureCoordinate: d.vec2f,
});
export type TypeGpuSlugDilation = d.InferGPU<typeof TypeGpuSlugDilation>;

/**
 * Two real roots of `a*t^2 - 2*b*t + c = 0`, ordered to match `calcRootCode`'s winding convention. The branch order and
 * every reciprocal match the `/tsl` realization's emitted shader exactly.
 */
export function stableRoots(a: number, b: number, c: number): d.v2f {
  'use gpu';

  const discriminant = b * b - a * c;
  let t1 = d.f32(0);
  let t2 = d.f32(0);

  if (std.abs(a) < 1 / 65_536) {
    const linearRoot = c / (b * 2);
    t1 = linearRoot;
    t2 = linearRoot;
  } else if (discriminant <= 0) {
    const extremum = b / a;
    t1 = extremum;
    t2 = extremum;
  } else {
    const distance = std.sqrt(discriminant);
    const bPositive = b >= 0;
    const sign = std.select(d.f32(-1), d.f32(1), bPositive);
    const q = b + sign * distance;
    const rootA = q / a;
    const rootB = c / q;
    t1 = std.select(rootA, rootB, bPositive);
    t2 = std.select(rootB, rootA, bPositive);
  }

  return d.vec2f(t1, t2);
}

/** Solve a quadratic curve's intersections with a horizontal ray at y=0. */
export function solveHorizontalPolynomial(p0: d.v2f, p1: d.v2f, p2: d.v2f): d.v2f {
  'use gpu';

  const a = p0.y - p1.y * 2 + p2.y;
  const b = p0.y - p1.y;
  const roots = stableRoots(a, b, p0.y);
  const ax = p0.x - p1.x * 2 + p2.x;
  const bx = p0.x - p1.x;
  const axT1 = ax * roots.x - bx * 2;
  const axT2 = ax * roots.y - bx * 2;
  return d.vec2f(axT1 * roots.x + p0.x, axT2 * roots.y + p0.x);
}

/** Solve a quadratic curve's intersections with a vertical ray at x=0. */
export function solveVerticalPolynomial(p0: d.v2f, p1: d.v2f, p2: d.v2f): d.v2f {
  'use gpu';

  const a = p0.x - p1.x * 2 + p2.x;
  const b = p0.x - p1.x;
  const roots = stableRoots(a, b, p0.x);
  const ay = p0.y - p1.y * 2 + p2.y;
  const by = p0.y - p1.y;
  const ayT1 = ay * roots.x - by * 2;
  const ayT2 = ay * roots.y - by * 2;
  return d.vec2f(ayT1 * roots.x + p0.y, ayT2 * roots.y + p0.y);
}

/**
 * Calculate root eligibility from the signs of three control-point coordinates.
 * Bit 0 selects the first ordered root and bit 8 selects the second.
 */
export function calcRootCode(y1: number, y2: number, y3: number): number {
  'use gpu';

  const s1 = std.select(d.u32(0), d.u32(1), y1 < 0);
  const s2 = std.select(d.u32(0), d.u32(1), y2 < 0);
  const s3 = std.select(d.u32(0), d.u32(1), y3 < 0);
  const lowSigns = s1 | (s2 << 1);
  const shift = lowSigns | (s3 << 2);
  const tableBits = d.u32(0x2e74) >>> shift;

  return tableBits & d.u32(0x0101);
}

/** Map a nonnegative logical texel index into its declared upload grid. */
export function slugGridCoordinate(index: number, width: number): d.v2i {
  'use gpu';

  const integerIndex = d.i32(index);
  const integerWidth = d.i32(width);
  return d.vec2i(integerIndex % integerWidth, std.intdiv(integerIndex, integerWidth));
}

/** Read one V0 `(count << 16) | offset` band header from the R32UI header grid. */
export function loadSlugHeader(headers: d.texture2d<d.U32>, index: number, headerWidth: number): number {
  'use gpu';

  const texel = std.textureLoad(headers, slugGridCoordinate(index, headerWidth), 0);
  return texel.x;
}

/** Unpack one V0 glyph-local u16 curve reference from the packed R32UI reference grid. */
export function loadSlugReference(references: d.texture2d<d.U32>, index: number, referenceWidth: number): number {
  'use gpu';

  const pair = std.textureLoad(references, slugGridCoordinate(index >>> d.u32(1), referenceWidth), 0).x;
  const bitOffset = (index & d.u32(1)) * d.u32(16);
  return (pair >> bitOffset) & d.u32(HEADER_REFERENCE_MASK);
}

/** Read one curve record — six half-float components over two consecutive texels — from the curve grid. */
export function loadSlugCurve(curves: d.texture2d<d.F32>, texelIndex: number, curveWidth: number): TypeGpuSlugCurve {
  'use gpu';

  const first = std.textureLoad(curves, slugGridCoordinate(texelIndex, curveWidth), 0);
  const second = std.textureLoad(curves, slugGridCoordinate(texelIndex + d.u32(1), curveWidth), 0);
  return TypeGpuSlugCurve({
    p0: d.vec2f(first.x, first.y),
    p1: d.vec2f(first.z, first.w),
    p2: d.vec2f(second.x, second.y),
  });
}

/** Decode one V0 band header: its capped curve count and glyph-local reference offset. */
export function slugBandCurveCount(header: number): number {
  'use gpu';

  return d.u32(std.min(d.f32(header >>> d.u32(16)), MAX_SAFE_SLUG_BAND_CURVES));
}

/** Walk one horizontal fill band: the sorted references, the quadratic roots, and the winding accumulation. */
export function evaluateHorizontalSlugBand(
  curves: d.texture2d<d.F32>,
  headers: d.texture2d<d.U32>,
  references: d.texture2d<d.U32>,
  glyph: TypeGpuSlugGlyphAddressing,
  renderCoordinate: d.v2f,
  pixelsPerEm: number,
  thickenFactor: number,
): TypeGpuSlugBandEvaluation {
  'use gpu';

  const scaledCoordinate = renderCoordinate.y * glyph.bandTransform.y;
  const transformedCoordinate = scaledCoordinate + glyph.bandTransform.w;
  const maximumBandIndex = d.f32(glyph.horizontalBandCount) - 1;
  const clampedBandIndex = std.clamp(transformedCoordinate, 0, maximumBandIndex);
  const header = loadSlugHeader(headers, glyph.horizontalHeaderBase + d.u32(clampedBandIndex), glyph.headerWidth);
  const localReferenceOffset = header & d.u32(HEADER_REFERENCE_MASK);
  const curveCount = d.i32(slugBandCurveCount(header));
  let coverage = d.f32(0);
  let weight = d.f32(0);
  let curveIndex = d.i32(0);

  while (curveIndex < curveCount) {
    const referenceIndex = glyph.referenceBase + localReferenceOffset + d.u32(curveIndex);
    const curveReference = loadSlugReference(references, referenceIndex, glyph.referenceWidth);
    const curve = loadSlugCurve(curves, glyph.curveBaseTexel + curveReference, glyph.curveWidth);
    const p0 = curve.p0.sub(renderCoordinate);
    const p1 = curve.p1.sub(renderCoordinate);
    const p2 = curve.p2.sub(renderCoordinate);
    const maximum = std.max(std.max(p0.x, p1.x), p2.x) * pixelsPerEm;

    if (maximum < -0.5) {
      curveIndex = curveCount;
    } else {
      const rootCode = calcRootCode(p0.y, p1.y, p2.y);

      if (rootCode > d.u32(0)) {
        const roots = solveHorizontalPolynomial(p0, p1, p2);
        const firstRoot = roots.x * pixelsPerEm;
        const secondRoot = roots.y * pixelsPerEm;
        const hasFirstRoot = (rootCode & d.u32(1)) > d.u32(0);
        const hasSecondRoot = (rootCode & d.u32(0x100)) > d.u32(0);
        const firstContribution = std.select(d.f32(0), std.saturate(firstRoot * thickenFactor + 0.5), hasFirstRoot);
        const secondContribution = std.select(d.f32(0), std.saturate(secondRoot * thickenFactor + 0.5), hasSecondRoot);
        coverage += firstContribution - secondContribution;
        const firstWeight = std.saturate(1 - std.abs(firstRoot) * 2);
        const secondWeight = std.saturate(1 - std.abs(secondRoot) * 2);
        weight = std.max(
          weight,
          std.max(std.select(d.f32(0), firstWeight, hasFirstRoot), std.select(d.f32(0), secondWeight, hasSecondRoot)),
        );
      }

      curveIndex += 1;
    }
  }

  return TypeGpuSlugBandEvaluation({ coverage, weight });
}

/**
 * Walk one vertical fill band.
 *
 * A vertical band is the horizontal band in the transposed frame with the opposite winding sense: the coordinate,
 * transform, polynomial, and terminator axes all move to x, and the coverage delta flips sign.
 */
export function evaluateVerticalSlugBand(
  curves: d.texture2d<d.F32>,
  headers: d.texture2d<d.U32>,
  references: d.texture2d<d.U32>,
  glyph: TypeGpuSlugGlyphAddressing,
  renderCoordinate: d.v2f,
  pixelsPerEm: number,
  thickenFactor: number,
): TypeGpuSlugBandEvaluation {
  'use gpu';

  const scaledCoordinate = renderCoordinate.x * glyph.bandTransform.x;
  const transformedCoordinate = scaledCoordinate + glyph.bandTransform.z;
  const maximumBandIndex = d.f32(glyph.verticalBandCount) - 1;
  const clampedBandIndex = std.clamp(transformedCoordinate, 0, maximumBandIndex);
  const header = loadSlugHeader(headers, glyph.verticalHeaderBase + d.u32(clampedBandIndex), glyph.headerWidth);
  const localReferenceOffset = header & d.u32(HEADER_REFERENCE_MASK);
  const curveCount = d.i32(slugBandCurveCount(header));
  let coverage = d.f32(0);
  let weight = d.f32(0);
  let curveIndex = d.i32(0);

  while (curveIndex < curveCount) {
    const referenceIndex = glyph.referenceBase + localReferenceOffset + d.u32(curveIndex);
    const curveReference = loadSlugReference(references, referenceIndex, glyph.referenceWidth);
    const curve = loadSlugCurve(curves, glyph.curveBaseTexel + curveReference, glyph.curveWidth);
    const p0 = curve.p0.sub(renderCoordinate);
    const p1 = curve.p1.sub(renderCoordinate);
    const p2 = curve.p2.sub(renderCoordinate);
    const maximum = std.max(std.max(p0.y, p1.y), p2.y) * pixelsPerEm;

    if (maximum < -0.5) {
      curveIndex = curveCount;
    } else {
      const rootCode = calcRootCode(p0.x, p1.x, p2.x);

      if (rootCode > d.u32(0)) {
        const roots = solveVerticalPolynomial(p0, p1, p2);
        const firstRoot = roots.x * pixelsPerEm;
        const secondRoot = roots.y * pixelsPerEm;
        const hasFirstRoot = (rootCode & d.u32(1)) > d.u32(0);
        const hasSecondRoot = (rootCode & d.u32(0x100)) > d.u32(0);
        const firstContribution = std.select(d.f32(0), std.saturate(firstRoot * thickenFactor + 0.5), hasFirstRoot);
        const secondContribution = std.select(d.f32(0), std.saturate(secondRoot * thickenFactor + 0.5), hasSecondRoot);
        coverage += secondContribution - firstContribution;
        const firstWeight = std.saturate(1 - std.abs(firstRoot) * 2);
        const secondWeight = std.saturate(1 - std.abs(secondRoot) * 2);
        weight = std.max(
          weight,
          std.max(std.select(d.f32(0), firstWeight, hasFirstRoot), std.select(d.f32(0), secondWeight, hasSecondRoot)),
        );
      }

      curveIndex += 1;
    }
  }

  return TypeGpuSlugBandEvaluation({ coverage, weight });
}

/** Combine horizontal and vertical winding coverage using Lengyel's weighted blend. */
export function calcSlugCoverage(
  xCoverage: number,
  xWeight: number,
  yCoverage: number,
  yWeight: number,
  evenOdd: boolean,
  weightBoost: boolean,
): number {
  'use gpu';

  const weightedNumerator = std.abs(xCoverage * xWeight + yCoverage * yWeight);
  const weighted = weightedNumerator / std.max(xWeight + yWeight, 1 / 65_536);
  const fallback = std.min(std.abs(xCoverage), std.abs(yCoverage));
  const rawCoverage = std.max(weighted, fallback);
  const nonzeroCoverage = std.saturate(rawCoverage);
  const evenOddCoverage = 1 - std.abs(1 - std.fract(rawCoverage * 0.5) * 2);
  const filledCoverage = std.select(nonzeroCoverage, evenOddCoverage, evenOdd);
  return std.select(filledCoverage, std.sqrt(filledCoverage), weightBoost);
}

/**
 * Coverage widening applied below 24 pixels per em. Zero `thicken` is exactly 1, so the canonical no-compensation
 * fragment reproduces the `/tsl` default graph by passing 1.
 */
export function slugThickenFactor(thicken: number, pixelsPerEm: number): number {
  'use gpu';

  return 1 + thicken * std.max(0, 1 - pixelsPerEm / 24);
}

/**
 * Stem darkening for small sizes. Zero `darken` leaves any bounded coverage exactly unchanged, so the canonical
 * no-compensation fragment reproduces the `/tsl` default graph without this term.
 */
export function slugStemDarken(coverage: number, darken: number): number {
  'use gpu';

  return std.min(coverage + darken * coverage * (1 - coverage), 1);
}

/**
 * Expand one glyph-quad vertex by a half-pixel antialiasing footprint through the projection's three significant rows.
 * The dot-product decomposition and every subtraction order match the `/tsl` realization's emitted shader exactly.
 */
export function slugDilate(
  position: d.v2f,
  outwardNormal: d.v2f,
  textureCoordinate: d.v2f,
  inverseScale: number,
  mvpRow0: d.v4f,
  mvpRow1: d.v4f,
  mvpRow3: d.v4f,
  viewport: d.v2f,
): TypeGpuSlugDilation {
  'use gpu';

  const normal = std.normalize(outwardNormal);
  const homogeneousW = std.dot(mvpRow3.xy, position) + mvpRow3.w;
  const wGradient = std.dot(mvpRow3.xy, normal);
  const projectedX =
    (homogeneousW * std.dot(mvpRow0.xy, normal) - wGradient * (std.dot(mvpRow0.xy, position) + mvpRow0.w)) * viewport.x;
  const projectedY =
    (homogeneousW * std.dot(mvpRow1.xy, normal) - wGradient * (std.dot(mvpRow1.xy, position) + mvpRow1.w)) * viewport.y;
  const squaredW = homogeneousW * homogeneousW;
  const wTimesGradient = homogeneousW * wGradient;
  const projectedLengthSquared = projectedX * projectedX + projectedY * projectedY;
  const denominator = projectedLengthSquared - squaredW * wGradient * wGradient;
  const distance = (squaredW * (wTimesGradient + std.sqrt(projectedLengthSquared))) / denominator;
  const dx = normal.x * distance;
  const dy = normal.y * distance;

  return TypeGpuSlugDilation({
    position: d.vec2f(position.x + dx, position.y + dy),
    textureCoordinate: d.vec2f(textureCoordinate.x + dx * inverseScale, textureCoordinate.y + dy * inverseScale),
  });
}

/** Expand a glyph quad using the exact per-instance model-view-projection matrix selected by a batched draw. */
export function slugDilateMatrix(
  position: d.v2f,
  outwardNormal: d.v2f,
  textureCoordinate: d.v2f,
  inverseScale: number,
  modelViewProjection: d.m4x4f,
  viewport: d.v2f,
): TypeGpuSlugDilation {
  'use gpu';

  const normal = std.normalize(outwardNormal);
  const clipPosition = std.mul(modelViewProjection, d.vec4f(position, 0, 1));
  const clipNormal = std.mul(modelViewProjection, d.vec4f(normal, 0, 0));
  const projectedX = (clipPosition.w * clipNormal.x - clipNormal.w * clipPosition.x) * viewport.x;
  const projectedY = (clipPosition.w * clipNormal.y - clipNormal.w * clipPosition.y) * viewport.y;
  const squaredW = clipPosition.w * clipPosition.w;
  const wTimesGradient = clipPosition.w * clipNormal.w;
  const projectedLengthSquared = projectedX * projectedX + projectedY * projectedY;
  const denominator = projectedLengthSquared - squaredW * clipNormal.w * clipNormal.w;
  const distance = (squaredW * (wTimesGradient + std.sqrt(projectedLengthSquared))) / denominator;
  const dx = normal.x * distance;
  const dy = normal.y * distance;

  return TypeGpuSlugDilation({
    position: d.vec2f(position.x + dx, position.y + dy),
    textureCoordinate: d.vec2f(textureCoordinate.x + dx * inverseScale, textureCoordinate.y + dy * inverseScale),
  });
}

/** Glyph-quad placement, outward normals, and em coordinates with layout units' downward y flipped upward. */
export const TypeGpuSlugPlacement: d.WgslStruct<{
  localPosition: d.Vec2f;
  outwardNormal: d.Vec2f;
  emCoordinate: d.Vec2f;
}> = d.struct({
  localPosition: d.vec2f,
  outwardNormal: d.vec2f,
  emCoordinate: d.vec2f,
});

function slugPlacement(quadPosition: d.v2f, instance: TypeGpuSlugInstance): d.InferGPU<typeof TypeGpuSlugPlacement> {
  'use gpu';

  return TypeGpuSlugPlacement({
    localPosition: d.vec2f(
      instance.origin.x + quadPosition.x * instance.size.x,
      -(instance.origin.y + quadPosition.y * instance.size.y),
    ),
    outwardNormal: d.vec2f((quadPosition.x - 0.5) * instance.size.x, -((quadPosition.y - 0.5) * instance.size.y)),
    emCoordinate: d.vec2f(
      instance.emOrigin.x + quadPosition.x * instance.emSize.x,
      instance.emOrigin.y - quadPosition.y * instance.emSize.y,
    ),
  });
}

/**
 * The canonical Slug vertex stage: quad placement, the analytic half-pixel dilation over three projection rows, and
 * paint/addressing passthrough. The dilation widens the quad so the fragment integral keeps its antialiasing footprint;
 * whatever clip placement a program applies to `position` must describe the same draw the viewport describes.
 */
export const slugVertex: TgpuFn<(input: typeof TypeGpuSlugVertexInput) => typeof TypeGpuSlugVertexOutput> = tgpu.fn(
  [TypeGpuSlugVertexInput],
  TypeGpuSlugVertexOutput,
)((input) => {
  'use gpu';

  const instance = input.instance;
  const placed = slugPlacement(input.quadPosition, instance);
  const dilated = slugDilate(
    placed.localPosition,
    placed.outwardNormal,
    placed.emCoordinate,
    instance.inverseScale,
    input.modelViewProjectionRow0,
    input.modelViewProjectionRow1,
    input.modelViewProjectionRow3,
    input.viewport,
  );
  return TypeGpuSlugVertexOutput({
    position: d.vec3f(dilated.position.x, dilated.position.y, 0),
    renderCoordinate: dilated.textureCoordinate,
    color: instance.color,
    glyph: instance.glyph,
  });
});

/** The matrix-projection Slug vertex stage: the same graph with one whole model-view-projection per glyph. */
export const slugVertexMatrix: TgpuFn<(input: typeof TypeGpuSlugMatrixVertexInput) => typeof TypeGpuSlugVertexOutput> =
  tgpu.fn(
    [TypeGpuSlugMatrixVertexInput],
    TypeGpuSlugVertexOutput,
  )((input) => {
    'use gpu';

    const instance = input.instance;
    const placed = slugPlacement(input.quadPosition, instance);
    const dilated = slugDilateMatrix(
      placed.localPosition,
      placed.outwardNormal,
      placed.emCoordinate,
      instance.inverseScale,
      input.modelViewProjection,
      input.viewport,
    );
    return TypeGpuSlugVertexOutput({
      position: d.vec3f(dilated.position.x, dilated.position.y, 0),
      renderCoordinate: dilated.textureCoordinate,
      color: instance.color,
      glyph: instance.glyph,
    });
  });

/**
 * The canonical Slug fragment stage: both fill bands walked against the bound page tables, blended with the non-zero
 * winding rule and no weight compensation — the configuration `/tsl` ships as its default. Styled programs compose the
 * exported band walkers, `slugThickenFactor`, `slugStemDarken`, and `calcSlugCoverage`'s fill-rule arguments instead.
 */
export const slugFragment: TgpuFn<(input: typeof TypeGpuSlugFragmentInput) => typeof TypeGpuSlugFragmentOutput> =
  tgpu.fn(
    [TypeGpuSlugFragmentInput],
    TypeGpuSlugFragmentOutput,
  )((input) => {
    'use gpu';

    const emsPerPixel = std.fwidth(input.renderCoordinate);
    const pixelsPerEmX = 1 / std.max(emsPerPixel.x, 1 / 65_536);
    const pixelsPerEmY = 1 / std.max(emsPerPixel.y, 1 / 65_536);
    const horizontal = evaluateHorizontalSlugBand(
      TypeGpuSlugPageLayout.$.curves,
      TypeGpuSlugPageLayout.$.headers,
      TypeGpuSlugPageLayout.$.references,
      input.glyph,
      input.renderCoordinate,
      pixelsPerEmX,
      d.f32(1),
    );
    const vertical = evaluateVerticalSlugBand(
      TypeGpuSlugPageLayout.$.curves,
      TypeGpuSlugPageLayout.$.headers,
      TypeGpuSlugPageLayout.$.references,
      input.glyph,
      input.renderCoordinate,
      pixelsPerEmY,
      d.f32(1),
    );
    const coverage = calcSlugCoverage(
      horizontal.coverage,
      horizontal.weight,
      vertical.coverage,
      vertical.weight,
      false,
      false,
    );
    return TypeGpuSlugFragmentOutput({
      coverage,
      color: d.vec3f(input.color.r, input.color.g, input.color.b),
      opacity: input.color.a * coverage,
    });
  });
