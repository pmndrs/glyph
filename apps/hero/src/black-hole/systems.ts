import type { World } from 'koota';
import { Time } from '../time/traits';
import { collapseAt } from './motion';
import { Collapse } from './traits';

export function advanceCollapse(world: World): void {
  const collapse = world.get(Collapse)!;
  collapseAt(
    collapse.hole,
    collapse.held ?? (collapse.openedAt === undefined ? -1 : (world.get(Time)!.now - collapse.openedAt) / 1000),
  );
}
