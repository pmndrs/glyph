import { createActions } from 'koota';
import { Time } from '../time/traits';
import { Collapse, BlackHoleView, type BlackHoleDraw } from './traits';
import { collapseAt } from './systems';

export const blackHoleActions = createActions((world) => ({
  mountBlackHoleView: (view: BlackHoleDraw) => {
    world.add(BlackHoleView(view));
  },
  unmountBlackHoleView: () => {
    world.remove(BlackHoleView);
  },
  openBlackHole: () => {
    const collapse = world.get(Collapse)!;

    if (collapse.openedAt === undefined) world.set(Collapse, { openedAt: world.get(Time)!.now });
  },
  dismissBlackHole: () => {
    const collapse = world.get(Collapse)!;
    world.set(Collapse, { openedAt: undefined });
    collapseAt(collapse.hole, -1);
  },
}));
