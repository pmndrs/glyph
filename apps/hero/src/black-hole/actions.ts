import { createActions } from 'koota';
import { Time } from '../time/traits';
import { Collapse } from './traits';
import { collapseAt } from './systems';

export const blackHoleActions = createActions((world) => ({
  openBlackHole() {
    const collapse = world.get(Collapse)!;

    if (collapse.openedAt === undefined) world.set(Collapse, { openedAt: world.get(Time)!.now });
  },
  dismissBlackHole() {
    const collapse = world.get(Collapse)!;
    world.set(Collapse, { openedAt: undefined, held: undefined });
    collapseAt(collapse.hole, -1);
  },
  holdBlackHole(at: number | undefined) {
    const collapse = world.get(Collapse)!;
    collapse.held = at;

    if (at !== undefined) collapse.openedAt ??= world.get(Time)!.now;

    world.set(Collapse, collapse);
  },
}));
