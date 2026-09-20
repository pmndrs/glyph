import { createWorld } from 'koota';
import { Group, Vector2 } from 'three/webgpu';
import { expect, it } from 'vitest';
import { Time } from '../time/traits';
import { updateTime } from '../time/systems';
import { heroActions } from './actions';
import { updatePaper } from './systems';
import { Robot } from '../robot/traits';
import { COUNT } from '../robot/content';
import { robotActions } from '../robot/actions';
import { syncDustViews } from '../robot/systems';

it('only updates the currently mounted paper from the playback clock', () => {
  const world = createWorld(Time);
  const commands = heroActions(world);
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

it('updates hidden mounted dust and stops touching its groups after detachment', () => {
  const world = createWorld();
  const robot = world.spawn(Robot);
  const commands = robotActions(world);
  const groups = Array.from({ length: COUNT }, () => new Group());
  const group = groups[0]!;
  group.visible = false;
  const particle = robot.get(Robot)!.dust.particles[0]!;
  particle.age = 0.2;
  particle.position[0] = 3;

  try {
    commands.mountDustView(robot, groups);
    syncDustViews(world);
    expect(group.visible).toBe(true);
    expect(group.position.x).toBe(3);

    commands.unmountDustView(robot);
    particle.position[0] = 9;
    syncDustViews(world);
    expect(group.position.x).toBe(3);
  } finally {
    world.destroy();
  }
});
