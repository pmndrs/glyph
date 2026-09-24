import { createWorld } from 'koota';
import { Group } from 'three/webgpu';
import { expect, it } from 'vitest';
import { Time } from '../time/traits';
import { Mode } from '../director/traits';
import { robotActions } from './actions';
import { driveRobots, steer, syncDustViews } from './systems';
import { Robot } from './traits';
import { COUNT, LOOK_UP_AT } from './content';

const STEP = 1 / 60;

/** Drive one trip from rest, sampling the pose each frame until the cart settles or `seconds` run out. */
function trip(x: number, y: number, heading: number, targetX: number, targetY: number, seconds = 8) {
  const pose = { x, y, heading, look: 0 };
  const drive = { targetX, targetY, hasTarget: true, speed: 0, travelled: 0, since: 0, bend: 0.6, rested: 0, trips: 1 };
  const samples: { x: number; y: number; heading: number }[] = [];
  let frames = 0;

  while (drive.hasTarget && frames < seconds / STEP) {
    steer(pose, drive, STEP);
    samples.push({ x: pose.x, y: pose.y, heading: pose.heading });
    frames++;
  }

  return { pose, drive, samples, seconds: frames * STEP };
}

it('reaches targets all around it, including behind, then stops and rests', () => {
  for (let index = 0; index < 12; index++) {
    const angle = (index / 12) * Math.PI * 2;
    const reach = 1 + (index % 4) * 2.5;
    const { pose, drive, seconds } = trip(0, 0, 0, Math.cos(angle) * reach, Math.sin(angle) * reach);
    expect(drive.hasTarget, `target ${index}`).toBe(false);
    expect(seconds, `target ${index}`).toBeLessThan(5);
    expect(Math.hypot(pose.x - Math.cos(angle) * reach, pose.y - Math.sin(angle) * reach)).toBeLessThan(0.01);
    expect(drive.speed).toBe(0);
  }
});

it('never drives a straight line, and turns no faster than a cart can', () => {
  const { samples } = trip(-6, -3, 0.3, 6, 3);
  const chord = Math.hypot(12, 6);
  let deviation = 0;

  for (const sample of samples) {
    // Distance from the chord between the start and the target.
    deviation = Math.max(deviation, Math.abs((sample.x + 6) * 6 - (sample.y + 3) * 12) / chord);
  }

  expect(deviation).toBeGreaterThan(0.4);

  for (let index = 1; index < samples.length; index++) {
    const turn = Math.abs(samples[index]!.heading - samples[index - 1]!.heading);
    expect(Math.min(turn, Math.PI * 2 - turn)).toBeLessThanOrEqual(9.4 * STEP + 1e-9);
  }
});

it('carries speed and heading into a new target instead of restarting the trip', () => {
  const pose = { x: 0, y: 0, heading: 0, look: 0 };
  const drive = {
    targetX: 8,
    targetY: 0,
    hasTarget: true,
    speed: 0,
    travelled: 0,
    since: 0,
    bend: 0.5,
    rested: 0,
    trips: 1,
  };

  for (let frame = 0; frame < 30; frame++) steer(pose, drive, STEP);

  const speed = drive.speed;
  const heading = pose.heading;
  expect(speed).toBeGreaterThan(2);
  drive.targetX = -6;
  drive.targetY = 5;
  steer(pose, drive, STEP);
  expect(drive.speed).toBeGreaterThan(speed - 11 * STEP - 1e-9);
  expect(Math.abs(pose.heading - heading)).toBeLessThanOrEqual(9.4 * STEP + 1e-9);

  for (let frame = 0; frame < 8 * 60 && drive.hasTarget; frame++) steer(pose, drive, STEP);

  expect(drive.hasTarget).toBe(false);
  expect(Math.hypot(pose.x + 6, pose.y - 5)).toBeLessThan(0.01);
});

it('greets after resting in play, and looks back down as soon as it is sent on', () => {
  const world = createWorld(Time, Mode);
  const commands = robotActions(world);
  world.set(Mode, { kind: 'play' });
  world.set(Time, { delta: STEP });

  try {
    const entity = world.spawn(Robot);
    commands.placeRobot(1, 1, 0);
    driveRobots(world);
    const robot = entity.get(Robot)!;
    expect(robot.active).toBe(true);
    expect(robot.face).toBeUndefined();

    for (let frame = 0; frame < 2 * 60; frame++) driveRobots(world);

    expect(entity.get(Robot)!.pose.look).toBeGreaterThan(0.9);
    expect(entity.get(Robot)!.face).toBeGreaterThan(LOOK_UP_AT);

    commands.driveRobotTo(-3, 2);
    driveRobots(world);
    expect(entity.get(Robot)!.face).toBeUndefined();

    for (let frame = 0; frame < 30; frame++) driveRobots(world);

    expect(entity.get(Robot)!.pose.look).toBe(0);
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
