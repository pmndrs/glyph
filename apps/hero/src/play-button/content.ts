/**
 * The button sits on its own screen-space sheet: y spans -1..1 top to bottom, and x spans the same scale across,
 * so it is drawn and hit in the same units the pointer arrives in.
 */
export const BUTTON_WIDTH = 1.16;
export const BUTTON_HEIGHT = 0.44;
export const BUTTON_RADIUS = 0.06;
/** Room around the module on its plane for the screen's light to spill onto, so the plane's square edge never shows. */
export const FRAME_MARGIN = 0.1;

/**
 * The display's segments, in the classic layout with four diagonals through the middle:
 *
 *    AAAA
 *   F HI B
 *   F HI B
 *    GGGG
 *   E JK C
 *   E JK C
 *    DDDD
 */
export const SEGMENTS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'] as const;
export type Segment = (typeof SEGMENTS)[number];

/** The label, a character a cell, as the segments each one lights. */
export const LABEL: readonly (readonly Segment[])[] = [
  ['A', 'B', 'E', 'F', 'G'], // P
  ['D', 'E', 'F'], // L
  ['A', 'B', 'C', 'E', 'F', 'G'], // A
  ['B', 'C', 'D', 'F', 'G'], // Y
];

/** Seconds after the embers go out before the module powers up, and how long its power-up takes. */
export const REVEAL_AFTER = 0.35;
export const REVEAL_SECONDS = 1.1;
