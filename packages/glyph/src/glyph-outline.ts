/**
 * One glyph's outline as raw columns, in em units (1 is the font size) with y down and the origin at the glyph's pen
 * position on the baseline, like every box the layout publishes. Place a point at `glyph.x + x * glyph.fontSize`,
 * `glyph.y + y * glyph.fontSize`. Outlines with equal `fontHandle` and `glyphId` are identical, so a caller can cache
 * one shape per key and reuse it at every placement and size.
 *
 * From `withGlyphs`, the typed arrays are views over engine memory: they are valid only inside that callback, until the
 * next `outlineAt()` or other engine call. Copy them (`points.slice()` and so on) to keep an outline.
 */
export interface GlyphOutlineView {
  /** The font that shaped the glyph. */
  fontHandle: number;
  /** The glyph's ID in that font. */
  glyphId: number;
  /**
   * `x, y` pairs, endpoint-shared: segment `s` of contour `c` starts at point `2s + c`, has its control at
   * `2s + c + 1`, and ends at `2s + c + 2`, which also starts the next segment. A contour's last point repeats its
   * first. A line keeps its midpoint as its control, so code that ignores `segmentLines` still draws it.
   */
  points: Float32Array;
  /** The exclusive end of each closed contour, as a segment index. The last entry is the segment count. */
  contourEnds: Uint32Array;
  /** One entry per segment: `1` for a straight line, `0` for a quadratic curve. */
  segmentLines: Uint8Array;
}

/**
 * One segment in em units, y down, origin at the glyph's pen position on the baseline: start, control, end, and
 * whether it is a straight line, whose control is then its midpoint.
 */
export type GlyphOutlineCurve = readonly [
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x1: number,
  y1: number,
  isLine: boolean,
];

/** One closed contour: each curve starts where the previous one ended, and the last ends where the first started. */
export type GlyphOutlineContour = readonly GlyphOutlineCurve[];

/**
 * @internal Fills `target` with views over one decode result the text shaper wrote at `pointer`: little-endian words
 * holding the contour count, the segment count, the contour ends, the `f32` points, then one byte per segment.
 */
export function viewGlyphOutline(
  memory: ArrayBuffer,
  pointer: number,
  fontHandle: number,
  glyphId: number,
  target: GlyphOutlineView,
): GlyphOutlineView {
  const header = new Uint32Array(memory, pointer, 2);
  const contourCount = header[0]!;
  const segmentCount = header[1]!;
  const pointsOffset = pointer + 8 + contourCount * 4;
  const pointCount = 2 * segmentCount + contourCount;
  target.fontHandle = fontHandle;
  target.glyphId = glyphId;
  target.contourEnds = new Uint32Array(memory, pointer + 8, contourCount);
  target.points = new Float32Array(memory, pointsOffset, pointCount * 2);
  target.segmentLines = new Uint8Array(memory, pointsOffset + pointCount * 8, segmentCount);
  return target;
}
