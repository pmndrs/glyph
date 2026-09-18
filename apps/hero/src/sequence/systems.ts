import type { World } from 'koota';
import { collapseAt } from './motion';
import { Frame, Sequence } from './traits';

export function advanceSequence(world: World): void {
  const sequence = world.get(Sequence)!;
  const frame = world.get(Frame)!;
  collapseAt(
    sequence.hole,
    sequence.held ?? (sequence.openedAt === undefined ? -1 : (frame.now - sequence.openedAt) / 1000),
  );
}
