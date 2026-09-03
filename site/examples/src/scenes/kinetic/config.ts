import { torusKnot } from '../../lib/paths';

/** Same parametrisation as three's `TorusKnotGeometry(RADIUS, TUBE, …, 2, 3)`, so the tube and the path agree. */
export const RADIUS = 2.5;
export const TUBE = 0.74;
export const KNOT = torusKnot(2, 3, RADIUS, RADIUS / 2);
export const KNOT_POSITION = [0.3, 0.25, -1.4] as const;

/**
 * The knot's skin is a grid of tiles: `ROWS` around the tube, and along it as
 * many as fit at `TILE_ALONG` world units each. A tile on the tube is
 * TILE_ALONG wide and a third of the circumference tall, and the render
 * target has that exact aspect, so a word lands on the surface undistorted.
 */
export const ROWS = 3;
export const TILE_ALONG = 3.4;
export const REPEAT = { x: Math.round(KNOT.length / TILE_ALONG), y: ROWS } as const;
export const TILE = { width: 4, height: (4 * ((Math.PI * 2 * TUBE) / ROWS)) / TILE_ALONG, pixelsPerUnit: 256 } as const;

export const RING = { radius: 4.3, tilt: [1.15, 0.1, 0.35] as const, speed: 0.3, size: 0.32 } as const;
export const RING_TEXT = 'LIVE SHAPED TYPE  ·  KINETIC  ·  ENDLESS  ·  ';
