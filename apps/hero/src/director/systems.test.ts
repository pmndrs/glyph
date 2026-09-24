import { createWorld } from 'koota';
import { expect, it } from 'vitest';
import { Time } from '../time/traits';
import { directorActions } from './actions';
import { Mode } from './traits';
import { Viewport } from '../viewport/traits';
import { Robot } from '../robot/traits';
import { robotActions } from '../robot/actions';
import { driveRobots, moveRobots } from '../robot/systems';
import { Pointer } from '../input/traits';
import { Timeline } from '../sequence/traits';
import { Collapse } from '../black-hole/traits';
import { Impacts } from '../icon-paper/traits';
import { letterActions } from '../letters/actions';
import { Body } from '../physics/traits';
import { mat4 } from 'math';
import { EMBER_SECONDS } from '../star-embers/content';
import { REVEAL_AFTER, REVEAL_SECONDS } from '../ui/content';
import { revealPlayButton } from '../ui/systems';
import { PlayButton } from '../ui/traits';

it('takes the wheel on a press while the hole is closed, waits for Play once it has opened, and Space returns', () => {
  const world = createWorld(Time, Pointer, Viewport, Mode, Timeline, Collapse, Impacts);
  const commands = directorActions(world);
  commands.initializeScene();
  world.set(Viewport, { width: 18, height: 10, cameraZ: 16, aspect: 1.8 });
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
    commands.pressScene(0.1, -0.05);
    expect(world.get(Mode)!.kind).toBe('play');
    expect(title.replays).toBe(0);
    expect(title.lifting).toBe(false);
    moveRobots(world);
    driveRobots(world);
    expect(robot.get(Robot)!.active).toBe(true);
    expect(Math.abs(robot.get(Robot)!.pose.x)).toBeGreaterThan(9);
    expect(robot.get(Robot)!.drive.targetX).toBeCloseTo(0.9);
    expect(robot.get(Robot)!.drive.targetY).toBeCloseTo(-0.25);

    commands.pressScene(0.5, -0.5);
    expect(robot.get(Robot)!.drive.targetX).toBeCloseTo(4.5);
    expect(robot.get(Robot)!.drive.targetY).toBeCloseTo(-2.5);
    expect(robot.get(Robot)!.drive.since).toBe(0);

    // The scripted run never takes the wheel in play.
    robotActions(world).runRobot();
    moveRobots(world);
    expect(robot.get(Robot)!.time).toBeUndefined();

    commands.replayScene();
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
    const { x, y } = robot.get(Robot)!.pose;
    commands.pressScene(0.2, 0.2);
    expect(world.get(Mode)!.kind).toBe('play');
    expect(title.replays).toBe(1);
    moveRobots(world);
    driveRobots(world);
    expect(robot.get(Robot)!.time).toBeUndefined();
    expect(Math.hypot(robot.get(Robot)!.pose.x - x, robot.get(Robot)!.pose.y - y)).toBeLessThan(0.2);

    // Once the hole has opened, presses wait for the Play button, which restarts the scene into play.
    commands.replayScene();
    world.set(Collapse, { openedAt: 0 });
    world.get(Collapse)!.hole.beat = 'open';
    commands.pressScene(0.1, 0.1);
    expect(world.get(Mode)!.kind).toBe('sequence');
    // The embers have burnt out since the pop, and the button has drawn itself in.
    world.get(Collapse)!.hole.beat = 'black';
    world.get(Collapse)!.hole.sincePop = EMBER_SECONDS + REVEAL_AFTER + REVEAL_SECONDS;
    revealPlayButton(world);
    expect(world.get(PlayButton)!.reveal).toBeCloseTo(1);
    commands.pressScene(0.8, 0.8);
    expect(world.get(Mode)!.kind).toBe('sequence');
    title.swallowed.fill(1);
    commands.pressScene(0.05, -0.05);
    expect(world.get(Mode)!.kind).toBe('play');
    expect(world.get(Collapse)!.openedAt).toBeUndefined();
    revealPlayButton(world);
    expect(world.get(PlayButton)!.reveal).toBe(0);
    // Play settles the title home on the floor rather than lifting it for another smash.
    expect(title.replays).toBe(2);
    expect(title.lifting).toBe(false);
    expect(title.swallowed[0]).toBe(0);
    expect(title.pieces[0]!.entity.get(Body)!.mode).toBe('dynamic');
  } finally {
    world.destroy();
  }
});
