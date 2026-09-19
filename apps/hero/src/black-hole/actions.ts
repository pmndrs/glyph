import { createActions } from 'koota';
import { Time } from '../time/traits';
import { Collapse } from './traits';
import { collapseAt } from './utils';

export const blackHoleActions = createActions((world) => ({
  openBlackHole() {
    world.get(Collapse)!.openedAt ??= world.get(Time)!.now;
  },
  dismissBlackHole() {
    const collapse = world.get(Collapse)!;
    collapse.openedAt = undefined;
    collapse.held = undefined;
    collapseAt(collapse.hole, -1);
  },
  holdBlackHole(at: number | undefined) {
    const collapse = world.get(Collapse)!;
    collapse.held = at;

    if (at !== undefined) collapse.openedAt ??= world.get(Time)!.now;
  },
}));
