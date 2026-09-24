/**
 * Collapse timing in seconds. The collapse trait owns the clock and shares the resulting state with simulation
 * and rendering.
 */

/** Where the finale's hole sits on the floor, in world units, and the horizon it swallows at when fully open. */
export const HOLE_CENTER: readonly [x: number, y: number] = [0, 0];
export const HORIZON = 1.1;
/** How far from the centre, each way, play's hole may appear. */
export const PLAY_OFFSET: readonly [x: number, y: number] = [4, 2];
/** Wind-up, an expanding gravity field, the paper collapse, and finally the pop. */
export const POP_AT = 3.35;
export const PAPER_FROM = 2.15;
export const PAPER_UNTIL = 3.12;

/** Horizon radius relative to the black-hole plane's half size. */
export const HORIZON_ON_PLANE = 0.42;

/**
 * Play's little hole: how wide it opens, how much each rain glyph and each title letter it eats widens it, and how
 * far its gravity reaches, in horizons, so the field grows with the hole. The field is wide and weak: it fades to
 * nothing at its edge, so the furthest bodies are only tugged, most of it carries bodies round the hole, and only
 * its last horizons draw them in. It grows slowly, some forty meals to
 * the finale's horizon, so what it has caught has time to settle into orbit before it goes critical; then it
 * joins the finale's timeline this far in, where that hole is already fully open.
 */
export const PLAY_HORIZON = 0.3;
export const GLYPH_GROWTH = 0.02;
export const LETTER_GROWTH = 0.03;
export const PLAY_REACH = 14;
export const FINALE_JOIN = 0.4;
/** Seconds from the handover for the finale's field to wind up to full speed, after a brief hold. */
export const WIND_SECONDS = 1.1;
/** Seconds after play begins before the little hole appears: a beat after the rain starts. */
export const PLAY_HOLE_AFTER = 3.2;
