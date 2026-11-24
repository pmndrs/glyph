import type { World } from 'koota';
import { Time } from '../time/traits';
import { BUDGET_MS, DEMOTE_AFTER, LEAST_SCALE, RESTORE_AFTER, SCALE_STEP, SHED_AFTER } from './content';
import { Quality } from './traits';

/**
 * Hold the frame to its budget. A frame interval that stays over budget is a page dropping frames: it is drawn at
 * a lower resolution, a step at a time, and gets its resolution back when there is room again. A full-tier page
 * still over budget at the least resolution asks for the lite tier, which the director grants at its next cut. A
 * long gap is a hidden tab or a stall, not a slow frame, and counts for nothing.
 */
export function budgetFrame(world: World): void {
  const quality = world.get(Quality)!;
  const { delta, raw } = world.get(Time)!;
  // The unclamped interval: playback's own delta is capped, and a capped stall must not read as a slow frame.
  const frameMs = raw * 1000;

  if (frameMs >= 100) return;

  const budget = BUDGET_MS;
  const smoothed = quality.frameMs === 0 ? frameMs : quality.frameMs + (frameMs - quality.frameMs) * 0.08;
  let overBudget = smoothed > budget ? quality.overBudget + delta : 0;
  let underBudget = smoothed < budget * 0.88 ? quality.underBudget + delta : 0;
  let { scale, pendingTier } = quality;

  if (overBudget > SHED_AFTER && scale > LEAST_SCALE) {
    scale = Math.max(LEAST_SCALE, scale - SCALE_STEP);
    overBudget = 0;
  } else if (overBudget > DEMOTE_AFTER && quality.tier === 'full') {
    pendingTier = 'lite';
  } else if (underBudget > RESTORE_AFTER && scale < 1) {
    scale = Math.min(1, scale + SCALE_STEP);
    underBudget = 0;
  }

  world.set(Quality, { frameMs: smoothed, overBudget, underBudget, scale, pendingTier });
}
