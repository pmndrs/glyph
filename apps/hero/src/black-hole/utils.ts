import type { HoleState } from './traits';
import { clamp } from 'math';
import { easing } from 'math/time';
import { jitter } from '../random.ts';

/**
 * Collapse timing in seconds. The collapse trait owns the clock and shares the resulting state with simulation
 * and rendering.
 */

/** Where the hole sits on the floor, in world units, and the horizon it swallows at when fully open. */
export const HOLE_CENTER: readonly [x: number, y: number] = [0, 0];
export const HORIZON = 1.1;
/** Wind-up, an expanding gravity field, the paper collapse, and finally the pop. */
export const POP_AT = 3.35;
export const PAPER_FROM = 2.15;
export const PAPER_UNTIL = 3.12;
export const BURST_SECONDS = 1.25;
/** Seconds the beat runs for. After this everything is black and still. */
export const COLLAPSE_SECONDS = POP_AT + BURST_SECONDS;

/** Fraction of the way from `from` to `to`, clamped. */
function ramp(t: number, from: number, to: number): number {
  return clamp((t - from) / (to - from), 0, 1);
}

/** The beat `t` seconds after the hole opened. Pure, so the timing can be tested without a scene. */
export function collapseAt(out: HoleState, t: number): HoleState {
  out.time = t;
  out.x = HOLE_CENTER[0];
  out.y = HOLE_CENTER[1];

  if (t < 0) {
    out.beat = 'closed';
    out.time = -1;
    out.horizon = HORIZON;
    out.pull = 0;
    out.presence = 0;
    out.sincePop = undefined;
    out.blackout = 0;

    return out;
  }

  const open = easing.cubicOut(ramp(t, 0, 0.4));
  const swell = 1 + 0.6 * easing.sineInOut(ramp(t, 2.65, POP_AT - 0.1));
  const pinch = easing.cubicIn(ramp(t, POP_AT - 0.1, POP_AT));
  const popped = t >= POP_AT;
  out.beat = popped ? 'black' : 'open';
  out.horizon = HORIZON * open * swell;
  out.pull = popped ? 0 : easing.cubicIn(ramp(t, 0.65, 2.1));
  out.presence = popped ? 0 : open * swell * (1 - pinch);
  out.sincePop = popped ? t - POP_AT : undefined;
  out.blackout = popped ? 1 : 0;

  return out;
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

/** Unicode star shapes shared by the finale and its exact baked font subset. */
export const STAR_SYMBOLS = ['★', '☆', '✦', '✧', '✩', '✶'] as const;
