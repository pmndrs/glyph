import type { World } from 'koota';
import { PATTERN_ANGLE } from '../icon-paper/content';
import { Time } from '../time/traits';
import { PaperView } from './traits';

/** Scroll the mounted paper with the foreground icon paper. */
export function updatePaper(world: World): void {
  const drift = world.get(PaperView);

  if (drift === undefined) return;

  const distance = 3.2 * (30 / 22) * world.get(Time)!.elapsed;
  drift.set(Math.cos(PATTERN_ANGLE) * distance, Math.sin(PATTERN_ANGLE) * distance);
}
