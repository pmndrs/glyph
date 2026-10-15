import type { GlyphOutlineContour, GlyphOutlineView } from './glyph-outline.js';
import type { FontHandle } from './identity.js';
import { textShaperAbi } from './generated/text-shaper-abi.js';

/** Axis-aligned box in paragraph-local units: origin top-left, +X right, +Y down — every box this module publishes is in that space. */
export interface LayoutBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Named bits of `GlyphLayout.glyphFlags` — HarfRust's own flags, carried through unchanged. Test against `produced` (union of settable bits) to tell "shaper said no" from "engine never asked"; unproducible bits (e.g. `SAFE_TO_INSERT_TATWEEL`) have no name here. */
export const glyphFlags: {
  /** A line break before this glyph may change how the surrounding text shapes. */
  readonly unsafeToBreak: number;
  /** Concatenating another run at this boundary may change how the surrounding text shapes. */
  readonly unsafeToConcat: number;
  /** Union of every bit this engine can set. */
  readonly produced: number;
} = textShaperAbi.engine.glyphFlags;

/** Signed vertical metrics around a baseline: `ascent + descent === lineHeight`; tight authored leading may make descent negative. */
export interface BaselineMetrics {
  /** Distance from the top edge of the box down to the baseline. */
  readonly ascent: number;
  /** Signed offset from the baseline to the bottom edge of the box. */
  readonly descent: number;
  /** Total block-axis extent of the box. */
  readonly lineHeight: number;
}

/** A point or translation in paragraph-local units, +X right and +Y down. */
export interface LayoutPoint {
  readonly x: number;
  readonly y: number;
}

/** Scaled primary-face metrics used by a line. Mixed authored styles take the maximum of each dimension; fallback glyph faces do not change the line's typography. A drop cap contributes cap/x-height dimensions and provenance to the first logical line; ascent, descent and leading retain the body strut. */
export interface LineFontMetrics {
  /** Font ascent without half-leading or baseline shift. */
  readonly ascent: number;
  /** Font descent without half-leading or baseline shift, positive down. */
  readonly descent: number;
  /** Effective line height minus font ascent and descent; may be negative with tight leading. */
  readonly leading: number;
  readonly capHeight: number;
  readonly xHeight: number;
  /** `font` means all participating primary faces supplied a positive OS/2 sCapHeight; otherwise the line includes the 0.66em fallback. */
  readonly capHeightSource: 'font' | 'fallback';
  /** `font` means all participating primary faces supplied a positive OS/2 sxHeight; otherwise the line includes the 0.5em fallback. */
  readonly xHeightSource: 'font' | 'fallback';
}

/** Computed typographic positions in paragraph-local coordinates, not OpenType BASE coordinates. Paragraph-level references describe the first line; an empty paragraph uses zero. */
export interface TypographicReferences {
  /** The line's layout baseline, including authored spacing and half-leading. */
  readonly alphabeticBaseline: number;
  /** The line-box bottom, computed from ascent, descent and effective leading; not a script-specific BASE lookup. */
  readonly ideographicBaseline: number;
  /** Top of the participating primary faces' cap-height envelope, including baseline shifts. */
  readonly capHeightTop: number;
  /** Top of the participating primary faces' x-height envelope, including baseline shifts. */
  readonly xHeightTop: number;
}

/** Allocation-light paragraph metrics; no per-glyph arrays. Size and content extents round outward at the public f32 boundary so measure-to-exact feedback cannot undershoot the measured layout. `contentWidth`/`contentHeight` are *advance* extents (CSS box measure); `inkBounds` is the *ink* extent (glyph outlines) — using one where the other belongs is a silent visual error. */
export interface ParagraphMeasurement extends BaselineMetrics, TypographicReferences {
  /** Primary-face metrics of the first line, or zero dimensions for an empty paragraph. */
  readonly fontMetrics: LineFontMetrics;
  /** Translation placing constraints.anchor at the supplied host origin. Metrics and glyph columns remain unshifted paragraph-local values. */
  readonly anchorOffset: LayoutPoint;
  /** Whole-paragraph baseline metrics use `firstBaseline` as their reference baseline. */
  readonly ascent: number;
  readonly descent: number;
  readonly lineHeight: number;
  /** Resolved paragraph box width in paragraph-local units. */
  readonly width: number;
  /** Resolved paragraph box height in paragraph-local units. */
  readonly height: number;
  /** Maximum horizontal advance extent of the laid-out lines before box clamping. */
  readonly contentWidth: number;
  /** Vertical extent required by all laid-out lines before box clamping. */
  readonly contentHeight: number;
  /** Distance from the paragraph box's top edge to the first baseline. */
  readonly firstBaseline: number;
  /** Distance from the paragraph box's top edge to the last baseline. */
  readonly lastBaseline: number;
  /** Union of every positioned glyph's ink box. `undefined` means glyphs were not positioned by this query — never that the ink is empty (a zero-glyph paragraph reports a zero-extent box). */
  readonly inkBounds: LayoutBox | undefined;
  readonly overflowed: boolean;
}

/** Metrics of one laid-out line, in the paragraph's coordinate space. */
export interface ParagraphLineMetrics extends BaselineMetrics, TypographicReferences {
  readonly fontMetrics: LineFontMetrics;
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

/** Bounded aggregate inspection of one retained layout. Unlike `GlyphLayout`, this has no per-glyph arrays — suitable for positioning UI, telemetry, and missing-glyph admission checks. */
export interface ParagraphLayoutSummary extends ParagraphMeasurement, ParagraphIntrinsicWidths {
  /** Positioned glyphs retained by layout, including non-rendering glyphs such as spaces. */
  readonly glyphCount: number;
  readonly lineCount: number;
  /** Positioned `.notdef` glyphs (`glyphId === 0`). */
  readonly missingGlyphCount: number;
  /** Exactly `lineCount` entries, in visual top-to-bottom order. */
  readonly lines: readonly ParagraphLineMetrics[];
}

/** Outward-rounded intrinsic inline extents from the same measurement pass. `maxContentWidth` is the widest run between forced breaks; `minContentWidth` is the widest run after soft breaks too. Column splits and clipping don't participate. */
export interface ParagraphIntrinsicWidths {
  readonly minContentWidth: number;
  readonly maxContentWidth: number;
}

/** Positioned glyph output in paragraph-local coordinates (origin top-left, +X right, +Y down). `glyphCount` is the single authority for every per-glyph column's length (`lineCount` for line columns) — the reader is the only producer, so a caller never re-derives or cross-checks lengths. */
export interface GlyphLayout extends ParagraphMeasurement {
  readonly fontHandles: Uint32Array;
  readonly glyphFontSlots: Uint16Array;
  readonly glyphIds: Uint16Array;
  readonly clusters: Uint32Array;
  /** Resolved Unicode bidi embedding level per glyph; odd levels run right-to-left. */
  readonly glyphBidiLevels: Uint8Array;
  /** Effective em size for each glyph in paragraph-local units. */
  readonly glyphFontSizes: Float32Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  /** Shaped advance per glyph: the distance the pen moves — neither ink width nor font size. Carets and selection rectangles are built from this. */
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

/** One positioned paragraph: measurement plus every per-glyph/line column, with stable identities — what `Text.glyphs()` copies from Wasm. A second query after `measure()`, not a bigger copy: per-glyph records cost more than a size probe wants to pay. See `measure()`/`Text.measure()`. */
export interface GlyphLayoutInspection extends GlyphLayout, ParagraphLayoutSummary, ParagraphIntrinsicWidths {
  readonly glyphStableIds: Uint32Array;
  /**
   * Reads glyph `index`'s outline, from a font baked with `--outlines`, as closed contours of
   * `[x0, y0, cx, cy, x1, y1, isLine]` tuples in em units with y down and the origin at the glyph's pen position on the
   * baseline; place a point at `x[index] + x * glyphFontSizes[index]`, `y[index] + y * glyphFontSizes[index]`. Equal
   * font and glyph IDs give equal outlines. Contours keep the font's winding for nonzero filling, a blank glyph returns
   * `[]`, and each CFF cubic becomes four quadratics.
   *
   * The copy holds its fonts' decoded outlines, so this makes no engine call and still reads after the `Text`, its
   * font, or its handle is disposed, and inside any borrow. Each call returns a new array of frozen contours shared by
   * every glyph with the same font and glyph ID. Throws `RangeError` for an index outside the layout and `TypeError`
   * for a glyph whose font was baked without outlines.
   */
  outlineAt(index: number): GlyphOutlineContour[];
}

/** @internal An inspection's columns before an integration attaches its outline read. */
export type GlyphLayoutColumns = Omit<GlyphLayoutInspection, 'outlineAt'>;

/** One caller-owned scalar glyph record read from a borrowed layout. */
export interface BorrowedGlyph {
  readonly stableId: number;
  readonly fontHandle: number;
  /** The glyph index in the registered font, not a Unicode code point or a layout index. */
  readonly glyphId: number;
  readonly cluster: number;
  readonly bidiLevel: number;
  readonly fontSize: number;
  readonly x: number;
  readonly y: number;
  readonly advance: number;
  readonly inkX: number;
  readonly inkY: number;
  readonly inkWidth: number;
  readonly inkHeight: number;
  readonly flags: number;
}

/** Synchronous borrowed view over positioned glyphs; every access expires with its callback. */
export interface BorrowedGlyphLayout {
  readonly glyphCount: number;
  glyphAt(index: number): BorrowedGlyph;
  /**
   * Returns the outline of the glyph `glyphAt(index)` describes, from the font that shaped it (baked with
   * `--outlines`); see `GlyphOutlineView` for the layout and placement. Fills and returns `target` when given, which
   * saves only the holder: the typed arrays are new views on every call. The views are valid only inside this
   * callback; copy them to keep the outline, or use `Text.glyphs().outlineAt()` for caller-owned tuples. Throws
   * `RangeError` for an index outside the layout and `TypeError` when the glyph's font was baked without outlines.
   */
  outlineAt(index: number, target?: GlyphOutlineView): GlyphOutlineView;
}

function assertGlyphIndex(index: number, glyphCount: number): void {
  if (!Number.isSafeInteger(index) || index < 0 || index >= glyphCount) {
    throw new RangeError('layout glyph index is outside its range');
  }
}

/**
 * @internal Returns caller-owned columns while an integration keeps its canonical cached copy private. `readOutline`
 * answers `outlineAt()` for an index already checked against the layout. `outlineAt` is not enumerable, so the copy
 * still spreads, compares, and structured-clones as plain columns.
 */
export function copyGlyphLayoutInspection(
  layout: GlyphLayoutColumns,
  readOutline: (index: number) => GlyphOutlineContour[],
): GlyphLayoutInspection {
  const glyphCount = layout.glyphCount;
  const copy = {
    ...layout,
    fontHandles: layout.fontHandles.slice(),
    glyphStableIds: layout.glyphStableIds.slice(),
    glyphFontSlots: layout.glyphFontSlots.slice(),
    glyphIds: layout.glyphIds.slice(),
    clusters: layout.clusters.slice(),
    glyphBidiLevels: layout.glyphBidiLevels.slice(),
    glyphFontSizes: layout.glyphFontSizes.slice(),
    x: layout.x.slice(),
    y: layout.y.slice(),
    glyphAdvances: layout.glyphAdvances.slice(),
    glyphInkX: layout.glyphInkX.slice(),
    glyphInkY: layout.glyphInkY.slice(),
    glyphInkWidths: layout.glyphInkWidths.slice(),
    glyphInkHeights: layout.glyphInkHeights.slice(),
    glyphFlags: layout.glyphFlags.slice(),
    lineTextStarts: layout.lineTextStarts.slice(),
    lineTextEnds: layout.lineTextEnds.slice(),
    lineGlyphStarts: layout.lineGlyphStarts.slice(),
    lineGlyphCounts: layout.lineGlyphCounts.slice(),
    lineBaselines: layout.lineBaselines.slice(),
    lineAdvances: layout.lineAdvances.slice(),
  };
  Object.defineProperty(copy, 'outlineAt', {
    value(index: number): GlyphOutlineContour[] {
      assertGlyphIndex(index, glyphCount);
      return readOutline(index);
    },
  });
  return Object.freeze(copy as GlyphLayoutColumns as GlyphLayoutInspection);
}

export interface FontSlotRecord {
  readonly slot: number;
  readonly font: FontHandle;
}
