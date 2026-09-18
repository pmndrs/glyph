import type { Font } from './font.js';
import { immutableFontResources } from './loaded-font.js';
import { SLUG_GLYPH_RECORD_STRIDE } from './internal/slug-contract.js';
import { slug } from './raster/slug.js';

/** One rendered quadratic in em units with y up, ordered as start, control, end. */
export type SlugCurve = readonly [x0: number, y0: number, x1: number, y1: number, x2: number, y2: number];

/**
 * Copies a glyph's rendered Slug curves in packing order. Blank glyphs return an empty array.
 * The result owns its coordinates and survives font disposal. This reads the quantized raster,
 * not source outlines or contour topology. Call during preparation rather than every frame.
 */
export function getSlugGlyphCurves(font: Font<typeof slug>, glyphId: number): SlugCurve[] {
  const { data } = immutableFontResources(font);
  if (font.raster !== slug) throw new TypeError('font must use the Slug raster format');
  if (!Number.isSafeInteger(glyphId) || glyphId < 0 || glyphId >= font.glyphCount) {
    throw new RangeError('glyphId must identify a glyph in this font');
  }

  const records = new DataView(data.records.buffer, data.records.byteOffset, data.records.byteLength);
  const record = glyphId * SLUG_GLYPH_RECORD_STRIDE;
  const pageIndex = records.getUint16(record + 8, true);
  if (pageIndex === 0xffff) return [];

  const page = data.pages[pageIndex]!;
  const references = new DataView(
    page.referenceBytes.buffer,
    page.referenceBytes.byteOffset,
    page.referenceBytes.byteLength,
  );
  const base = records.getUint32(record + 16, true);
  const referenceBase = records.getUint32(record + 32, true);
  const referenceCount = records.getUint32(record + 36, true);
  const offsets = new Set<number>();
  for (let index = 0; index < referenceCount; index++) {
    offsets.add(references.getUint16((referenceBase + index) * 2, true));
  }

  const curves = new DataView(page.curveBytes.buffer, page.curveBytes.byteOffset, page.curveBytes.byteLength);
  return [...offsets]
    .sort((a, b) => a - b)
    .map((offset): SlugCurve => {
      const byte = (base + offset) * 8;
      return [
        curves.getFloat16(byte, true),
        curves.getFloat16(byte + 2, true),
        curves.getFloat16(byte + 4, true),
        curves.getFloat16(byte + 6, true),
        curves.getFloat16(byte + 8, true),
        curves.getFloat16(byte + 10, true),
      ];
    });
}
