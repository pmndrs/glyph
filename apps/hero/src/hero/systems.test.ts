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
import { letterActions } from '../letters/actions';
import { Body } from '../physics/traits';
import { mat4 } from 'math';
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

it('takes the wheel on a press while the hole is closed, waits for Play once it has opened, and Space returns', () => {
  const world = createWorld(Time, Keys, Pointer, Viewport, Mode, Timeline, Collapse, Impacts);
  const commands = heroActions(world);
  commands.initializeHero();
  commands.setViewport(18, 10, 16, 1.8);
  world.set(Time, { delta: 1 / 60 });
  const robot = world.queryFirst(Robot)!;
  const prism = [
    -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, 0.5, 0.5,
    0.5, 0.5, 0.5,
  ];
  const title = letterActions(world).prepareTitle(
    mat4.create(),
    [{ home: [0, 0, 0.5], solid: { prisms: [prism] }, index: 0, original: mat4.create() }],
    10,
    1,
    1,
  );

  try {
    // Before the title has dropped, a press restarts into play, without a lift, and the robot scoots in from off screen.
    commands.pressHero(0.1, -0.05);
    expect(world.get(Mode)!.kind).toBe('play');
    expect(title.replays).toBe(0);
    expect(title.lifting).toBe(false);
    moveRobots(world);
    driveRobots(world);
    expect(robot.get(Robot)!.active).toBe(true);
    expect(Math.abs(robot.get(Robot)!.motion.pose.x)).toBeGreaterThan(9);
    expect(robot.get(Robot)!.drive.targetX).toBeCloseTo(0.9);
    expect(robot.get(Robot)!.drive.targetY).toBeCloseTo(-0.25);

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
    expect(title.replays).toBe(1);
    expect(title.lifting).toBe(true);
    moveRobots(world);
    driveRobots(world);
    expect(robot.get(Robot)!.active).toBe(false);
    expect(robot.get(Robot)!.drive.hasTarget).toBe(false);

    // With the title dropped and the robot on its scripted run, a press keeps the scene and the robot's spot.
    robotActions(world).runRobot();
    moveRobots(world);
    expect(robot.get(Robot)!.active).toBe(true);
    const { x, y } = robot.get(Robot)!.motion.pose;
    commands.pressHero(0.2, 0.2);
    expect(world.get(Mode)!.kind).toBe('play');
    expect(title.replays).toBe(1);
    moveRobots(world);
    driveRobots(world);
    expect(robot.get(Robot)!.time).toBeUndefined();
    expect(Math.hypot(robot.get(Robot)!.motion.pose.x - x, robot.get(Robot)!.motion.pose.y - y)).toBeLessThan(0.2);

    // Once the hole has opened, presses wait for the Play button, which restarts the scene into play.
    commands.replayHero();
    world.set(Collapse, { openedAt: 0 });
    world.get(Collapse)!.hole.beat = 'open';
    commands.pressHero(0.1, 0.1);
    expect(world.get(Mode)!.kind).toBe('sequence');
    world.set(StarEmbers, { age: EMBER_SECONDS + REVEAL_AFTER + REVEAL_SECONDS });
    expect(playReveal(world)).toBeCloseTo(1);
    commands.pressHero(0.8, 0.8);
    expect(world.get(Mode)!.kind).toBe('sequence');
    title.swallowed.fill(1);
    commands.pressHero(0.05, -0.05);
    expect(world.get(Mode)!.kind).toBe('play');
    expect(world.get(Collapse)!.openedAt).toBeUndefined();
    expect(playReveal(world)).toBe(0);
    // Play settles the title home on the floor rather than lifting it for another smash.
    expect(title.replays).toBe(2);
    expect(title.lifting).toBe(false);
    expect(title.swallowed[0]).toBe(0);
    expect(title.pieces[0]!.entity.get(Body)!.mode).toBe('dynamic');
  } finally {
    world.destroy();
  }
});
