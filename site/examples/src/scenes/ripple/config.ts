/**
 * The travelling wave the glyphs ride.
 *
 * `length` is how many radians of the wave one paragraph unit of advance covers, so it sets how
 * many crests the line is cut into; `speed` is how fast those crests travel along it. `stagger`
 * adds a little per-glyph offset on top, so neighbouring letters never sit at exactly the same
 * height and the line reads as letters on a wave rather than a solid ribbon.
 */
export const WAVE = {
  length: 1.15,
  speed: 1.9,
  stagger: 0.12,
  /**
   * How far a crest lifts a glyph, and how far it leans it toward the viewer. The rise has to
   * stay well under half the leading: a crest on one line and a trough on the next close the gap
   * from both sides at once, and the lines start to touch.
   */
  rise: 0.16,
  depth: 0.5,
} as const;

/**
 * The box the passage is set in. The frame is eleven units wide and about six tall at 16:9, and
 * the passage runs to five lines — so the column starts high enough that the last line still
 * clears the bottom once the wave has lifted it.
 */
export const COLUMN = { width: 9, position: [-4.5, 1.5, 0] as const } as const;
export const FONT_SIZE = 0.44;
/** Opened up a little past normal, to give the wave room to move a line without hitting the next. */
export const LINE_HEIGHT = 1.55;
