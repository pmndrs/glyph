import { createWorld } from 'koota';
import { Vector2 } from 'three/webgpu';
import { expect, it } from 'vitest';
import { updateTime } from '../time/systems';
import { Time } from '../time/traits';
import { paperActions } from './actions';
import { updatePaper } from './systems';

it('only updates the currently mounted paper from the playback clock', () => {
  const world = createWorld(Time);
  const commands = paperActions(world);
  const first = new Vector2();
  const replacement = new Vector2();

  try {
    commands.mountPaperView(first);
    updatePaper(world);
    expect(first.length()).toBe(0);

    updateTime(world, 0.1, 200);
    updatePaper(world);
    expect(first.length()).toBeGreaterThan(0);
    const last = first.clone();

    commands.unmountPaperView();
    updateTime(world, 0.1, 300);
    updatePaper(world);
    expect(first.equals(last)).toBe(true);

    commands.mountPaperView(replacement);
    updatePaper(world);
    expect(replacement.length()).toBeGreaterThan(first.length());
    expect(first.equals(last)).toBe(true);
  } finally {
    world.destroy();
  }
});
