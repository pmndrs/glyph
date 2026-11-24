/**
 * The rows the OpenType-features scene draws, and the raster coverage its
 * font is baked with.
 *
 * A bake that passes `unicodeRanges` subsets the font, and the subsetter keeps
 * only the layout features a shaper applies by default (`liga`, `kern`,
 * `frac`, `locl`, …). `smcp`, `onum` and `zero` are discretionary, so this
 * Source Serif 4 file is baked whole — every feature stays — and only its
 * MSDF raster is narrowed, to the glyph IDs these rows shape to.
 */
export const ROWS = [
  { tag: 'liga', note: 'standard ligatures', text: 'office', off: [{ tag: 'liga', value: 0 }], on: [] },
  { tag: 'smcp', note: 'small capitals', text: 'Office', off: [], on: [{ tag: 'smcp' }] },
  { tag: 'onum', note: 'old-style figures', text: '0123456789', off: [], on: [{ tag: 'onum' }] },
  { tag: 'zero', note: 'slashed zero', text: '2026', off: [], on: [{ tag: 'zero' }] },
  { tag: 'frac', note: 'fractions', text: '1/2 3/4', off: [], on: [{ tag: 'frac' }] },
  {
    tag: 'smcp 7-13',
    note: 'one range of the text',
    text: 'Office Office',
    off: [],
    on: [{ tag: 'smcp', start: 7, end: 13 }],
  },
] as const;

/**
 * Source Serif 4.005 glyph IDs the rows above shape to, with and without each
 * feature, plus `.notdef`. Read from `text.glyphs().glyphIds`; a new row needs
 * its IDs added here and a re-bake.
 */
const GLYPH_IDS = [
  0, 1, 16, 30, 32, 33, 36, 42, 422, 427, 428, 429, 430, 431, 432, 433, 434, 435, 436, 437, 449, 450, 451, 452, 453,
  454, 455, 456, 457, 458, 530, 585, 587, 600, 602, 696, 1115, 1117, 1118, 1121,
] as const;

/** The format request must name the same raster the bake wrote, coverage included. */
export const SERIF_MSDF = { emSize: 32, pixelRange: 6, coverage: { glyphIds: GLYPH_IDS } } as const;
