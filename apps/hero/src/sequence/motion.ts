import { clamp } from 'math';
import { easing } from 'math/time';

/**
 * Collapse timing in seconds. The sequence trait owns the clock and shares the resulting state with simulation
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

/** What the rest of the scene reads each frame. */
export interface HoleState {
  beat: 'closed' | 'open' | 'black';
  /**
   * Seconds since the hole opened. Negative while closed. Each piece of the scene leaves at its own moment on
   * this clock.
   */
  time: number;
  x: number;
  y: number;
  /** The horizon: anything inside is swallowed. */
  horizon: number;
  /** 0..1: strength of the pull on everything, and of the bend in the shaders. */
  pull: number;
  /** The hole's drawn presence, including an overshoot above one before the pop. */
  presence: number;
  /** Seconds since the pop, or undefined before it. */
  sincePop: number | undefined;
  /** 0..1: how black the frame is. */
  blackout: number;
}

export function createHoleState(): HoleState {
  return {
    beat: 'closed',
    time: -1,
    x: HOLE_CENTER[0],
    y: HOLE_CENTER[1],
    horizon: HORIZON,
    pull: 0,
    presence: 0,
    sincePop: undefined,
    blackout: 0,
  };
}

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
