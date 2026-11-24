/** Sample text for the paragraph-layout scenes. Basic Latin only: the shared Inter subset covers nothing else. */
export const PROSE =
  'A paragraph is a stream of words poured into a box. The layout says how the stream breaks and aligns; the constraints say how large the box is. Change either one and every line is composed again, so the text always fits the space it was given.';

export const LONG_PROSE = `${PROSE} Regions and columns split that space into several boxes that fill in order, and exclusions carve shapes out of them, so the same stream can run beside a picture, around a pull quote, or through the panels of a page.`;

/** Enough text to fill a page-sized region with room for a shape in the middle of it. */
export const FLOW_PROSE = `${LONG_PROSE} An exclusion is a shape the lines must avoid. Each line is cut where the shape crosses it, and the words continue on whichever side still has room. Move the shape and only the lines it touches are composed again, while the rest of the paragraph stays where it was. The text itself never changes: the same characters, in the same order, take a different path through the space that is left.`;
