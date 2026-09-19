import { createWorld } from 'koota';
import { expect, it } from 'vitest';
import { Time } from '../time/traits';
import { sequenceActions } from './actions';
import { advanceSequence } from './systems';
import { Timeline } from './traits';

it('runs timed and event cues once in playback order, preserving declaration order for ties', () => {
  const world = createWorld(Time, Timeline);
  const commands = sequenceActions(world);
  const played: string[] = [];

  try {
    commands.loadSequence([
      { at: 2, run: () => played.push('late') },
      { at: 1, run: () => played.push('opening') },
      { on: 'landed', after: 0.5, run: () => played.push('typing') },
      { on: 'landed', after: 0.5, run: () => played.push('robot') },
    ]);
    world.set(Time, { elapsed: 0.5 });
    commands.triggerSequence('landed');
    advanceSequence(world);
    expect(played).toEqual([]);

    world.set(Time, { elapsed: 2 });
    advanceSequence(world);
    expect(played).toEqual(['opening', 'typing', 'robot', 'late']);
    advanceSequence(world);
    expect(played).toHaveLength(4);
  } finally {
    world.destroy();
  }
});

it('restarts event delays on later landings and cancels pending cues for replay', () => {
  const world = createWorld(Time, Timeline);
  const commands = sequenceActions(world);
  const played: string[] = [];

  try {
    commands.loadSequence([
      { on: 'landed', after: 1, run: () => played.push('robot') },
      { on: 'replay', run: () => commands.cancelSequence() },
    ]);
    commands.triggerSequence('landed');
    world.set(Time, { elapsed: 0.5 });
    commands.triggerSequence('landed');
    world.set(Time, { elapsed: 1 });
    advanceSequence(world);
    expect(played).toEqual([]);

    world.set(Time, { elapsed: 1.5 });
    advanceSequence(world);
    expect(played).toEqual(['robot']);

    commands.triggerSequence('landed');
    commands.triggerSequence('replay');
    advanceSequence(world);
    world.set(Time, { elapsed: 3 });
    advanceSequence(world);
    expect(played).toEqual(['robot']);

    commands.triggerSequence('landed');
    world.set(Time, { elapsed: 4 });
    advanceSequence(world);
    expect(played).toEqual(['robot', 'robot']);
  } finally {
    world.destroy();
  }
});
