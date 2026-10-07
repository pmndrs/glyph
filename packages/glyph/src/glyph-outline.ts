/**
 * One glyph's outline as raw columns, in em units (1 is the font size) with y down and the origin at the glyph's pen
 * position on the baseline, like every box the layout publishes. Place a point at `glyph.x + x * glyph.fontSize`,
 * `glyph.y + y * glyph.fontSize`. Outlines with equal `fontHandle` and `glyphId` are identical, so a caller can cache
 * one shape per key and reuse it at every placement and size.
 *
 * A font decodes every outline once, when it loads. From `withGlyphs`, the typed arrays are views over that decoded
 * data: treat them as valid only inside that callback, and copy them (`points.slice()` and so on) to keep an outline.
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

/**
 * @internal Why a font has no decoded outlines to read: its artifact carries none, or its load skipped decoding the
 * ones it carries (`outlines: 'skip'`).
 */
export type GlyphOutlineAbsence = 'unbaked' | 'skipped';

/** @internal The error a glyph read reports when its font has no decoded outlines. Outlines are optional. */
export function missingGlyphOutlinesError(absence: GlyphOutlineAbsence): TypeError {
  return new TypeError(
    absence === 'skipped'
      ? "font outlines were skipped when it loaded; load it with outlines: 'auto' or 'require' to read them"
      : 'font was baked without outlines; outlines need a font prebaked with glyph bake --outlines',
  );
}

/**
 * @internal Every glyph outline of one font, decoded once when the font loads: the columns of every glyph's
 * `GlyphOutlineView` back to back, and per glyph its first point, first contour, contour count, first segment, and
 * segment count. Owned reads build each glyph's frozen tuples once and share them.
 */
export interface GlyphOutlineStore {
  readonly points: Float32Array;
  readonly contourEnds: Uint32Array;
  readonly segmentLines: Uint8Array;
  readonly glyphs: Uint32Array;
  readonly contours: (readonly GlyphOutlineContour[] | undefined)[];
}

const glyphRecordWords = 5;

/** @internal Appends decoded glyph outlines, in glyph ID order, into one `GlyphOutlineStore`. */
export class GlyphOutlineStoreBuilder {
  readonly #glyphs: Uint32Array;
  #points = new Float32Array(1024);
  #contourEnds = new Uint32Array(256);
  #segmentLines = new Uint8Array(512);
  #pointCount = 0;
  #contourCount = 0;
  #segmentCount = 0;
  #glyphCount = 0;

  constructor(glyphCount: number) {
    this.#glyphs = new Uint32Array(glyphCount * glyphRecordWords);
  }

  append({ points, contourEnds, segmentLines }: GlyphOutlineView): void {
    const record = this.#glyphCount++ * glyphRecordWords;
    this.#glyphs[record] = this.#pointCount;
    this.#glyphs[record + 1] = this.#contourCount;
    this.#glyphs[record + 2] = contourEnds.length;
    this.#glyphs[record + 3] = this.#segmentCount;
    this.#glyphs[record + 4] = segmentLines.length;
    this.#points = grown(this.#points, 2 * this.#pointCount + points.length);
    this.#points.set(points, 2 * this.#pointCount);
    this.#pointCount += points.length / 2;
    this.#contourEnds = grown(this.#contourEnds, this.#contourCount + contourEnds.length);
    this.#contourEnds.set(contourEnds, this.#contourCount);
    this.#contourCount += contourEnds.length;
    this.#segmentLines = grown(this.#segmentLines, this.#segmentCount + segmentLines.length);
    this.#segmentLines.set(segmentLines, this.#segmentCount);
    this.#segmentCount += segmentLines.length;
  }

  finish(): GlyphOutlineStore {
    return {
      points: this.#points.slice(0, 2 * this.#pointCount),
      contourEnds: this.#contourEnds.slice(0, this.#contourCount),
      segmentLines: this.#segmentLines.slice(0, this.#segmentCount),
      glyphs: this.#glyphs,
      contours: new Array<readonly GlyphOutlineContour[] | undefined>(this.#glyphCount),
    };
  }
}

function grown<Column extends Float32Array | Uint32Array | Uint8Array>(column: Column, length: number): Column {
  if (length <= column.length) return column;
  const next = new (column.constructor as new (length: number) => Column)(Math.max(length, 2 * column.length));
  next.set(column);
  return next;
}

/** @internal Fills `target` with views over glyph `glyphId`'s slice of `store`. */
export function viewStoredGlyphOutline(
  store: GlyphOutlineStore,
  fontHandle: number,
  glyphId: number,
  target: GlyphOutlineView,
): GlyphOutlineView {
  const record = glyphId * glyphRecordWords;
  const glyphs = store.glyphs;
  const [point, contour, contours, segment, segments] = [
    glyphs[record]!,
    glyphs[record + 1]!,
    glyphs[record + 2]!,
    glyphs[record + 3]!,
    glyphs[record + 4]!,
  ];
  target.fontHandle = fontHandle;
  target.glyphId = glyphId;
  target.points = store.points.subarray(2 * point, 2 * (point + 2 * segments + contours));
  target.contourEnds = store.contourEnds.subarray(contour, contour + contours);
  target.segmentLines = store.segmentLines.subarray(segment, segment + segments);
  return target;
}

/** @internal Glyph `glyphId`'s frozen curve tuples, built on first read and shared by every later one. */
export function storedGlyphOutline(store: GlyphOutlineStore, glyphId: number): readonly GlyphOutlineContour[] {
  let contours = store.contours[glyphId];
  if (contours === undefined) {
    const view = viewStoredGlyphOutline(store, 0, glyphId, {
      fontHandle: 0,
      glyphId,
      points: store.points,
      contourEnds: store.contourEnds,
      segmentLines: store.segmentLines,
    });
    contours = Object.freeze(
      glyphOutlineContours(view).map((curves) => Object.freeze(curves.map((curve) => Object.freeze(curve)))),
    );
    store.contours[glyphId] = contours;
  }
  return contours;
}

/** @internal Copies a view into caller-owned curve tuples. */
export function glyphOutlineContours({ points, contourEnds, segmentLines }: GlyphOutlineView): GlyphOutlineContour[] {
  const contours: GlyphOutlineContour[] = [];
  let segment = 0;
  for (let contour = 0; contour < contourEnds.length; contour += 1) {
    const curves: GlyphOutlineCurve[] = [];
    for (const end = contourEnds[contour]!; segment < end; segment += 1) {
      const at = 2 * (2 * segment + contour);
      curves.push([
        points[at]!,
        points[at + 1]!,
        points[at + 2]!,
        points[at + 3]!,
        points[at + 4]!,
        points[at + 5]!,
        segmentLines[segment] === 1,
      ]);
    }
    contours.push(curves);
  }
  return contours;
}
