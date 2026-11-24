import type { ShowcaseInteraction } from './interaction-state';

export const SHOWCASE_REST_SCALE = 1;
export const SHOWCASE_SELECTED_SCALE = 1.29;
const SHOWCASE_SELECTION_SPEED = 18;

/** Exponentially damp the current uniform scale toward the active interaction target. */
export function advanceSelectionScale(scale: number, interaction: ShowcaseInteraction, deltaSeconds: number): number {
  const target =
    interaction.phase === 'focusing' || interaction.phase === 'open' ? SHOWCASE_SELECTED_SCALE : SHOWCASE_REST_SCALE;
  const blend = 1 - Math.exp(-SHOWCASE_SELECTION_SPEED * Math.max(0, deltaSeconds));
  const next = scale + (target - scale) * blend;
  return Math.abs(target - next) < 0.0001 ? target : next;
}
