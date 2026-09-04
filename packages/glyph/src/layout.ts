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

/** Vertical metrics of a line or paragraph around its baseline: `ascent + descent === lineHeight` exactly, box top = `baseline - ascent`. Half-leading is already distributed into ascent/descent. */
export interface BaselineMetrics {
  /** Distance from the top edge of the box down to the baseline. */
  readonly ascent: number;
  /** Distance from the baseline down to the bottom edge of the box. */
  readonly descent: number;
  /** Total block-axis extent of the box. */
  readonly lineHeight: number;
}

/** Allocation-light paragraph metrics; no per-glyph arrays. `contentWidth`/`contentHeight` are *advance* extents (CSS box measure); `inkBounds` is the *ink* extent (glyph outlines) — using one where the other belongs is a silent visual error. */
export interface ParagraphMeasurement extends BaselineMetrics {
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

/** Intrinsic (constraint-independent) inline extents from the same measurement pass. `maxContentWidth` is the widest run between forced breaks; `minContentWidth` is the widest run after soft breaks too. Column splits and clipping don't participate. */
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
}

/** @internal Returns caller-owned columns while an integration keeps its canonical cached copy private. */
export function copyGlyphLayoutInspection(layout: GlyphLayoutInspection): GlyphLayoutInspection {
  return Object.freeze({
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
  });
}

export interface FontSlotRecord {
  readonly slot: number;
  readonly font: FontHandle;
}
