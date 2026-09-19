import { trait } from 'koota';
import { HOLE_CENTER, HORIZON } from './utils';

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

interface CollapseState {
  openedAt: number | undefined;
  held: number | undefined;
  hole: HoleState;
}

export const Collapse = trait(
  (): CollapseState => ({
    openedAt: undefined,
    held: undefined,
    hole: {
      beat: 'closed',
      time: -1,
      x: HOLE_CENTER[0],
      y: HOLE_CENTER[1],
      horizon: HORIZON,
      pull: 0,
      presence: 0,
      sincePop: undefined,
      blackout: 0,
    },
  }),
);
