/** "glyph" from Inter with glyph outlines kept, baked by site/scripts/bake-inspect-fonts.mts. */
export const INTER_OUTLINES = new URL('../../../../docs/assets/fonts/inspect/inter-outlines.font.glb', import.meta.url)
  .href;
/** Must match the bake. */
export const OUTLINE_MSDF = { emSize: 32, pixelRange: 6 } as const;
export const WORD = 'glyph';
export const FONT_SIZE = 3.1;
/** Straight pieces per quadratic curve. */
export const STEPS = 10;
