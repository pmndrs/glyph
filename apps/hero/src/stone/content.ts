/**
 * The stone: a black hole on the page. Lengths are page units.
 */

/** The horizon's radius once the stone is fully present. */
export const HORIZON = 0.92;
/** How far the text keeps clear of the centre, in horizons: the accretion disk sits inside this. */
export const CLEARANCE = 1.75;
/** A letter this close to the clearance edge, in page units, may be pulled out of its line. */
export const CAPTURE_REACH = 0.42;
/** Letters taken per second while the stone is among the text. */
export const CAPTURE_RATE = 20;
/** Sides of the polygon the flow is told about. */
export const EXCLUSION_SIDES = 16;
/** The pull on a body one horizon out, in page units per second squared, falling with the square of distance. */
export const PULL = 26;
/** How much of the pull runs round the hole instead of in, far out. Nothing orbits at the horizon. */
export const SWIRL = 0.82;
/** Seconds for a swallowed letter to stretch into the centre. */
export const SWALLOW_SECONDS = 0.45;
/** Seconds between letters as the rewind gives them back, and the spring that carries each one home. */
export const REWIND_STAGGER = 0.018;
/** Friction on a flung stone, per second, and how much speed it keeps off the edge of the text. */
export const STONE_FRICTION = 1.1;
export const STONE_BOUNCE = 0.6;
/** The horizon's radius relative to half the plane the stone is drawn on. */
export const HORIZON_ON_PLANE = 0.42;
