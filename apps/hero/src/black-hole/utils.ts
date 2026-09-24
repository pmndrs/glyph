import { clamp, lerp } from 'math';
import { easing } from 'math/time';
import { HORIZON, POP_AT } from './content';
import type { HoleState } from './traits';
import { jitter } from '../utils';

/**
 * How anything the black hole takes flies in: its accelerating arc, when each piece leaves, how its pull grows, and
 * how much of that pull runs round the hole. The hole, the title, the rain, and the icon paper all follow it.
 */

/** A piece's flight in: how far out it still is, how far it has turned, how stretched along its path, and its size. */
export interface Flight {
  radius: number;
  turn: number;
  stretch: number;
  size: number;
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

/**
 * The beat `t` seconds after the hole opened at `x, y`, its pull rising from `joinedPull`, what play's hole had
 * built by the handover, to full.
 */
export function collapseAt(out: HoleState, t: number, x: number, y: number, joinedPull = 0): HoleState {
  out.time = t;
  out.x = x;
  out.y = y;

  if (t < 0) {
    out.beat = 'closed';
    out.time = -1;
    out.horizon = HORIZON;
    out.pull = 0;
    out.presence = 0;
    out.sincePop = undefined;

    return out;
  }

  const open = easing.cubicOut(ramp(t, 0, 0.4));
  const swell = 1 + 0.6 * easing.sineInOut(ramp(t, 2.65, POP_AT - 0.1));
  const pinch = easing.cubicIn(ramp(t, POP_AT - 0.1, POP_AT));
  const popped = t >= POP_AT;
  out.beat = popped ? 'black' : 'open';
  out.horizon = HORIZON * open * swell;
  out.pull = popped ? 0 : lerp(joinedPull, 1, easing.cubicIn(ramp(t, 0.65, 2.1)));
  out.presence = popped ? 0 : open * swell * (1 - pinch);
  out.sincePop = popped ? t - POP_AT : undefined;

  return out;
}

/**
 * Play's little hole at `x, y`, `t` seconds after appearing, `horizon` wide once open, `sinceFed` seconds after
 * its last meal: a meal is a gulp, the hole swelling past its size and settling back, its pull flinching with it.
 */
export function playHoleAt(
  out: HoleState,
  t: number,
  horizon: number,
  sinceFed: number,
  x: number,
  y: number,
): HoleState {
  const open = easing.cubicOut(ramp(t, 0, 0.5));
  const gulp = sinceFed >= 0 && sinceFed < 3 ? Math.exp(-sinceFed * 4.5) * Math.sin(sinceFed * 19) * 0.3 : 0;
  out.beat = 'play';
  out.time = t;
  out.x = x;
  out.y = y;
  out.horizon = horizon * open * (1 + gulp);
  // Its pull, which bends the glass nearby, grows with it.
  out.pull = (0.12 + 0.45 * (horizon / HORIZON)) * open * (1 + gulp * 2);
  out.presence = open * (1 + gulp * 0.6);
  out.sincePop = undefined;

  return out;
}

/** Fraction of the way from `from` to `to`, clamped. */
function ramp(t: number, from: number, to: number): number {
  return clamp((t - from) / (to - from), 0, 1);
}
