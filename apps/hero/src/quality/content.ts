import type { Tier } from './traits';

/** What each tier draws with. Everything a tier changes is here, so a beat never asks which tier it is on. */
export interface TierBudget {
  /** Device pixel ratio range. */
  readonly dpr: readonly [number, number];
  readonly samples: number;
  readonly depthOfField: boolean;
  /** The headline refracts the page through physical transmission, or is drawn as lit ink. */
  readonly transmission: boolean;
  /** Letters ride per-glyph springs between layouts, or are drawn where the layout puts them. */
  readonly springs: boolean;
  /** Glyphs that may be rigid bodies at once. */
  readonly bodies: number;
  readonly bloomScale: number;
}

export const TIERS: Readonly<Record<Tier, TierBudget>> = {
  full: { dpr: [1, 2], samples: 4, depthOfField: true, transmission: true, springs: true, bodies: 96, bloomScale: 0.5 },
  lite: {
    dpr: [1, 1.25],
    samples: 0,
    depthOfField: false,
    transmission: false,
    springs: true,
    bodies: 36,
    bloomScale: 0.25,
  },
};

/**
 * The frame budget, on the frame interval: a page whose smoothed interval stays above this is dropping frames. A
 * frame still over budget at the least resolution for `DEMOTE_AFTER` seconds moves a full-tier page to lite. The
 * GPU's own clock is what the capture script reports. It is not what the page steers by: summed over a frame's
 * passes it can exceed the frame it was measured in.
 */
export const BUDGET_MS = 21;
/** Over budget this long, the frame is drawn at a lower resolution, a step at a time, down to the least scale. */
export const SHED_AFTER = 0.8;
export const SCALE_STEP = 0.1;
export const LEAST_SCALE = 0.6;
/** Comfortably under the budget this long, a step of resolution comes back. */
export const RESTORE_AFTER = 5;
export const DEMOTE_AFTER = 2.5;
