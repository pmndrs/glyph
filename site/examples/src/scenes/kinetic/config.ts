import { torusKnot } from '../../lib/paths';
import { PASSAGES } from '../../lib/typewriter';

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
/** The big lane is the middle half of the strip; the two small lanes are the outer quarters. */
export const BIG_FONT = STRIP.height * 0.5 * 0.8;
export const SMALL_FONT = STRIP.height * 0.25 * 0.62;
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

/**
 * Two rings of small type orbiting the knot, each tumbling slowly like a
 * gyroscope, each carrying one of the passages as a long line. The knot
 * reaches `RADIUS * 1.5 + TUBE` from its centre in its widest direction, and
 * a tumbling ring passes through every direction, so the inner ring sits
 * past that reach by a clear gap and the outer ring past the inner.
 */
export const KNOT_REACH = RADIUS * 1.5 + TUBE;
export const RINGS = [
  { radius: KNOT_REACH + 0.55, size: 0.34, speed: 0.4, spin: [0.11, 0.07] as const, phase: 0, text: PASSAGES[0] },
  { radius: KNOT_REACH + 1.2, size: 0.34, speed: -0.32, spin: [-0.08, 0.1] as const, phase: 2.1, text: PASSAGES[1] },
] as const;
/** Tight: a ring reads as a line only when its letters sit as close as a line's do. */
export const RING_LETTER_SPACING = -0.005;
/**
 * The glyphs are placed by advance mapped onto the circle's length, so a line
 * shorter than the circle is stretched to fit and its spacing opens up.
 * Repeat the text until it is about as long as the circle; Inter's average
 * advance is about six tenths of an em in caps.
 */
export function ringText(ring: (typeof RINGS)[number]): string {
  const circumference = Math.PI * 2 * ring.radius;
  const line = `${ring.text.toUpperCase()}   `;
  const length = line.length * (ring.size * 0.6 + RING_LETTER_SPACING);
  return line.repeat(Math.max(1, Math.round(circumference / length)));
}
