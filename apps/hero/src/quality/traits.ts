import { trait } from 'koota';

/** What the frame may spend. `lite` is the tier for phones and weak GPUs, chosen at load or after slow frames. */
export type Tier = 'full' | 'lite';

export const Quality = trait({
  tier: 'full' as Tier,
  /** A tier waiting for the next cut: changing tier rebuilds the canvas, which must not happen mid-shot. */
  pendingTier: undefined as Tier | undefined,
  /** The share of the tier's pixel ratio being drawn, lowered while frames run over budget. */
  scale: 1,
  /** The visitor asked for less motion: no camera moves, no springs, no attract loop. */
  reducedMotion: false,
  /** The smoothed frame interval, in milliseconds. */
  frameMs: 0,
  /** Seconds the smoothed frame has spent over budget, and under it with room to spare. */
  overBudget: 0,
  underBudget: 0,
});
