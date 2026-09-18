import { uniform } from 'three/tsl';
import { Vector2 } from 'three/webgpu';

/**
 * The black hole: one beat, timed in seconds from when it opens. It grows in, pulls every glyph on the screen into
 * a spiral and bends them on the way, swells, and pops, leaving the screen black until the next replay. The beat's
 * numbers live here; what reads them are the glyph materials (through the uniforms), the icon lattices, the title
 * bodies, the feature line, and the hole's own drawing. Module state: there is a single scene.
 */

/** Where the hole sits on the floor, in world units, and the horizon it swallows at when fully open. */
export const HOLE_CENTER: readonly [x: number, y: number] = [0, 0];
export const HORIZON = 1.1;
/** Wind-up, an expanding gravity field, the paper collapse, and finally the pop. */
export const OPEN_SECONDS = 0.4;
const PULL_FROM = 0.65;
const PULL_UNTIL = 2.1;
const SWELL_FROM = 2.65;
export const POP_AT = 3.35;
export const PAPER_FROM = 2.15;
export const PAPER_UNTIL = 3.12;
export const BURST_SECONDS = 1.25;
const BLACK_UNTIL = POP_AT + BURST_SECONDS;
/** Seconds the beat runs for; after this everything is black and still. */
export const COLLAPSE_SECONDS = BLACK_UNTIL;

/** Shared with the glyph shaders: where the hole is, how far it reaches, how hard it bends, and how it spins. */
export const uHoleCenter = uniform(new Vector2(HOLE_CENTER[0], HOLE_CENTER[1]));
export const uHoleHorizon = uniform(HORIZON);
/** 0 = no warp; 1 = the full spiral. */
export const uHoleBend = uniform(0);
/** Accumulated spin of the accretion disk and the warp's drag, in radians. */
export const uHoleSpin = uniform(0);
/** 0..1: how much of the frame is black. */
export const uHoleBlackout = uniform(0);
/** The camera's height over the floor: a glyph deeper down needs a wider reach to look the same size on screen. */
export const uHoleCamera = uniform(16);
/** The whole rendered sheet winds into the centre, exposing black behind its edges. */
export const uHoleCollapse = uniform(0);
/** Seconds since the explosion; negative before it. */
export const uHoleBurst = uniform(-1);
/** Extra soft bloom while the star sparks are the only visible objects. */
export const uHoleBloom = uniform(0.18);
export const uHoleShake = uniform(new Vector2());

/** What the rest of the scene reads each frame. */
export interface HoleState {
  readonly beat: 'closed' | 'open' | 'black';
  /** Seconds since the hole opened; negative while closed. Each piece of the scene leaves at its own moment on
   * this clock. */
  readonly time: number;
  readonly x: number;
  readonly y: number;
  /** The horizon: anything inside is swallowed. */
  readonly horizon: number;
  /** 0..1: strength of the pull on everything, and of the bend in the shaders. */
  readonly pull: number;
  /** The hole's drawn presence, including an overshoot above one before the pop. */
  readonly presence: number;
  /** Seconds since the pop, or undefined before it. */
  readonly sincePop: number | undefined;
  /** 0..1: how black the frame is. */
  readonly blackout: number;
}

const CLOSED: HoleState = Object.freeze({
  beat: 'closed',
  time: -1,
  x: HOLE_CENTER[0],
  y: HOLE_CENTER[1],
  horizon: HORIZON,
  pull: 0,
  presence: 0,
  sincePop: undefined,
  blackout: 0,
});

/** Fraction of the way from `from` to `to`, clamped. */
function ramp(t: number, from: number, to: number): number {
  return Math.min(1, Math.max(0, (t - from) / (to - from)));
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function easeInCubic(t: number): number {
  return t ** 3;
}

function easeInOutSine(t: number): number {
  return 0.5 - Math.cos(Math.PI * t) / 2;
}

/** The beat `t` seconds after the hole opened. Pure, so the timing can be tested without a scene. */
export function collapseAt(t: number): HoleState {
  if (t < 0) return CLOSED;
  const open = easeOutCubic(ramp(t, 0, OPEN_SECONDS));
  const swell = 1 + 0.6 * easeInOutSine(ramp(t, SWELL_FROM, POP_AT - 0.1));
  const pinch = easeInCubic(ramp(t, POP_AT - 0.1, POP_AT));
  const popped = t >= POP_AT;
  return {
    beat: popped ? 'black' : 'open',
    time: t,
    x: HOLE_CENTER[0],
    y: HOLE_CENTER[1],
    horizon: HORIZON * open * swell,
    pull: popped ? 0 : easeInCubic(ramp(t, PULL_FROM, PULL_UNTIL)),
    presence: popped ? 0 : open * swell * (1 - pinch),
    sincePop: popped ? t - POP_AT : undefined,
    blackout: popped ? 1 : 0,
  };
}

let openedAt: number | undefined;
let current: HoleState = CLOSED;
/** Development only: a moment on the beat's clock to freeze at, so one phase can be inspected. */
let held: number | undefined;

/** Opens the hole now, unless one is already open. Called when the robot has left the screen. */
export function requestCollapse(): void {
  openedAt ??= performance.now();
}

/** Closes the hole and clears the black, for the next replay. */
export function dismissCollapse(): void {
  openedAt = undefined;
  held = undefined;
  current = CLOSED;
}

/** Development only: freezes the beat at `at` seconds, or lets it run again when undefined. */
export function holdCollapse(at: number | undefined): void {
  held = at;
  if (at !== undefined) openedAt ??= performance.now();
}

/** Advances the beat to `now` (milliseconds, from `performance.now()`) and publishes it to the shaders. */
export function tickCollapse(now: number): HoleState {
  if (held !== undefined) current = collapseAt(held);
  else current = openedAt === undefined ? CLOSED : collapseAt((now - openedAt) / 1000);
  uHoleCenter.value.set(current.x, current.y);
  uHoleHorizon.value = Math.max(current.horizon, 0.001);
  uHoleBend.value = current.pull;
  uHoleBlackout.value = current.blackout;
  uHoleCollapse.value = easeInCubic(ramp(current.time, PAPER_FROM, PAPER_UNTIL));
  uHoleBurst.value = current.sincePop ?? -1;
  uHoleBloom.value = current.sincePop === undefined ? 0.18 : 0.75;
  // Clock-derived motion stays identical when a moment is held for inspection.
  const t = Math.max(0, current.time);
  uHoleSpin.value = t * 1.2 + 3 * t ** 3;
  const shake = current.beat === 'open' ? 0.003 * current.pull * (1 - uHoleCollapse.value) : 0;
  uHoleShake.value.set(Math.sin(t * 71) * shake, Math.cos(t * 93) * shake);
  return current;
}

/** The beat as last ticked. */
export function hole(): HoleState {
  return current;
}
