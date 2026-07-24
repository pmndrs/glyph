import type { FontHandle } from './identity.js'

/**
 * Allocation-light paragraph metrics for intrinsic sizing and host layout.
 * It deliberately contains no per-glyph arrays.
 */
export interface ParagraphMeasurement {
  /** Resolved paragraph box width in local layout units. */
  readonly width: number
  /** Resolved paragraph box height in local layout units. */
  readonly height: number
  /** Maximum horizontal extent of the laid-out lines before box clamping. */
  readonly contentWidth: number
  /** Vertical extent required by all laid-out lines before box clamping. */
  readonly contentHeight: number
  /** Distance from the paragraph box's top edge to the first baseline. */
  readonly firstBaseline: number
  /** Distance from the paragraph box's top edge to the last baseline. */
  readonly lastBaseline: number
  readonly overflowed: boolean
}

/** Positioned glyph output for rendering and text interaction. */
export interface ParagraphLayout extends ParagraphMeasurement {
  readonly fontHandles: Uint32Array
  readonly glyphFontSlots: Uint16Array
  readonly glyphIds: Uint16Array
  readonly clusters: Uint32Array
  /** Effective em size for each glyph in local layout units. */
  readonly glyphFontSizes: Float32Array
  readonly x: Float32Array
  readonly y: Float32Array
  readonly glyphFlags: Uint16Array
  readonly lineTextStarts: Uint32Array
  readonly lineTextEnds: Uint32Array
  readonly lineGlyphStarts: Uint32Array
  readonly lineGlyphCounts: Uint32Array
  readonly lineBaselines: Float32Array
  readonly lineAdvances: Float32Array
}

export interface FontSlotRecord {
  readonly slot: number
  readonly font: FontHandle
}
