/** Seconds into play before the first glyph falls, and the gap between drops. */
export const RAIN_AFTER = 2;
export const DROP_EVERY = 0.45;
/** How many glyphs can be on the paper at once. Past that, the oldest goes to make room. */
export const COUNT = 24;
/** Where a drop starts, and how much of the letters' gravity it falls under until it lands. */
export const RELEASE_Z = 12;
export const FALL_GRAVITY = 0.3;
/** How far past the edge a glyph may be pushed before it is taken away. */
export const MARGIN = 2;
export const FADE_SECONDS = 0.45;
/** Each glyph's solid: as thick as the title letters, so the robot meets it squarely. */
export const THICKNESS = 0.8;
/** What falls: one of these per slot, so the rain is a different glyph every time. */
export const GLYPHS = 'ABCDEFGHJKLMNPQRSTUVWXYZabdefghkmnpqrstuwxyz0123456789&@#%?!*+~';
