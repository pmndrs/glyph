import type { LayoutBox, GlyphLayoutInspection } from './layout.js';

/** Coordinate space for every position/box in a `GlyphPlacements` snapshot: paragraph-local units, origin top-left, +X right, +Y down — the space the engine positions glyphs in. */
export type GlyphSpace = 'paragraph';

/** Identity of one glyph within a paragraph. Survives a reflow that moves glyphs (content box, size, anchor, DPR, transform); does not survive one that reshapes them (text, font, language, direction, features). */
export type GlyphKey = string & { readonly __glyphKey: unique symbol };

/** One glyph's placement. `x`/`y` are the pair a manipulation writes; everything else describes it. */
export interface GlyphPlacement {
  readonly key: GlyphKey;
  /** Position among the paragraph's glyphs, in the engine's visual order. */
  readonly index: number;
  /** UTF-16 offset of the source cluster this glyph belongs to. */
  readonly cluster: number;
  /** Resolved Unicode bidi embedding level; odd levels run right-to-left. */
  readonly bidiLevel: number;
  /** Index into `GlyphPlacements.lines`. */
  readonly line: number;
  /** Index into `GlyphPlacements.words`. */
  readonly word: number;
  readonly fontSize: number;
  /** Shaped advance: the distance the pen moved. Not the ink width and not the font size. */
  readonly advance: number;
  /** Origin in the prepared layout. A manipulation never changes it. */
  readonly shapedX: number;
  readonly shapedY: number;
  /** Accepted renderer origin when current; otherwise the prepared layout origin. */
  readonly x: number;
  readonly y: number;
  /** Ink box of the glyph as currently placed. A glyph with no outline reports zero extents. */
  readonly ink: LayoutBox;
  /** Advance box of the glyph as currently placed: `advance` wide, its line's box tall. */
  readonly bounds: LayoutBox;
}

/** A run of glyphs addressed as one unit — a word or line, whichever a reader perceives moving together. */
export interface GlyphRun {
  readonly kind: 'word' | 'line';
  readonly index: number;
  /** Glyph span, as indices into `GlyphPlacements.glyphs`. */
  readonly glyphStart: number;
  readonly glyphCount: number;
  readonly glyphs: readonly GlyphPlacement[];
  /** UTF-16 offsets this run covers. */
  readonly textStart: number;
  readonly textEnd: number;
  /** Advance box of the run as currently placed. Use it for flow-accurate motion. */
  readonly bounds: LayoutBox;
  /** Ink box of the run as currently placed. Use it to scale or rotate about what the eye sees. */
  readonly ink: LayoutBox;
}

/** A line run, with the vertical metrics that let a caller align to its baseline. */
export interface GlyphLine extends GlyphRun {
  readonly kind: 'line';
  /** Distance from the paragraph box's top edge to this line's baseline. */
  readonly baseline: number;
  readonly ascent: number;
  readonly descent: number;
  readonly lineHeight: number;
}

/** Read-only view of one paragraph's prepared layout, addressed as glyphs, words, and lines. Detached `Glyphs` owns subsequent manipulation. */
export interface GlyphPlacements {
  /** Every position and box below is in this space. No value in this snapshot is from another. */
  readonly space: GlyphSpace;
  /** The prepared layout these placements describe, retained with the snapshot. */
  readonly layout: GlyphLayoutInspection;
  readonly glyphs: readonly GlyphPlacement[];
  /** Runs of non-whitespace glyphs, split at every line boundary. See `wordsOf` for the exact rule. */
  readonly words: readonly GlyphRun[];
  readonly lines: readonly GlyphLine[];
  /** Glyphs with no retained render record — typically ones the font gives no outline for, like spaces — so `x`/`y` hold the shaped origin and a write to them cannot land. */
  readonly incomplete: readonly number[];
}

const EMPTY_BOX: LayoutBox = Object.freeze({ x: 0, y: 0, width: 0, height: 0 });

/** Presentation word-boundary rule (not the engine's cluster grid) — stated in full rather than deferred to a host segmenter. Scripts without spaces yield one word per line; use `glyphs` for per-character motion there. */
function isWordSeparator(code: number): boolean {
  return (
    code === 0x20 ||
    code === 0x09 ||
    code === 0x0a ||
    code === 0x0b ||
    code === 0x0c ||
    code === 0x0d ||
    code === 0x85 ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000
  );
}

function box(x: number, y: number, width: number, height: number): LayoutBox {
  return Object.freeze({ x, y, width, height });
}

/** Union of two boxes. A zero-extent box still contributes its position. */
function unionBox(left: LayoutBox | undefined, right: LayoutBox): LayoutBox {
  if (left === undefined) return right;
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  return box(
    x,
    y,
    Math.max(left.x + left.width, right.x + right.width) - x,
    Math.max(left.y + left.height, right.y + right.height) - y,
  );
}

/**
 * Builds the placement snapshot for one package-produced inspection and its source text. `displayedX`/`displayedY`
 * are drawn origins from retained records; `incomplete` names glyphs whose record was missing. The inspection remains
 * caller-owned and must not be mutated after construction.
 */
export function createGlyphPlacements(
  layout: GlyphLayoutInspection,
  text: string,
  displayedX: Float32Array,
  displayedY: Float32Array,
  incomplete: readonly number[],
): GlyphPlacements {
  const glyphCount = layout.glyphCount;
  if (displayedX.length !== glyphCount || displayedY.length !== glyphCount) {
    throw new RangeError('drawn glyph origins do not match the inspected glyph count');
  }
  const lineOfGlyph = new Uint32Array(glyphCount);
  for (let lineIndex = 0; lineIndex < layout.lineCount; lineIndex += 1) {
    const start = layout.lineGlyphStarts[lineIndex]!;
    const end = start + layout.lineGlyphCounts[lineIndex]!;
    for (let index = start; index < end && index < glyphCount; index += 1) lineOfGlyph[index] = lineIndex;
  }

  const clusterEnds = clusterEndsOf(layout, text.length);
  const wordOfGlyph = new Int32Array(glyphCount).fill(-1);
  const wordSpans = wordsOf(layout, text, lineOfGlyph, wordOfGlyph, clusterEnds);

  const glyphs: GlyphPlacement[] = [];
  const keyCounts = new Map<string, number>();
  for (let index = 0; index < glyphCount; index += 1) {
    const fontHandle = layout.fontHandles[layout.glyphFontSlots[index]!]!;
    const cluster = layout.clusters[index]!;
    const base = `${fontHandle}:${layout.glyphIds[index]!}:${cluster}`;
    const occurrence = keyCounts.get(base) ?? 0;
    keyCounts.set(base, occurrence + 1);
    glyphs.push(
      glyphPlacement(
        layout,
        index,
        `${base}:${occurrence}` as GlyphKey,
        cluster,
        layout.glyphBidiLevels[index]!,
        lineOfGlyph[index]!,
        wordOfGlyph[index]!,
        displayedX[index]!,
        displayedY[index]!,
      ),
    );
  }

  const lines = layout.lines.map((metrics) =>
    glyphRun(
      'line',
      metrics.index,
      metrics.glyphStart,
      metrics.glyphCount,
      metrics.textStart,
      metrics.textEnd,
      glyphs,
      {
        baseline: metrics.baseline,
        ascent: metrics.ascent,
        descent: metrics.descent,
        lineHeight: metrics.lineHeight,
      },
    ),
  ) as GlyphLine[];
  const words = wordSpans.map((span, index) =>
    glyphRun('word', index, span.glyphStart, span.glyphCount, span.textStart, span.textEnd, glyphs, undefined),
  );

  const placements: GlyphPlacements = {
    space: 'paragraph',
    layout,
    glyphs: Object.freeze(glyphs) as readonly GlyphPlacement[],
    words: Object.freeze(words),
    lines: Object.freeze(lines),
    incomplete: Object.freeze([...incomplete]),
  };
  return Object.freeze(placements);
}

function glyphPlacement(
  layout: GlyphLayoutInspection,
  index: number,
  key: GlyphKey,
  cluster: number,
  bidiLevel: number,
  line: number,
  word: number,
  drawnX: number,
  drawnY: number,
): GlyphPlacement {
  const shapedX = layout.x[index]!;
  const shapedY = layout.y[index]!;
  const advance = layout.glyphAdvances[index]!;
  // Ink is published in paragraph space around the SHAPED origin, so a moved glyph carries its ink
  // by the same delta. Storing the offset rather than the absolute box is what keeps `ink` correct
  // after a manipulation without a second engine query.
  const inkOffsetX = layout.glyphInkX[index]! - shapedX;
  const inkOffsetY = layout.glyphInkY[index]! - shapedY;
  const inkWidth = layout.glyphInkWidths[index]!;
  const inkHeight = layout.glyphInkHeights[index]!;
  const metrics = layout.lines[line];
  const ascent = metrics?.ascent ?? 0;
  const lineHeight = metrics?.lineHeight ?? 0;
  return {
    key,
    index,
    cluster,
    bidiLevel,
    line,
    word,
    fontSize: layout.glyphFontSizes[index]!,
    advance,
    shapedX,
    shapedY,
    x: drawnX,
    y: drawnY,
    get ink(): LayoutBox {
      return box(this.x + inkOffsetX, this.y + inkOffsetY, inkWidth, inkHeight);
    },
    get bounds(): LayoutBox {
      return box(this.x, this.y - ascent, advance, lineHeight);
    },
  };
}

function glyphRun(
  kind: 'word' | 'line',
  index: number,
  glyphStart: number,
  glyphCount: number,
  textStart: number,
  textEnd: number,
  all: readonly GlyphPlacement[],
  lineMetrics: Readonly<{ baseline: number; ascent: number; descent: number; lineHeight: number }> | undefined,
): GlyphRun {
  const glyphs = all.slice(glyphStart, glyphStart + glyphCount);
  const run = {
    kind,
    index,
    glyphStart,
    glyphCount,
    glyphs: Object.freeze(glyphs) as readonly GlyphPlacement[],
    textStart,
    textEnd,
    get bounds(): LayoutBox {
      let bounds: LayoutBox | undefined;
      for (const glyph of glyphs) bounds = unionBox(bounds, glyph.bounds);
      return bounds ?? EMPTY_BOX;
    },
    get ink(): LayoutBox {
      let bounds: LayoutBox | undefined;
      for (const glyph of glyphs) bounds = unionBox(bounds, glyph.ink);
      return bounds ?? EMPTY_BOX;
    },
  };
  return lineMetrics === undefined ? run : Object.assign(run, lineMetrics);
}

interface WordSpan {
  readonly glyphStart: number;
  readonly glyphCount: number;
  readonly textStart: number;
  readonly textEnd: number;
}

function clusterEndsOf(layout: GlyphLayoutInspection, textLength: number): ReadonlyMap<number, number> {
  const boundaries = new Set<number>([0, textLength]);
  for (const cluster of layout.clusters) {
    if (cluster > textLength) throw new RangeError('paragraph text does not cover the inspected glyph clusters');
    boundaries.add(cluster);
  }
  for (const line of layout.lines) {
    if (line.textStart > textLength || line.textEnd > textLength) {
      throw new RangeError('paragraph text does not cover the inspected line ranges');
    }
    boundaries.add(line.textStart);
    boundaries.add(line.textEnd);
  }
  const ordered = [...boundaries].sort((left, right) => left - right);
  const ends = new Map<number, number>();
  for (let index = 0; index < ordered.length; index += 1) {
    const start = ordered[index]!;
    ends.set(start, ordered[index + 1] ?? textLength);
  }
  return ends;
}

/** Groups glyphs into words (maximal non-whitespace runs, never crossing a line) by glyph order, not text order — keeps a word's glyphs screen-contiguous under bidi. */
function wordsOf(
  layout: GlyphLayoutInspection,
  text: string,
  lineOfGlyph: Uint32Array,
  wordOfGlyph: Int32Array,
  clusterEnds: ReadonlyMap<number, number>,
): readonly WordSpan[] {
  const spans: WordSpan[] = [];
  let start = -1;
  let textStart = 0;
  let textEnd = 0;
  const close = (end: number): void => {
    if (start < 0) return;
    for (let index = start; index < end; index += 1) wordOfGlyph[index] = spans.length;
    spans.push({ glyphStart: start, glyphCount: end - start, textStart, textEnd });
    start = -1;
  };
  for (let index = 0; index < layout.glyphCount; index += 1) {
    const cluster = layout.clusters[index]!;
    const separator = isWordSeparator(text.charCodeAt(cluster));
    const brokeLine = start >= 0 && lineOfGlyph[index] !== lineOfGlyph[start];
    if (separator || brokeLine) close(index);
    if (separator) continue;
    if (start < 0) {
      start = index;
      textStart = cluster;
      textEnd = cluster;
    }
    textStart = Math.min(textStart, cluster);
    textEnd = Math.max(textEnd, clusterEnds.get(cluster) ?? cluster);
  }
  close(layout.glyphCount);
  return spans;
}
