import type { World } from 'koota';
import { collapseAt } from './motion';
import { Frame, Sequence } from './traits';
import { sequenceActions } from './actions';

export function advanceSequence(world: World): void {
  const sequence = world.get(Sequence)!;
  const frame = world.get(Frame)!;

  // Give the prepared scene one beat before the first lift.
  if (sequence.replays === 0 && frame.elapsed >= 1) sequenceActions(world).replay();

  collapseAt(
    sequence.hole,
    sequence.held ?? (sequence.openedAt === undefined ? -1 : (frame.now - sequence.openedAt) / 1000),
  );
}
