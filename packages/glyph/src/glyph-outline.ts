import type { BorrowedGlyph } from './layout.js';

/** One quadratic curve ordered as start, control, end, in the coordinate space of the call that returned it. */
export type GlyphOutlineCurve = readonly [x0: number, y0: number, x1: number, y1: number, x2: number, y2: number];

/** One closed contour: each curve starts where the previous one ended, and the last ends where the first started. */
export type GlyphOutlineContour = readonly GlyphOutlineCurve[];

/** @internal */
export function readGlyphOutline(
  encoded: Uint8Array,
  unitsPerEm: number,
  glyph: Pick<BorrowedGlyph, 'x' | 'y' | 'fontSize'>,
): GlyphOutlineContour[] {
  const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);
  const contourCount = view.getUint32(0, true);
  const pointsOffset = 4 + contourCount * 4;
  const scale = glyph.fontSize / unitsPerEm;
  const x = (point: number) => glyph.x + view.getFloat32(pointsOffset + point * 8, true) * scale;
  const y = (point: number) => glyph.y - view.getFloat32(pointsOffset + point * 8 + 4, true) * scale;

  const outline: GlyphOutlineContour[] = [];
  let start = 0;
  for (let contour = 0; contour < contourCount; contour += 1) {
    const end = view.getUint32(4 + contour * 4, true);
    const curves: GlyphOutlineCurve[] = [];
    for (let point = start; point + 2 < end; point += 2) {
      curves.push([x(point), y(point), x(point + 1), y(point + 1), x(point + 2), y(point + 2)]);
    }
    outline.push(curves);
    start = end;
  }
  return outline;
}
