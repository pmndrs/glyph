import { torusKnot } from '../../lib/paths';

/** Same parametrisation as three's `TorusKnotGeometry(RADIUS, TUBE, …, 2, 3)`, so the tube and the path agree. */
export const RADIUS = 1.6;
export const TUBE = 0.56;
export const KNOT = torusKnot(2, 3, RADIUS, RADIUS / 2);
export const KNOT_POSITION = [0, 0.2, -1.2] as const;

/**
 * The knot's skin is one strip wrapped once around the tube and `ALONG`
 * times along it. A strip is `KNOT.length / ALONG` long and the tube's
 * circumference tall, and the render target has that exact aspect, so the
 * type lands on the surface undistorted. The strip is split into lanes
 * around the tube: the passage rides the middle half, large, and two small
 * lanes ride the quarters either side of it.
 */
export const ALONG = 2;
export const REPEAT = { x: ALONG, y: 1 } as const;
export const STRIP = {
  width: KNOT.length / ALONG,
  height: Math.PI * 2 * TUBE,
  pixelsPerUnit: 96,
} as const;
/**
 * The big lane is the middle half of the strip; the two small lanes are the outer quarters.
 *
 * Sized by how much of the passage should be legible at once rather than by the lane it sits in:
 * the strip is about `STRIP.width` long and repeats twice around the knot, so a font of half the
 * lane's height put barely a dozen letters on the whole thing and the words read as loose
 * abstract shapes. These fit roughly forty characters across the strip, which is a clause.
 */
export const BIG_FONT = STRIP.height * 0.17;
export const SMALL_FONT = STRIP.height * 0.1;
/** Centres of the small lanes, in strip units from the strip's middle. */
export const SMALL_LANE_Y = STRIP.height * 0.375;
/**
 * Turns the strip around the tube, in turns. The big lane is the strip's
 * middle half, and on this geometry the middle of v faces outward, so no
 * turn is what puts the passage on the front of the tube; a half turn would
 * swap it with the small lanes. Tuned by eye.
 */
export const LANE_TURN = 0;
/** The small lanes' text; Basic Latin only, the checked-in Inter subset. */
export const SMALL_TEXT = 'LIVE SHAPED TYPE / KINETIC / ENDLESS / ';
/** Tight, like the rings: the small lanes read as lines only when their letters sit close. */
export const SMALL_LETTER_SPACING = 0.01;
export const SMALL_REPEATS = Math.max(
  2,
  Math.ceil(STRIP.width / (SMALL_TEXT.length * (SMALL_FONT * 0.6 + SMALL_LETTER_SPACING))),
);
