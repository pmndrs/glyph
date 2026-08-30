import type { LayoutBox, GlyphLayoutInspection } from './layout.js';

/**
 * The one coordinate space every position and box in a `GlyphPlacements` snapshot is expressed in:
 * paragraph-local units, origin at the paragraph box's top-left corner, positive X right and
 * positive Y down. It is the space the engine positioned the glyphs in and the space
 * `GlyphLayout` reports.
 *
 * It is a stated field rather than a convention because the surface this replaces did not have one.
 * `snapshotGlyphOrigins` returned a `Float32Array` seeded from shaped space and then overwritten
 * from displayed space wherever a GPU record existed, so one array held two spaces with nothing
 * marking the boundary. Here a snapshot names its space once and no value in it is ever from
 * another; a position that could not be read is reported by `GlyphPlacements.incomplete`, not
 * substituted.
 */
export type GlyphSpace = 'paragraph';

/**
 * Identity of one glyph within a paragraph, owned by this package.
 *
 * **It survives a reflow that moves glyphs. It does not survive a reflow that reshapes them.**
 *
 * The key is the font, the shaped glyph id, the source cluster, and the occurrence index that
 * separates otherwise identical glyphs. So a change to the content box, the font size, the anchor,
 * the device pixel ratio, or the paragraph's transform keeps every key: the same glyphs moved. A
 * change to the text, the font, the language, the direction, or the feature set does not: those
 * replace or reorder the glyph stream, and a key that happened to match across one would interpolate
 * a glyph along a path it never travelled.
 *
 * The engine's `glyphStableIds` deliberately does not appear here. A stable id identifies a record
 * within one committed layout, which is what the GPU write path needs and what a reflow discards.
 * The one real consumer of the previous API discovered this and built this key itself; owning it
 * here is the point.
 */
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
  /** Where the committed layout put this glyph's origin. A manipulation never changes it. */
  readonly shapedX: number;
  readonly shapedY: number;
  /** Where the glyph is drawn. Assign these to animate; `GlyphPlacements` is applied as a whole. */
  x: number;
  y: number;
  /** Ink box of the glyph as currently placed. A glyph with no outline reports zero extents. */
  readonly ink: LayoutBox;
  /** Advance box of the glyph as currently placed: `advance` wide, its line's box tall. */
  readonly bounds: LayoutBox;
}

/**
 * A run of glyphs addressed as one unit, because that is what a reader sees move.
 *
 * A caller staggering a reveal by word should not have to derive word membership from clusters,
 * which is what the previous surface forced.
 */
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
  /** Moves every glyph in the run. */
  translate(dx: number, dy: number): void;
  /** Returns every glyph in the run to where the layout put it. */
  reset(): void;
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

/** What `GlyphPlacements.adopt` recovered, so a caller never has to infer it from a diff. */
export interface GlyphAdoption {
  /** Glyphs whose drawn position was recovered from the previous snapshot by identity. */
  readonly matched: number;
  /** Glyphs in this snapshot that the previous one did not contain. They stay at their shaped origin. */
  readonly unmatched: number;
  /** Glyphs the previous snapshot held that this one does not. They have nowhere to go. */
  readonly dropped: number;
}

/**
 * A caret position, resolved to a cluster rather than to a UTF-16 index.
 *
 * Cluster-first is the whole point: one JavaScript character is not one caret stop. A ligature is
 * one glyph over several characters, a combining mark is several characters at one position, and
 * under bidi the character after an offset can be drawn to its left. A caret that indexes characters
 * cannot express any of those.
 */
export interface GlyphCaret {
  /** UTF-16 offset of the cluster boundary the caret sits at. */
  readonly offset: number;
  /** Index into `GlyphPlacements.lines`. */
  readonly line: number;
  /** True when the caret is at the leading edge of the cluster at `offset`. */
  readonly leading: boolean;
  /** Caret rectangle: zero width, the line box's height. */
  readonly rect: LayoutBox;
}

/**
 * What one `apply` did.
 *
 * A write either lands on every glyph or says exactly which ones it did not reach. The surface this
 * replaces silently skipped any glyph whose GPU record was missing, so a frame writing two hundred
 * origins could land forty with no error and no count.
 */
export interface GlyphApplication {
  readonly requested: number;
  readonly applied: number;
  /** Indices into `GlyphPlacements.glyphs` that had no retained record. Empty when `applied === requested`. */
  readonly unapplied: readonly number[];
}

/**
 * One paragraph's glyphs, addressable as glyphs, words, and lines, in one stated coordinate space.
 *
 * The cycle is explicit: **snapshot, manipulate, restore.** `Text.snapshotGlyphs()` produces one,
 * assignments to `GlyphPlacement.x`/`y` (or `GlyphRun.translate`) manipulate it,
 * `Text.applyGlyphs(placements)` writes it to the retained GPU buffer without a reshape or a CPU
 * re-upload, and `Text.restoreGlyphs()` hands authority back to the measure. Restore is a step of the
 * cycle rather than a call discovered by observing corruption.
 *
 * Every array here is internally consistent by construction. There are no parallel columns for a
 * caller to keep aligned.
 */
export interface GlyphPlacements {
  /** Every position and box below is in this space. No value in this snapshot is from another. */
  readonly space: GlyphSpace;
  /**
   * The committed layout these placements describe.
   *
   * Applying a snapshot taken before a reflow would move whichever records inherited its
   * identities, so the layout rides along and the write compares it rather than trusting the caller
   * to have noticed.
   */
  readonly layout: GlyphLayoutInspection;
  readonly glyphs: readonly GlyphPlacement[];
  /** Runs of non-whitespace glyphs, split at every line boundary. See `wordsOf` for the exact rule. */
  readonly words: readonly GlyphRun[];
  readonly lines: readonly GlyphLine[];
  /**
   * Glyphs with no retained render record, so `x`/`y` hold the shaped origin and a write to them
   * cannot land.
   *
   * The ordinary case is a glyph the font gives no outline for — a space is in here for almost every
   * paragraph — because the render plan carries no record for something it never draws. Those
   * glyphs still exist in the measure, still hold their place in the advance, and still belong to a
   * word and a line; they simply cannot be moved independently of the glyphs around them.
   *
   * It is reported rather than hidden because the previous surface substituted a shaped-space value
   * into its displayed array and said nothing, so a caller could not tell a moved glyph from an
   * unmovable one.
   */
  readonly incomplete: readonly number[];
  glyphForKey(key: GlyphKey): GlyphPlacement | undefined;
  /**
   * Copies drawn positions from `previous` onto the glyphs the two snapshots share by identity.
   * Glyphs with no match keep their shaped origin, which is the honest place for a glyph that did
   * not exist a moment ago.
   */
  adopt(previous: GlyphPlacements): GlyphAdoption;
  /** Returns every glyph to where the layout put it, without touching the paragraph. */
  reset(): void;
  /** Nearest cluster boundary to a point, in this snapshot's space. */
  caretAt(x: number, y: number): GlyphCaret;
  /** Line-clipped rectangles covering the clusters in a UTF-16 range. */
  selectionRects(start: number, end: number): readonly LayoutBox[];
}

const EMPTY_BOX: LayoutBox = Object.freeze({ x: 0, y: 0, width: 0, height: 0 });

/**
 * Whitespace that separates one animated word from the next.
 *
 * This is a presentation rule, not the engine's cluster grid, so it is stated here in full rather
 * than deferred to a segmenter whose Unicode version follows the host. A script that writes without
 * spaces yields one word per line; a caller wanting per-character motion there uses `glyphs`.
 */
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

interface MutableGlyph extends GlyphPlacement {
  x: number;
  y: number;
}

/**
 * Builds the placement snapshot for one committed layout.
 *
 * `displayedX`/`displayedY` carry the drawn origins read from the retained records, and `incomplete`
 * names the glyphs whose record was missing. The caller supplies both together so the snapshot can
 * state its own completeness instead of leaving a hole the reader cannot see.
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

  const glyphs: MutableGlyph[] = [];
  const keyCounts = new Map<string, number>();
  for (let index = 0; index < glyphCount; index += 1) {
    const fontHandle = layout.fontHandles[layout.glyphFontSlots[index]!];
    if (fontHandle === undefined) throw new TypeError('paragraph layout references a missing font slot');
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

  const byKey = new Map<GlyphKey, MutableGlyph>();
  for (const glyph of glyphs) byKey.set(glyph.key, glyph);

  const placements: GlyphPlacements = {
    space: 'paragraph',
    layout,
    glyphs: Object.freeze(glyphs) as readonly GlyphPlacement[],
    words: Object.freeze(words),
    lines: Object.freeze(lines),
    incomplete: Object.freeze([...incomplete]),
    glyphForKey: (key: GlyphKey) => byKey.get(key),
    adopt(previous: GlyphPlacements): GlyphAdoption {
      let matched = 0;
      for (const glyph of glyphs) {
        const before = previous.glyphForKey(glyph.key);
        if (before === undefined) continue;
        glyph.x = before.x;
        glyph.y = before.y;
        matched += 1;
      }
      return Object.freeze({
        matched,
        unmatched: glyphs.length - matched,
        dropped: previous.glyphs.length - matched,
      });
    },
    reset(): void {
      for (const glyph of glyphs) {
        glyph.x = glyph.shapedX;
        glyph.y = glyph.shapedY;
      }
    },
    caretAt: (x: number, y: number) => caretAt(lines, clusterEnds, x, y),
    selectionRects: (start: number, end: number) => selectionRects(lines, clusterEnds, start, end),
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
): MutableGlyph {
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
  all: readonly MutableGlyph[],
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
    translate(dx: number, dy: number): void {
      for (const glyph of glyphs) {
        glyph.x += dx;
        glyph.y += dy;
      }
    },
    reset(): void {
      for (const glyph of glyphs) {
        glyph.x = glyph.shapedX;
        glyph.y = glyph.shapedY;
      }
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
  for (const cluster of layout.clusters) boundaries.add(cluster);
  for (const line of layout.lines) {
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

/**
 * Groups glyphs into words: maximal runs of glyphs whose source cluster is not whitespace, never
 * crossing a line boundary.
 *
 * Grouping runs over the glyph order rather than the text order so the result stays contiguous under
 * bidi, where one word's glyphs are adjacent on screen even when its characters are not adjacent in
 * visual reading order across the paragraph.
 */
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

/** The line whose box contains `y`, or the nearest one when `y` falls outside every box. */
function lineAt(lines: readonly GlyphLine[], y: number): GlyphLine | undefined {
  let nearest: GlyphLine | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    const top = line.baseline - line.ascent;
    const bottom = top + line.lineHeight;
    if (y >= top && y < bottom) return line;
    const distance = y < top ? top - y : y - bottom;
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = line;
    }
  }
  return nearest;
}

function caretRect(line: GlyphLine, x: number): LayoutBox {
  return box(x, line.baseline - line.ascent, 0, line.lineHeight);
}

/**
 * Resolves a point to the nearest cluster boundary.
 *
 * The comparison is against each glyph's leading and trailing edges rather than its centre alone, so
 * a right-to-left glyph resolves to the boundary that is logically before it even though that edge
 * is drawn on its right. That is the property a character-indexed hit test cannot have.
 */
function caretAt(
  lines: readonly GlyphLine[],
  clusterEnds: ReadonlyMap<number, number>,
  x: number,
  y: number,
): GlyphCaret {
  const line = lineAt(lines, y);
  if (line === undefined) {
    return Object.freeze({ offset: 0, line: 0, leading: true, rect: EMPTY_BOX });
  }
  let best: Readonly<{ offset: number; leading: boolean; x: number }> | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  const consider = (edge: number, offset: number, leading: boolean): void => {
    const distance = Math.abs(edge - x);
    if (distance >= bestDistance) return;
    bestDistance = distance;
    best = { offset, leading, x: edge };
  };
  for (let start = 0; start < line.glyphs.length; ) {
    const first = line.glyphs[start]!;
    let end = start + 1;
    let left = Math.min(first.x, first.x + first.advance);
    let right = Math.max(first.x, first.x + first.advance);
    while (end < line.glyphs.length && line.glyphs[end]!.cluster === first.cluster) {
      const glyph = line.glyphs[end]!;
      left = Math.min(left, glyph.x, glyph.x + glyph.advance);
      right = Math.max(right, glyph.x, glyph.x + glyph.advance);
      end += 1;
    }
    const rtl = (first.bidiLevel & 1) !== 0;
    consider(rtl ? right : left, first.cluster, true);
    const clusterEnd = clusterEnds.get(first.cluster) ?? first.cluster;
    consider(rtl ? left : right, clusterEnd, clusterEnd < line.textEnd);
    start = end;
  }
  if (best === undefined) {
    return Object.freeze({ offset: line.textStart, line: line.index, leading: true, rect: caretRect(line, 0) });
  }
  return Object.freeze({ offset: best.offset, line: line.index, leading: best.leading, rect: caretRect(line, best.x) });
}

/**
 * Rectangles covering the clusters whose offsets fall in `[start, end)`, one per line touched.
 *
 * A rectangle spans the union of the matching glyphs' advance boxes on that line and the full height
 * of the line box, matching what `Range.getClientRects()` returns for text: a selection highlight is
 * a layout-box artefact, not an ink one. A bidi line whose selected characters are drawn in two
 * separate places yields two rectangles for that line rather than one covering the gap.
 */
function selectionRects(
  lines: readonly GlyphLine[],
  clusterEnds: ReadonlyMap<number, number>,
  start: number,
  end: number,
): readonly LayoutBox[] {
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new RangeError('selection offsets must be finite');
  const from = Math.min(start, end);
  const to = Math.max(start, end);
  if (from === to) return Object.freeze([]);
  const rects: LayoutBox[] = [];
  for (const line of lines) {
    const top = line.baseline - line.ascent;
    let run: Readonly<{ min: number; max: number }> | undefined;
    let previousIndex = -2;
    const flush = (): void => {
      if (run === undefined) return;
      rects.push(box(run.min, top, run.max - run.min, line.lineHeight));
      run = undefined;
    };
    for (const glyph of line.glyphs) {
      if ((clusterEnds.get(glyph.cluster) ?? glyph.cluster) <= from || glyph.cluster >= to) continue;
      // A gap in glyph order is a visual gap under bidi, so it closes the rectangle rather than
      // widening one across characters that are not selected.
      if (glyph.index !== previousIndex + 1) flush();
      previousIndex = glyph.index;
      const min = Math.min(glyph.x, glyph.x + glyph.advance);
      const max = Math.max(glyph.x, glyph.x + glyph.advance);
      run = run === undefined ? { min, max } : { min: Math.min(run.min, min), max: Math.max(run.max, max) };
    }
    flush();
  }
  return Object.freeze(rects);
}
