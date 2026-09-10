export const ROWS = 6;
export const COLUMNS = 25;
/** World units per cell; 25 columns span 10.5 of the 11-unit frame. */
export const CELL = { width: 0.42, height: 0.6, gap: 0.03 } as const;
export const FONT_SIZE = 0.44;
/** Flips per second while a cell is travelling. */
export const FLIP_RATE = 11;
/** Seconds each board stays before the next message. */
export const HOLD = 7;
export const INK = '#f2eee6';
