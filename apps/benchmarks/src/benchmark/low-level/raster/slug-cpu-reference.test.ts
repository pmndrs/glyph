import { defineRasterResourceId, type ParagraphLayout } from '@pmndrs/glyph';
import { SLUG_GLYPH_RECORD_STRIDE, type SlugData, type SlugPageData } from '@pmndrs/glyph/raster/slug';
import { describe, expect, it } from 'vitest';

import { renderFlatSlugCpuReference } from './slug-cpu-reference';

describe('conformance flat Slug CPU reference', () => {
  it('reconstructs an exact quadratic square at physical pixel centers', () => {
    const result = renderFlatSlugCpuReference(squareData(), specimenLayout(), {
      width: 4,
      height: 4,
    });

    expect(result.bounds).toEqual({ minX: 0, minY: 0, maxX: 3, maxY: 3 });
    expect(result.unclippedBounds).toEqual({ minX: -1, minY: -1, maxX: 3, maxY: 3 });
    expect(result.glyphCount).toBe(1);
    expect(result.evaluatedCurves).toBeGreaterThan(0);
    expect(redRows(result.pixels, 4)).toEqual([
      [255, 255, 255, 255],
      [255, 255, 255, 255],
      [255, 255, 255, 255],
      [255, 255, 255, 255],
    ]);
  });

  it('clips the half-pixel dilation bounds and composites overlapping glyphs', () => {
    const layout = specimenLayout({
      glyphIds: new Uint16Array([0, 0]),
      glyphFontSlots: new Uint16Array([0, 0]),
      glyphFontSizes: new Float32Array([4, 4]),
      x: new Float32Array([-1, 1]),
      y: new Float32Array([4, 4]),
    });
    const result = renderFlatSlugCpuReference(squareData(), layout, {
      width: 4,
      height: 4,
      fill: [1, 1, 1, 0.5],
    });

    expect(result.bounds).toEqual({ minX: 0, minY: 0, maxX: 3, maxY: 3 });
    expect(result.unclippedBounds).toEqual({ minX: -2, minY: -1, maxX: 4, maxY: 3 });
    expect(result.glyphCount).toBe(2);
    expect(redRows(result.pixels, 4)).toEqual([
      [128, 192, 192, 128],
      [128, 192, 192, 128],
      [128, 192, 192, 128],
      [128, 192, 192, 128],
    ]);
  });

  it('skips canonical absent records and rejects malformed page storage', () => {
    const absent = squareData();
    new DataView(absent.records.buffer).setUint16(8, 0xffff, true);
    expect(renderFlatSlugCpuReference(absent, specimenLayout(), { width: 4, height: 4 })).toMatchObject({
      glyphCount: 0,
      bounds: undefined,
      evaluatedCurves: 0,
    });

    const data = squareData();
    const malformed = { ...data, pages: [{ ...data.pages[0]!, curveBytes: new Uint8Array(6) }] };
    expect(() => renderFlatSlugCpuReference(malformed, specimenLayout(), { width: 4, height: 4 })).toThrow(
      'Slug curve bytes',
    );
  });
});

function squareData(): SlugData {
  const records = new Uint8Array(SLUG_GLYPH_RECORD_STRIDE);
  const record = new DataView(records.buffer);
  record.setInt16(0, 0, true);
  record.setInt16(2, 0, true);
  record.setInt16(4, 2048, true);
  record.setInt16(6, 2048, true);
  record.setUint16(8, 0, true);
  record.setUint16(10, 1, true);
  record.setUint16(12, 1, true);
  record.setUint32(16, 0, true);
  record.setUint32(20, 8, true);
  record.setUint32(24, 0, true);
  record.setUint32(28, 1, true);
  record.setUint32(32, 0, true);
  record.setUint32(36, 8, true);

  const curves = Uint16Array.from([
    ...curve(0, 0, 0.5, 0, 1, 0),
    ...curve(1, 0, 1, 0.5, 1, 1),
    ...curve(1, 1, 0.5, 1, 0, 1),
    ...curve(0, 1, 0, 0.5, 0, 0),
  ]);
  const headers = Uint32Array.from([(4 << 16) | 0, (4 << 16) | 4]);
  const references = Uint16Array.from([2, 0, 4, 6, 2, 4, 6, 0]);
  const page: SlugPageData = {
    resource: defineRasterResourceId('pmndrs.slug/test/square/0'),
    curveWidth: 8,
    curveHeight: 1,
    curveBytes: bytes(curves),
    headerCount: 2,
    headerWidth: 2,
    headerHeight: 1,
    headerBytes: bytes(headers),
    referenceCount: 8,
    referenceWidth: 8,
    referenceHeight: 1,
    referenceBytes: bytes(references),
  };
  return {
    planeUnitsPerEm: 2048,
    records,
    pages: [page],
  };
}

function bytes(texels: Uint16Array | Uint32Array): Uint8Array {
  return new Uint8Array(texels.buffer, texels.byteOffset, texels.byteLength);
}

function curve(p0x: number, p0y: number, p1x: number, p1y: number, p2x: number, p2y: number): readonly number[] {
  return [half(p0x), half(p0y), half(p1x), half(p1y), half(p2x), half(p2y), 0, 0];
}

function half(value: number): number {
  if (value === 0) return 0;
  if (value === 0.5) return 0x3800;
  if (value === 1) return 0x3c00;
  throw new RangeError(`unsupported test half-float value ${value}`);
}

function specimenLayout(
  overrides: Partial<Pick<ParagraphLayout, 'glyphIds' | 'glyphFontSlots' | 'glyphFontSizes' | 'x' | 'y'>> = {},
): ParagraphLayout {
  const glyphCount = overrides.glyphIds?.length ?? 1;
  return {
    width: 4,
    height: 4,
    contentWidth: 4,
    contentHeight: 4,
    ascent: 2,
    descent: 2,
    lineHeight: 4,
    inkBounds: undefined,
    firstBaseline: 2,
    lastBaseline: 2,
    overflowed: false,
    fontHandles: new Uint32Array([1]),
    glyphFontSlots: overrides.glyphFontSlots ?? new Uint16Array([0]),
    glyphIds: overrides.glyphIds ?? new Uint16Array([0]),
    clusters: new Uint32Array(glyphCount),
    glyphFontSizes: overrides.glyphFontSizes ?? new Float32Array([4]),
    x: overrides.x ?? new Float32Array([0]),
    y: overrides.y ?? new Float32Array([4]),
    glyphAdvances: new Float32Array(glyphCount),
    glyphInkX: new Float32Array(glyphCount),
    glyphInkY: new Float32Array(glyphCount),
    glyphInkWidths: new Float32Array(glyphCount),
    glyphInkHeights: new Float32Array(glyphCount),
    glyphFlags: new Uint16Array(glyphCount),
    lineTextStarts: new Uint32Array([0]),
    lineTextEnds: new Uint32Array([1]),
    lineGlyphStarts: new Uint32Array([0]),
    lineGlyphCounts: new Uint32Array([glyphCount]),
    lineBaselines: new Float32Array([2]),
    lineAdvances: new Float32Array([4]),
  };
}

function redRows(pixels: Uint8Array, width: number): readonly (readonly number[])[] {
  const rows: number[][] = [];
  for (let offset = 0; offset < pixels.byteLength; offset += width * 4) {
    const row: number[] = [];
    for (let column = 0; column < width; column += 1) row.push(pixels[offset + column * 4]!);
    rows.push(row);
  }
  return rows;
}
