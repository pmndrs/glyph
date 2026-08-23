import type { FontHandle } from './identity.js';
import { textShaperAbi } from './generated/text-shaper-abi.js';

/**
 * Axis-aligned box in paragraph-local layout units: origin at the paragraph box's top-left corner,
 * positive X right, positive Y down. Every box this module publishes is in that one space.
 */
export interface LayoutBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Named bits of `ParagraphLayout.glyphFlags`.
 *
 * These are the shaper's own flags, carried through the engine unchanged, so a consumer reading a
 * bit is reading HarfRust's answer rather than a pmndrs re-derivation. `produced` is the union of
 * every bit this engine can set: a bit outside it is always zero, so testing against `produced`
 * distinguishes "the shaper said no" from "the engine never asked".
 *
 * `SAFE_TO_INSERT_TATWEEL` has no name here on purpose. Producing it needs a shaping buffer flag
 * this engine does not set, so the bit is unconditionally zero and a name would invite a consumer
 * to branch on a fact that is never reported.
 */
export const glyphFlags: {
  /** A line break before this glyph may change how the surrounding text shapes. */
  readonly unsafeToBreak: number;
  /** Concatenating another run at this boundary may change how the surrounding text shapes. */
  readonly unsafeToConcat: number;
  /** Union of every bit this engine can set. */
  readonly produced: number;
} = textShaperAbi.engine.glyphFlags;

/**
 * Vertical metrics of one line box, or of a whole paragraph, around its baseline.
 *
 * `ascent + descent === lineHeight` exactly, and the box top is `baseline - ascent`. Half-leading is
 * already distributed into `ascent` and `descent`, so these are box metrics rather than raw font
 * metrics — which is what a caller aligning to a baseline, a cap height, or an x height needs.
 */
export interface BaselineMetrics {
  /** Distance from the top edge of the box down to the baseline. */
  readonly ascent: number;
  /** Distance from the baseline down to the bottom edge of the box. */
  readonly descent: number;
  /** Total block-axis extent of the box. */
  readonly lineHeight: number;
}

/**
 * Allocation-light paragraph metrics for intrinsic sizing and host layout.
 * It deliberately contains no per-glyph arrays.
 *
 * Two extents are published and they are not interchangeable. `contentWidth`/`contentHeight` are
 * *advance* extents: the space the text claims, which is the correct number for a flex or grid host
 * because CSS box layout is advance-based. `inkBounds` is the *ink* extent: the union of the glyphs'
 * outlines, which is the correct number for centring something visually, because italics, accents,
 * and swashes overhang their advances. Using one where the other belongs is a silent visual error,
 * so both ship under names that cannot be confused.
 */
export interface ParagraphMeasurement extends BaselineMetrics {
  /** Resolved paragraph box width in local layout units. */
  readonly width: number;
  /** Resolved paragraph box height in local layout units. */
  readonly height: number;
  /** Maximum horizontal advance extent of the laid-out lines before box clamping. */
  readonly contentWidth: number;
  /** Vertical extent required by all laid-out lines before box clamping. */
  readonly contentHeight: number;
  /** Distance from the paragraph box's top edge to the first baseline. */
  readonly firstBaseline: number;
  /** Distance from the paragraph box's top edge to the last baseline. */
  readonly lastBaseline: number;
  /**
   * Union of every positioned glyph's ink box.
   *
   * `undefined` means this query did not position glyphs, so no ink was measured. It never means
   * "the ink is empty": a paragraph that positioned zero glyphs reports a zero-extent box, not
   * `undefined`. The absent case is stated rather than substituted with the advance box, because a
   * caller centring on the advance box when it asked for ink is exactly the defect this pair exists
   * to remove.
   */
  readonly inkBounds: LayoutBox | undefined;
  readonly overflowed: boolean;
}

/** Metrics of one laid-out line, in the paragraph's coordinate space. */
export interface ParagraphLineMetrics extends BaselineMetrics {
  /** Position of this line among the paragraph's lines. */
  readonly index: number;
  /** UTF-16 offsets this line covers in the paragraph text. */
  readonly textStart: number;
  readonly textEnd: number;
  /** Glyph span this line covers, as indices into the layout's per-glyph columns. */
  readonly glyphStart: number;
  readonly glyphCount: number;
  /** Distance from the paragraph box's top edge to this line's baseline. */
  readonly baseline: number;
  /** Advance extent of the line. Not its ink width — see `inkBounds`. */
  readonly advance: number;
  /** Ink box of this line's glyphs, `undefined` under the same rule as `ParagraphMeasurement`. */
  readonly inkBounds: LayoutBox | undefined;
}

/**
 * Bounded aggregate inspection of one retained layout. Unlike `ParagraphLayout`, this contains no
 * per-glyph arrays and is suitable for positioning UI, telemetry, and missing-glyph admission
 * checks.
 */
export interface ParagraphLayoutSummary extends ParagraphMeasurement, ParagraphIntrinsicWidths {
  /** Positioned glyphs retained by layout, including non-rendering glyphs such as spaces. */
  readonly glyphCount: number;
  readonly lineCount: number;
  /** Positioned `.notdef` glyphs (`glyphId === 0`). */
  readonly missingGlyphCount: number;
  /** Exactly `lineCount` entries, in visual top-to-bottom order. */
  readonly lines: readonly ParagraphLineMetrics[];
}

/**
 * Content-only inline extents published beside every paragraph measurement.
 *
 * Both widths are intrinsic: they do not depend on the constraints a host is currently
 * probing, and they ride the same measurement pass that produced the rest of the summary
 * -- no second query at zero width is required. `maxContentWidth` is the widest run between
 * forced breaks under the constraint's wrap policy, trailing spaces trimmed the way line
 * ends trim them. `minContentWidth` is the widest run that remains when soft breaks are
 * also taken: after word spaces under `'word'` wrap, before every safe boundary under
 * `'character'`, and the whole segment under `'none'`. Column splits, line caps, and
 * overflow clipping do not participate, because those are box policies rather than
 * content properties.
 */
export interface ParagraphIntrinsicWidths {
  readonly minContentWidth: number;
  readonly maxContentWidth: number;
}

/** A paragraph measurement plus the intrinsic widths carried by every `Paragraph.measure()` result. */
export interface ParagraphMetrics extends ParagraphMeasurement, ParagraphIntrinsicWidths {}

/**
 * Positioned glyph output in paragraph-local coordinates. The origin is the
 * paragraph box's top-left corner; positive X is right and positive Y is down.
 *
 * **`glyphCount` is the single authority for the per-glyph columns.** Every `Uint16Array`,
 * `Uint32Array`, and `Float32Array` below has exactly `glyphCount` entries, and every line column
 * has exactly `lineCount`. The reader is the only producer and slices each column to that length,
 * so a caller indexes with `glyphCount` and never re-derives a length from one column or checks the
 * columns against each other. The one real consumer of the previous shape hand-wrote a parallel
 * length assertion over six of these arrays; that assertion is now the reader's obligation.
 */
export interface ParagraphLayout extends ParagraphMeasurement {
  readonly fontHandles: Uint32Array;
  readonly glyphFontSlots: Uint16Array;
  readonly glyphIds: Uint16Array;
  readonly clusters: Uint32Array;
  /** Effective em size for each glyph in local layout units. */
  readonly glyphFontSizes: Float32Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  /**
   * Shaped advance per glyph: the distance the pen moves, which is neither the ink width nor the
   * font size. A caret between two glyphs and a selection rectangle are built from this.
   */
  readonly glyphAdvances: Float32Array;
  /** Ink box per glyph, in the paragraph space `x`/`y` use. A glyph with no outline reports zero extents at its own origin. */
  readonly glyphInkX: Float32Array;
  readonly glyphInkY: Float32Array;
  readonly glyphInkWidths: Float32Array;
  readonly glyphInkHeights: Float32Array;
  /** Shaper flags per glyph. Decode with `glyphFlags`. */
  readonly glyphFlags: Uint16Array;
  readonly lineTextStarts: Uint32Array;
  readonly lineTextEnds: Uint32Array;
  readonly lineGlyphStarts: Uint32Array;
  readonly lineGlyphCounts: Uint32Array;
  readonly lineBaselines: Float32Array;
  readonly lineAdvances: Float32Array;
}

/**
 * One positioned paragraph: the measurement view plus every per-glyph and per-line column,
 * with stable identities for directed augmentation.
 *
 * This is what `layout()` answers and what `Paragraph.layout(constraints)` copies out of Wasm.
 * It is a second query after `measure()`, not a bigger copy of it: asking for these columns
 * makes the engine emit a record per glyph, which a caller probing sizes never wants to pay
 * for. See `measure()` and `Text.measure()` for the split.
 */
export interface ParagraphLayoutInspection extends ParagraphLayout, ParagraphLayoutSummary, ParagraphIntrinsicWidths {
  readonly glyphStableIds: Uint32Array;
}

export interface FontSlotRecord {
  readonly slot: number;
  readonly font: FontHandle;
}
