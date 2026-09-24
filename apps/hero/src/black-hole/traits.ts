import { trait } from 'koota';
import type { Group } from 'three/webgpu';
import { HOLE_CENTER, HORIZON } from './content';

export interface BlackHoleDraw {
  group: Group;
  uniforms: typeof import('./materials').holeUniforms;
}

export const BlackHoleView = trait((): BlackHoleDraw | undefined => undefined);

/** What the rest of the scene reads each frame. */
export interface HoleState {
  /** Closed; play's little feeding hole; the finale open; and black after the pop. */
  beat: 'closed' | 'play' | 'open' | 'black';
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
}

export const Collapse = trait({
  /** When the finale opened, on the frame clock. */
  openedAt: undefined as number | undefined,
  /** Where the hole is: the centre for the sequence's finale, or wherever play's hole appeared. */
  x: HOLE_CENTER[0],
  y: HOLE_CENTER[1],
  /** The pull the finale opened with: none from the sequence, or what play's hole had built by the handover. */
  joinedPull: 0,
  /** Whether the open finale grew out of play's hole, which keeps the scene on the field it was already riding. */
  fromPlay: false,
  /**
   * When play's little hole appeared, on the frame clock; how wide feeding has made it; how wide it has grown to
   * so far, easing up to that; and when it last ate, for the gulp.
   */
  playSince: undefined as number | undefined,
  playHorizon: 0,
  playGrown: 0,
  fedAt: Number.NEGATIVE_INFINITY,
  hole: (): HoleState => ({
    beat: 'closed',
    time: -1,
    x: HOLE_CENTER[0],
    y: HOLE_CENTER[1],
    horizon: HORIZON,
    pull: 0,
    presence: 0,
    sincePop: undefined,
  }),
});
