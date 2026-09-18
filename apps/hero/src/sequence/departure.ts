import { clamp } from 'math';

/** Deterministic jitter in [0, 1) from an index. */
export function jitter(index: number): number {
  const value = Math.sin(index * 12.9898 + 78.233) * 43_758.545_3;

  return value - Math.floor(value);
}

/** When a piece `fraction` (0 = nearest, 1 = furthest) of the way out leaves, on the hole's clock. */
export function departureAt(fraction: number, index: number): number {
  return 0.85 + 1.05 * clamp(fraction, 0, 1) * (0.75 + 0.5 * jitter(index));
}

/**
 * How much of the pull runs round the hole rather than in, by distance in horizons: a full spiral far out, and
 * none at the horizon, so nothing can settle into an orbit just outside it.
 */
export function swirl(near: number, full: number): number {
  return full * clamp((near - 1) / 1.5, 0, 1);
}

/** 0..1 release: how far a piece's pull has grown since its departure. 0 before it. */
export function release(time: number, departure: number): number {
  const since = time - departure;

  if (since <= 0) return 0;

  const t = Math.min(1, since / 0.6);

  return t * t * t;
}

export function createFlight() {
  return { radius: 1, turn: 0, stretch: 1, size: 1 };
}

export type Flight = ReturnType<typeof createFlight>;

/** A letter's accelerating arc, written into caller-owned output. Duration is positive. */
export function flight(out: Flight, time: number, departure: number, duration: number): Flight {
  const progress = clamp((time - departure) / duration, 0, 1);
  const travel = progress ** 3;
  out.radius = 1 - travel;
  out.turn = progress ** 2 * 2.4;
  out.stretch = 1 + Math.sin(Math.PI * travel) * 1.8;
  out.size = 1 - travel;

  return out;
}
