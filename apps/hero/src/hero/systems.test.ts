import { createWorld } from 'koota';
import { Group, Vector2 } from 'three/webgpu';
import { expect, it } from 'vitest';
import { Time } from '../time/traits';
import { updateTime } from '../time/systems';
import { heroActions } from './actions';
import { updatePaper } from './systems';
import { Mode, Viewport } from './traits';
import { Robot } from '../robot/traits';
import { COUNT } from '../robot/content';
import { robotActions } from '../robot/actions';
import { driveRobots, moveRobots, syncDustViews } from '../robot/systems';
import { Keys, Pointer } from '../input/traits';
import { Timeline } from '../sequence/traits';
import { Collapse } from '../black-hole/traits';
import { Impacts } from '../icon-paper/traits';
import { StarEmbers, EMBER_SECONDS } from '../star-embers/traits';
import { REVEAL_AFTER, REVEAL_SECONDS } from '../play-button/content';
import { playReveal } from '../play-button/systems';

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

it('starts play from the button once the embers are out, sends the robot with each press, and Space returns to the sequence', () => {
  const world = createWorld(Time, Keys, Pointer, Viewport, Mode, Timeline, Collapse, Impacts);
  const commands = heroActions(world);
  commands.initializeHero();
  commands.setViewport(18, 10, 16, 1.8);
  world.set(Time, { delta: 1 / 60 });
  const robot = world.queryFirst(Robot)!;

  try {
    // Pressing the button's spot does nothing until the button has started to draw.
    commands.pressHero(0, 0);
    expect(world.get(Mode)!.kind).toBe('sequence');

    world.set(StarEmbers, { age: EMBER_SECONDS + REVEAL_AFTER + REVEAL_SECONDS / 2 });
    expect(playReveal(world)).toBeCloseTo(0.5);
    commands.pressHero(0.8, 0.8);
    expect(world.get(Mode)!.kind).toBe('sequence');

    commands.pressHero(0.1, -0.05);
    expect(world.get(Mode)!.kind).toBe('play');
    expect(playReveal(world)).toBe(0);
    expect(world.get(Collapse)!.openedAt).toBeUndefined();
    moveRobots(world);
    driveRobots(world);
    expect(robot.get(Robot)!.active).toBe(true);
    expect(robot.get(Robot)!.drive.hasTarget).toBe(true);
    expect(Math.abs(robot.get(Robot)!.motion.pose.x)).toBeGreaterThan(9);

    commands.pressHero(0.5, -0.5);
    expect(robot.get(Robot)!.drive.targetX).toBeCloseTo(4.5);
    expect(robot.get(Robot)!.drive.targetY).toBeCloseTo(-2.5);
    expect(robot.get(Robot)!.drive.since).toBe(0);

    // The scripted run never takes the wheel in play.
    robotActions(world).runRobot();
    moveRobots(world);
    expect(robot.get(Robot)!.time).toBeUndefined();

    commands.replayHero();
    expect(world.get(Mode)!.kind).toBe('sequence');
    moveRobots(world);
    driveRobots(world);
    expect(robot.get(Robot)!.active).toBe(false);
    expect(robot.get(Robot)!.drive.hasTarget).toBe(false);
  } finally {
    world.destroy();
  }
});
