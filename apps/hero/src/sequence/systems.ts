import type { World } from 'koota';
import { Time } from '../time/traits';
import { Timeline } from './traits';
import { sequenceActions } from './actions';

/** Dispatch due cues in time order, using declaration order to break ties. */
export function advanceSequence(world: World): void {
  const now = world.get(Time)!.elapsed;
  const { due } = world.get(Timeline)!;

  while (true) {
    let next = -1;
    let earliest = Infinity;

    for (let index = 0; index < due.length; index++) {
      if (due[index]! <= now && due[index]! < earliest) {
        next = index;
        earliest = due[index]!;
      }
    }

    if (next < 0) return;

    sequenceActions(world).runSequenceCue(next);
  }
}
