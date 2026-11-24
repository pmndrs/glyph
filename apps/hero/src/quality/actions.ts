import { createActions } from 'koota';
import { Quality, type Tier } from './traits';

export const qualityActions = createActions((world) => ({
  setTier: (tier: Tier) => {
    world.set(Quality, { tier, pendingTier: undefined, scale: 1, overBudget: 0, underBudget: 0 });
  },
  /** At a cut: move to the tier the budget asked for, if it asked. Returns whether the canvas will be rebuilt. */
  grantPendingTier: () => {
    const { pendingTier, tier } = world.get(Quality)!;

    if (pendingTier === undefined || pendingTier === tier) return false;

    qualityActions(world).setTier(pendingTier);

    return true;
  },
  setReducedMotion: (reducedMotion: boolean) => {
    world.set(Quality, { reducedMotion });
  },
}));
