/** Basic Latin only: the checked-in Inter subset covers U+0020–007E. */
export const PASSAGE =
  'Click to place a caret. Drag to select: each rectangle is clipped to its line, and every offset is a cluster boundary, so a caret never lands inside a grapheme.';
export const WIDTH = 8.6;
export const FONT_SIZE = 0.5;
/** World y of the paragraph box's top edge; the box hangs down from it. */
export const TOP = 1.9;
/** Selected before the reader touches anything, so the first frame already shows both queries. */
export const SEED_WORD = 'select';
export const CARET_WIDTH = 0.035;
/** Seconds per blink; the caret is lit for the first six tenths. */
export const BLINK = 1.1;
