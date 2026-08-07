import type { ParagraphLayout } from '@pmndrs/text';
import { SLUG_GLYPH_RECORD_STRIDE, type SlugData, type SlugPageData } from '@pmndrs/text/raster/slug';

const ABSENT_PAGE = 0xffff;
const MAX_SAFE_BAND_CURVES = 512;
const MINIMUM_FOOTPRINT = 1 / 65_536;

export interface SlugCpuReferenceBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface SlugCpuReference {
  readonly width: number;
  readonly height: number;
  /** Top-to-bottom, straight-alpha RGBA8 pixels composited over opaque black. */
  readonly pixels: Uint8Array;
  readonly bounds: SlugCpuReferenceBounds | undefined;
  readonly unclippedBounds: SlugCpuReferenceBounds | undefined;
  readonly glyphCount: number;
  readonly evaluatedCurves: number;
}

export interface FlatSlugCpuReferenceOptions {
  readonly width: number;
  readonly height: number;
  readonly dpr?: number;
  readonly originX?: number;
  readonly originY?: number;
  readonly fontSlot?: number;
  readonly fill?: readonly [number, number, number, number];
}

/**
 * Reconstruct the fixed flat Slug specimen on the CPU from exact decoded curve, header,
 * and reference resources without invoking Three.js, TSL, or browser fonts.
 */
export function renderFlatSlugCpuReference(
  data: SlugData,
  layout: ParagraphLayout,
  options: FlatSlugCpuReferenceOptions,
): SlugCpuReference {
  const width = positiveInteger(options.width, 'Slug CPU reference width');
  const height = positiveInteger(options.height, 'Slug CPU reference height');
  const dpr = positiveFinite(options.dpr ?? 1, 'Slug CPU reference DPR');
  const originX = finite(options.originX ?? 0, 'Slug CPU reference origin X');
  const originY = finite(options.originY ?? 0, 'Slug CPU reference origin Y');
  const fontSlot = nonnegativeInteger(options.fontSlot ?? 0, 'Slug CPU reference font slot');
  const fill = linearColor(options.fill ?? [1, 1, 1, 1]);
  assertLayoutArrays(layout);
  if (data.records.byteLength % SLUG_GLYPH_RECORD_STRIDE !== 0) {
    throw new TypeError('Slug CPU reference record table is not densely packed');
  }

  const records = new DataView(data.records.buffer, data.records.byteOffset, data.records.byteLength);
  // The decoded pages carry bytes rather than texel views, so bind each page once instead of per evaluated band.
  const pageTexels = data.pages.map(bindPageTexels);
  const pixels = opaqueBlack(width, height);
  let bounds: SlugCpuReferenceBounds | undefined;
  let unclippedBounds: SlugCpuReferenceBounds | undefined;
  let glyphCount = 0;
  let evaluatedCurves = 0;

  for (let glyphIndex = 0; glyphIndex < layout.glyphIds.length; glyphIndex += 1) {
    if (layout.glyphFontSlots[glyphIndex] !== fontSlot) continue;
    const glyphId = layout.glyphIds[glyphIndex]!;
    if (glyphId >= data.records.byteLength / SLUG_GLYPH_RECORD_STRIDE) {
      throw new TypeError('paragraph layout references a Slug glyph outside the resource');
    }
    const record = glyphId * SLUG_GLYPH_RECORD_STRIDE;
    const pageIndex = records.getUint16(record + 8, true);
    if (pageIndex === ABSENT_PAGE) continue;
    const page = data.pages[pageIndex];
    const texels = pageTexels[pageIndex];
    if (page === undefined || texels === undefined) throw new TypeError('Slug record references a missing page');

    const planeLeft = records.getInt16(record, true);
    const planeBottom = records.getInt16(record + 2, true);
    const planeRight = records.getInt16(record + 4, true);
    const planeTop = records.getInt16(record + 6, true);
    const horizontalBandCount = records.getUint16(record + 10, true);
    const verticalBandCount = records.getUint16(record + 12, true);
    const curveBase = records.getUint32(record + 16, true);
    const horizontalHeaderBase = records.getUint32(record + 24, true);
    const verticalHeaderBase = records.getUint32(record + 28, true);
    const referenceBase = records.getUint32(record + 32, true);
    const fontSize = positiveFinite(layout.glyphFontSizes[glyphIndex]!, 'Slug CPU reference glyph font size');
    const scale = fontSize / positiveFinite(data.planeUnitsPerEm, 'Slug plane units per em');
    const logicalLeft = originX + layout.x[glyphIndex]! + planeLeft * scale;
    const logicalRight = originX + layout.x[glyphIndex]! + planeRight * scale;
    const logicalTop = -(originY - layout.y[glyphIndex]! + planeTop * scale);
    const logicalBottom = -(originY - layout.y[glyphIndex]! + planeBottom * scale);
    const glyphBounds = pixelBounds(
      logicalLeft * dpr - 0.5,
      logicalTop * dpr - 0.5,
      logicalRight * dpr + 0.5,
      logicalBottom * dpr + 0.5,
    );
    unclippedBounds = unionBounds(unclippedBounds, glyphBounds);
    const clippedBounds = clippedPixelBounds(glyphBounds, width, height);
    if (clippedBounds === undefined) continue;
    glyphCount += 1;
    bounds = unionBounds(bounds, clippedBounds);

    const normalizedLeft = planeLeft / data.planeUnitsPerEm;
    const normalizedBottom = planeBottom / data.planeUnitsPerEm;
    const normalizedWidth = (planeRight - planeLeft) / data.planeUnitsPerEm;
    const normalizedHeight = (planeTop - planeBottom) / data.planeUnitsPerEm;
    const bandScaleX = verticalBandCount / normalizedWidth;
    const bandScaleY = horizontalBandCount / normalizedHeight;
    const bandOffsetX = -normalizedLeft * bandScaleX;
    const bandOffsetY = -normalizedBottom * bandScaleY;
    const pixelsPerEm = Math.min(1 / MINIMUM_FOOTPRINT, fontSize * dpr);

    for (let y = clippedBounds.minY; y <= clippedBounds.maxY; y += 1) {
      const renderY = (-(y + 0.5) / dpr - originY + layout.y[glyphIndex]!) / fontSize;
      for (let x = clippedBounds.minX; x <= clippedBounds.maxX; x += 1) {
        const renderX = ((x + 0.5) / dpr - originX - layout.x[glyphIndex]!) / fontSize;
        const horizontal = evaluateBand(page, texels, {
          axis: 'horizontal',
          bandCount: horizontalBandCount,
          bandIndex: clampedBandIndex(renderY * bandScaleY + bandOffsetY, horizontalBandCount),
          curveBase,
          headerBase: horizontalHeaderBase,
          pixelsPerEm,
          referenceBase,
          renderX,
          renderY,
        });
        const vertical = evaluateBand(page, texels, {
          axis: 'vertical',
          bandCount: verticalBandCount,
          bandIndex: clampedBandIndex(renderX * bandScaleX + bandOffsetX, verticalBandCount),
          curveBase,
          headerBase: verticalHeaderBase,
          pixelsPerEm,
          referenceBase,
          renderX,
          renderY,
        });
        evaluatedCurves += horizontal.evaluatedCurves + vertical.evaluatedCurves;
        const coverage = combinedCoverage(horizontal, vertical);
        if (coverage > 0) compositeFill(pixels, (y * width + x) * 4, fill, coverage);
      }
    }
  }

  return { width, height, pixels, bounds, unclippedBounds, glyphCount, evaluatedCurves };
}

/** Typed views over one decoded page, bound once so band evaluation stays a pure indexed read. */
interface SlugPageTexels {
  readonly curves: Uint16Array;
  readonly headers: Uint32Array;
  readonly references: Uint16Array;
}

interface BandOptions {
  readonly axis: 'horizontal' | 'vertical';
  readonly bandCount: number;
  readonly bandIndex: number;
  readonly curveBase: number;
  readonly headerBase: number;
  readonly pixelsPerEm: number;
  readonly referenceBase: number;
  readonly renderX: number;
  readonly renderY: number;
}

interface BandResult {
  readonly coverage: number;
  readonly weight: number;
  readonly evaluatedCurves: number;
}

function evaluateBand(page: SlugPageData, texels: SlugPageTexels, options: BandOptions): BandResult {
  const headerIndex = options.headerBase + options.bandIndex;
  if (headerIndex >= page.headerCount) throw new TypeError('Slug band header exceeds its page');
  const header = texels.headers[headerIndex]!;
  const curveCount = Math.min(header >>> 16, MAX_SAFE_BAND_CURVES);
  const localReferenceOffset = header & 0xffff;
  let coverage = 0;
  let weight = 0;
  let evaluatedCurves = 0;

  for (let index = 0; index < curveCount; index += 1) {
    const referenceIndex = options.referenceBase + localReferenceOffset + index;
    if (referenceIndex >= page.referenceCount) {
      throw new TypeError('Slug band reference exceeds its page');
    }
    const curveTexel = options.curveBase + texels.references[referenceIndex]!;
    const curve = decodeCurve(texels.curves, page.curveWidth, page.curveHeight, curveTexel);
    const p0x = curve.p0x - options.renderX;
    const p0y = curve.p0y - options.renderY;
    const p1x = curve.p1x - options.renderX;
    const p1y = curve.p1y - options.renderY;
    const p2x = curve.p2x - options.renderX;
    const p2y = curve.p2y - options.renderY;
    const maximum =
      (options.axis === 'horizontal' ? Math.max(p0x, p1x, p2x) : Math.max(p0y, p1y, p2y)) * options.pixelsPerEm;
    if (maximum < -0.5) break;
    evaluatedCurves += 1;

    const polynomial0 = options.axis === 'horizontal' ? p0y : p0x;
    const polynomial1 = options.axis === 'horizontal' ? p1y : p1x;
    const polynomial2 = options.axis === 'horizontal' ? p2y : p2x;
    const rootCode = referenceRootCode(polynomial0, polynomial1, polynomial2);
    if (rootCode === 0) continue;
    const [root1, root2] =
      options.axis === 'horizontal'
        ? horizontalIntersections(p0x, p0y, p1x, p1y, p2x, p2y)
        : verticalIntersections(p0x, p0y, p1x, p1y, p2x, p2y);
    const firstRoot = root1 * options.pixelsPerEm;
    const secondRoot = root2 * options.pixelsPerEm;
    const hasFirst = (rootCode & 1) !== 0;
    const hasSecond = (rootCode & 0x100) !== 0;
    const firstContribution = hasFirst ? clamp01(firstRoot + 0.5) : 0;
    const secondContribution = hasSecond ? clamp01(secondRoot + 0.5) : 0;
    coverage +=
      options.axis === 'horizontal' ? firstContribution - secondContribution : secondContribution - firstContribution;
    weight = Math.max(
      weight,
      hasFirst ? clamp01(1 - Math.abs(firstRoot) * 2) : 0,
      hasSecond ? clamp01(1 - Math.abs(secondRoot) * 2) : 0,
    );
  }
  return { coverage, weight, evaluatedCurves };
}

function combinedCoverage(horizontal: BandResult, vertical: BandResult): number {
  const weighted =
    Math.abs(horizontal.coverage * horizontal.weight + vertical.coverage * vertical.weight) /
    Math.max(horizontal.weight + vertical.weight, MINIMUM_FOOTPRINT);
  return clamp01(Math.max(weighted, Math.min(Math.abs(horizontal.coverage), Math.abs(vertical.coverage))));
}

function referenceRootCode(first: number, second: number, third: number): number {
  const shift = (first < 0 ? 1 : 0) | (second < 0 ? 2 : 0) | (third < 0 ? 4 : 0);
  return (0x2e74 >>> shift) & 0x0101;
}

function stableRoots(a: number, b: number, c: number): readonly [number, number] {
  const discriminant = b * b - a * c;
  if (Math.abs(a) < MINIMUM_FOOTPRINT) {
    const root = c / (2 * b);
    return [root, root];
  }
  if (discriminant <= 0) {
    const root = b / a;
    return [root, root];
  }
  const distance = Math.sqrt(discriminant);
  const q = b + (b >= 0 ? distance : -distance);
  const rootA = q / a;
  const rootB = c / q;
  return b >= 0 ? [rootB, rootA] : [rootA, rootB];
}

function horizontalIntersections(
  p0x: number,
  p0y: number,
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
): readonly [number, number] {
  const [t1, t2] = stableRoots(p0y - 2 * p1y + p2y, p0y - p1y, p0y);
  const ax = p0x - 2 * p1x + p2x;
  const bx = p0x - p1x;
  return [(ax * t1 - bx * 2) * t1 + p0x, (ax * t2 - bx * 2) * t2 + p0x];
}

function verticalIntersections(
  p0x: number,
  p0y: number,
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
): readonly [number, number] {
  const [t1, t2] = stableRoots(p0x - 2 * p1x + p2x, p0x - p1x, p0x);
  const ay = p0y - 2 * p1y + p2y;
  const by = p0y - p1y;
  return [(ay * t1 - by * 2) * t1 + p0y, (ay * t2 - by * 2) * t2 + p0y];
}

function bindPageTexels(page: SlugPageData): SlugPageTexels {
  return {
    curves: uint16Texels(page.curveBytes, page.curveWidth * page.curveHeight * 4, 'Slug curve bytes'),
    headers: uint32Texels(page.headerBytes, page.headerWidth * page.headerHeight, 'Slug header bytes'),
    references: uint16Texels(page.referenceBytes, page.referenceWidth * page.referenceHeight, 'Slug reference bytes'),
  };
}

function uint16Texels(bytes: Uint8Array, texels: number, label: string): Uint16Array {
  if (bytes.byteLength !== texels * 2) throw new TypeError(`${label} do not match their declared dimensions`);
  const aligned = bytes.byteOffset % 2 === 0 ? bytes : bytes.slice();
  return new Uint16Array(aligned.buffer, aligned.byteOffset, texels);
}

function uint32Texels(bytes: Uint8Array, texels: number, label: string): Uint32Array {
  if (bytes.byteLength !== texels * 4) throw new TypeError(`${label} do not match their declared dimensions`);
  const aligned = bytes.byteOffset % 4 === 0 ? bytes : bytes.slice();
  return new Uint32Array(aligned.buffer, aligned.byteOffset, texels);
}

function decodeCurve(
  texels: Uint16Array,
  width: number,
  height: number,
  texel: number,
): {
  readonly p0x: number;
  readonly p0y: number;
  readonly p1x: number;
  readonly p1y: number;
  readonly p2x: number;
  readonly p2y: number;
} {
  if (texel < 0 || texel + 1 >= width * height) {
    throw new TypeError('Slug curve reference exceeds its page');
  }
  const first = texel * 4;
  const second = (texel + 1) * 4;
  return {
    p0x: halfToFloat(texels[first]!),
    p0y: halfToFloat(texels[first + 1]!),
    p1x: halfToFloat(texels[first + 2]!),
    p1y: halfToFloat(texels[first + 3]!),
    p2x: halfToFloat(texels[second]!),
    p2y: halfToFloat(texels[second + 1]!),
  };
}

function halfToFloat(value: number): number {
  const sign = (value & 0x8000) === 0 ? 1 : -1;
  const exponent = (value >>> 10) & 0x1f;
  const fraction = value & 0x03ff;
  if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
  if (exponent === 0x1f) return fraction === 0 ? sign * Infinity : Number.NaN;
  return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
}

function clampedBandIndex(value: number, count: number): number {
  return Math.trunc(Math.min(count - 1, Math.max(0, value)));
}

function assertLayoutArrays(layout: ParagraphLayout): void {
  const count = layout.glyphIds.length;
  if (
    layout.glyphFontSlots.length !== count ||
    layout.glyphFontSizes.length !== count ||
    layout.x.length !== count ||
    layout.y.length !== count
  ) {
    throw new TypeError('Slug CPU reference requires parallel paragraph glyph arrays');
  }
  for (let index = 0; index < count; index += 1) {
    finite(layout.x[index]!, 'Slug CPU reference glyph X');
    finite(layout.y[index]!, 'Slug CPU reference glyph Y');
  }
}

function pixelBounds(left: number, top: number, right: number, bottom: number): SlugCpuReferenceBounds {
  return {
    minX: Math.ceil(left - 0.5),
    minY: Math.ceil(top - 0.5),
    maxX: Math.ceil(right - 0.5) - 1,
    maxY: Math.ceil(bottom - 0.5) - 1,
  };
}

function clippedPixelBounds(
  bounds: SlugCpuReferenceBounds,
  width: number,
  height: number,
): SlugCpuReferenceBounds | undefined {
  const minX = Math.max(0, bounds.minX);
  const minY = Math.max(0, bounds.minY);
  const maxX = Math.min(width - 1, bounds.maxX);
  const maxY = Math.min(height - 1, bounds.maxY);
  return minX > maxX || minY > maxY ? undefined : { minX, minY, maxX, maxY };
}

function unionBounds(
  current: SlugCpuReferenceBounds | undefined,
  next: SlugCpuReferenceBounds,
): SlugCpuReferenceBounds {
  if (current === undefined) return next;
  return {
    minX: Math.min(current.minX, next.minX),
    minY: Math.min(current.minY, next.minY),
    maxX: Math.max(current.maxX, next.maxX),
    maxY: Math.max(current.maxY, next.maxY),
  };
}

function compositeFill(
  pixels: Uint8Array,
  offset: number,
  fill: readonly [number, number, number, number],
  coverage: number,
): void {
  const sourceAlpha = fill[3] * coverage;
  const destinationScale = 1 - sourceAlpha;
  pixels[offset] = byte(fill[0] * sourceAlpha * 255 + pixels[offset]! * destinationScale);
  pixels[offset + 1] = byte(fill[1] * sourceAlpha * 255 + pixels[offset + 1]! * destinationScale);
  pixels[offset + 2] = byte(fill[2] * sourceAlpha * 255 + pixels[offset + 2]! * destinationScale);
}

function opaqueBlack(width: number, height: number): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  for (let offset = 3; offset < pixels.byteLength; offset += 4) pixels[offset] = 255;
  return pixels;
}

function linearColor(color: readonly [number, number, number, number]): readonly [number, number, number, number] {
  if (color.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
    throw new TypeError('Slug CPU reference fill must contain four linear values in [0, 1]');
  }
  return color;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function byte(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
  return value;
}

function positiveFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be positive`);
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer`);
  }
  return value;
}

function nonnegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer`);
  }
  return value;
}
