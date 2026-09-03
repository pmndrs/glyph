import { torusKnot } from '../../lib/paths';

/** Same parametrisation as three's `TorusKnotGeometry(RADIUS, TUBE, …, 2, 3)`, so the tube and the path agree. */
export const RADIUS = 1.85;
export const TUBE = 0.6;
export const KNOT = torusKnot(2, 3, RADIUS, RADIUS / 2);
export const KNOT_POSITION = [0, 0.2, -1.2] as const;

/**
 * The knot's skin is a strip of live text: `ROWS` bands around the tube and
 * `ALONG` copies along it. A strip on the tube is `KNOT.length / ALONG` long
 * and a `ROWS`th of the circumference tall, and the render target has that
 * exact aspect, so the passage lands on the surface undistorted.
 */
export const ROWS = 3;
export const ALONG = 2;
export const REPEAT = { x: ALONG, y: ROWS } as const;
export const STRIP = {
  width: KNOT.length / ALONG,
  height: (Math.PI * 2 * TUBE) / ROWS,
  pixelsPerUnit: 96,
} as const;
/** The passage's type on the strip, in strip units; the line sits vertically centred in the band. */
export const STRIP_FONT = STRIP.height * 0.64;
