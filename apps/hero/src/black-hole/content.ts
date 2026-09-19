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
