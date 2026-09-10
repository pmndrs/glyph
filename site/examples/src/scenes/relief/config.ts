/** The height tile: a word rendered as coverage, mipmapped so slopes soften. */
export const TILE = { width: 12, height: 4, pixelsPerUnit: 128 } as const;
/** The tilted near edge grows in perspective, so the slab stays within a safe 86% frame. */
export const SLAB = { width: TILE.width * 0.78, height: TILE.height * 0.82 } as const;
export const WORDS = ['CARVED', 'IN LIGHT', 'RELIEF', 'GLYPH'] as const;
/** Seconds per word. */
export const HOLD = 5;
/** How far the surface rises, in world units. */
export const DEPTH = 0.42;
export const FONT_SIZE = 2.6;
