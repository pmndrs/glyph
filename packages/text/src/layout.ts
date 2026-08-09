import type { FontHandle } from './identity.js';

/**
 * Allocation-light paragraph metrics for intrinsic sizing and host layout.
 * It deliberately contains no per-glyph arrays.
 */
export interface ParagraphMeasurement {
  /** Resolved paragraph box width in local layout units. */
  readonly width: number;
  /** Resolved paragraph box height in local layout units. */
  readonly height: number;
  /** Maximum horizontal extent of the laid-out lines before box clamping. */
  readonly contentWidth: number;
  /** Vertical extent required by all laid-out lines before box clamping. */
  readonly contentHeight: number;
  /** Distance from the paragraph box's top edge to the first baseline. */
  readonly firstBaseline: number;
  /** Distance from the paragraph box's top edge to the last baseline. */
  readonly lastBaseline: number;
  readonly overflowed: boolean;
}

/**
 * Bounded aggregate inspection of one retained layout. Unlike `ParagraphLayout`, this contains no per-glyph arrays and
 * is suitable for positioning UI, telemetry, and missing-glyph admission checks.
 */
export interface ParagraphLayoutSummary extends ParagraphMeasurement {
  /** Positioned glyphs retained by layout, including non-rendering glyphs such as spaces. */
  readonly glyphCount: number;
  readonly lineCount: number;
  /** Positioned `.notdef` glyphs (`glyphId === 0`). */
  readonly missingGlyphCount: number;
}

/**
 * Positioned glyph output in paragraph-local coordinates. The origin is the
 * paragraph box's top-left corner; positive X is right and positive Y is down.
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
  readonly glyphFlags: Uint16Array;
  readonly lineTextStarts: Uint32Array;
  readonly lineTextEnds: Uint32Array;
  readonly lineGlyphStarts: Uint32Array;
  readonly lineGlyphCounts: Uint32Array;
  readonly lineBaselines: Float32Array;
  readonly lineAdvances: Float32Array;
}

/** Explicit demand-shaped inspection of retained Rust layout, including stable identities for directed augmentation. */
export interface ParagraphLayoutInspection extends ParagraphLayout, ParagraphLayoutSummary {
  readonly glyphStableIds: Uint32Array;
}

export interface FontSlotRecord {
  readonly slot: number;
  readonly font: FontHandle;
}
