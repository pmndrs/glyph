import type { ParagraphLayout } from '@pmndrs/text';
import type { SlugResource } from '@pmndrs/text/raster/slug';
import * as THREE from 'three/webgpu';
import { describe, expect, it } from 'vitest';

import { renderFlatSlugCpuReference } from './slug-cpu-reference';

describe('conformance flat Slug CPU reference', () => {
  it('reconstructs an exact quadratic square at physical pixel centers', () => {
    const result = renderFlatSlugCpuReference(squareResource(), specimenLayout(), {
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
    const result = renderFlatSlugCpuReference(squareResource(), layout, {
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

  it('skips canonical absent records and rejects malformed texture storage', () => {
    const absent = squareResource();
    new DataView(absent.records.buffer).setUint16(8, 0xffff, true);
    expect(renderFlatSlugCpuReference(absent, specimenLayout(), { width: 4, height: 4 })).toMatchObject({
      glyphCount: 0,
      bounds: undefined,
      evaluatedCurves: 0,
    });

    const malformed = squareResource();
    Object.defineProperty(malformed.pages[0]!.curveTexture.image, 'data', {
      value: new Uint16Array(3),
    });
    expect(() => renderFlatSlugCpuReference(malformed, specimenLayout(), { width: 4, height: 4 })).toThrow(
      'curve texture length',
    );
  });
});

function squareResource(): SlugResource {
  const records = new Uint8Array(40);
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
  const references = Uint32Array.from([2 | (0 << 16), 4 | (6 << 16), 2 | (4 << 16), 6 | (0 << 16)]);
  const curveTexture = new THREE.DataTexture(curves, 8, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  const headerTexture = new THREE.DataTexture(headers, 2, 1, THREE.RedIntegerFormat, THREE.UnsignedIntType);
  const referenceTexture = new THREE.DataTexture(references, 4, 1, THREE.RedIntegerFormat, THREE.UnsignedIntType);
  return {
    planeUnitsPerEm: 2048,
    records,
    pages: [
      {
        curveTexture,
        curveWidth: 8,
        curveHeight: 1,
        headerTexture,
        headerWidth: 2,
        headerHeight: 1,
        headerCount: 2,
        referenceTexture,
        referenceWidth: 4,
        referenceHeight: 1,
        referenceCount: 8,
        gpuBytes: curves.byteLength + headers.byteLength + references.byteLength,
      },
    ],
    gpuBytes: curves.byteLength + headers.byteLength + references.byteLength,
  };
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
