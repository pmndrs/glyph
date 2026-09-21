import { expect, it } from 'vitest';
import { rigidBody } from 'crashcat';
import { mat4, wrapAngle } from 'math';
import { createWorld } from 'koota';
import { robotActions } from '../robot/actions';
import { Time } from '../time/traits';
import { Robot } from '../robot/traits';
import { moveRobotBodies } from '../robot/systems';
import { letterActions } from '../letters/actions';
import { Title } from '../letters/traits';
import { Body, Physics } from './traits';
import { physicsActions } from './actions';
import { stepPhysics } from './systems';

function prism(): number[][] {
  return [
    [
      -0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, -0.5, 0.5,
      0.5, 0.5, 0.5, 0.5,
    ],
  ];
}

it('lifts, lands once, and repeats after being swallowed and revived on the shared world', () => {
  const world = createWorld(Time);
  physicsActions(world).initializePhysics();
  const resource = world.get(Physics)!;
  const physics = physicsActions(world);
  const letters = letterActions(world);
  letters.spawnLetters();
  const titleEntity = world.queryFirst(Title)!;
  const title = letters.prepareTitle(
    mat4.create(),
    [{ home: [0, 0, 0.5], solid: { prisms: prism() }, index: 0, original: mat4.create() }],
    10,
    1,
    1,
  );
  const letter = title.pieces[0]!.entity;
  const body = letter.get(Body)!;
  world.set(Time, { delta: 1 / 60 });

  try {
    for (let replay = 0; replay < 2; replay++) {
      const pose = { x: 0, y: 0, z: 4, yaw: 0.2 };
      physics.holdBody(letter, pose);
      pose.z = 100;
      stepPhysics(world);
      expect(body.position[2]).toBe(4);
      physics.releaseBody(letter, [0, 0, -35], 0.35);
      let landings = 0;
      let bounced = false;
      let lastHeight = body.position[2];

      for (let frame = 0; frame < 240; frame++) {
        stepPhysics(world);
        landings += Number(letter.get(Body)!.landed);
        const height = body.position[2];

        if (landings > 0 && height > lastHeight + 0.01) bounced = true;

        lastHeight = height;
      }

      expect(landings).toBe(1);
      expect(bounced).toBe(true);
      expect(body.position[2]).toBeCloseTo(0.5, 1);
      expect(body.rotation[0]).toBeCloseTo(0);
      expect(body.rotation[1]).toBeCloseTo(0);
      physics.parkBody(letter);
      stepPhysics(world);
      expect(letter.get(Body)!.landed).toBe(false);
      physics.reviveBody(letter, { x: 0, y: 0, z: 0.5, yaw: 0 });
    }

    const engine = world.get(Physics)!.engine;
    const id = body.id;
    letters.disposeTitle(titleEntity);
    expect(rigidBody.get(engine, id)).toBeUndefined();
    expect(titleEntity.get(Title)!.bodies).toBeUndefined();
  } finally {
    world.destroy();
  }

  expect(resource.entities.size).toBe(0);
  expect(() => letters.disposeTitle(titleEntity)).not.toThrow();
});

it('lands overlapping letters beside one another instead of stacking them', () => {
  const world = createWorld(Time);
  physicsActions(world).initializePhysics();
  const physics = physicsActions(world);
  physics.setPhysicsFloor(0);
  const first = physics.spawnSolidBody([0, 0, 0.5], prism());
  const second = physics.spawnSolidBody([0.8, 0, 4], prism());
  physics.holdBody(second, { x: 0.8, y: 0, z: 4, yaw: 0 });
  physics.releaseBody(second, [0, 0, -35], 0);
  world.set(Time, { delta: 1 / 60 });

  try {
    for (let frame = 0; frame < 240; frame++) stepPhysics(world);

    const a = first.get(Body)!;
    const b = second.get(Body)!;
    expect(a.position[2]).toBeCloseTo(0.5, 1);
    expect(b.position[2]).toBeCloseTo(0.5, 1);
    expect(Math.hypot(a.position[0] - b.position[0], a.position[1] - b.position[1])).toBeGreaterThan(0.97);
  } finally {
    world.destroy();
  }
});

it('lets the robot push a flat letter and removes its collision when it leaves', () => {
  const world = createWorld(Time);
  physicsActions(world).initializePhysics();
  const physics = physicsActions(world);
  physics.setPhysicsFloor(0);
  const robotEntity = robotActions(world).spawnRobot();
  robotEntity.remove(Body);
  physics.attachKinematicBody(robotEntity, [0.3, 0.3, 0.5]);
  const robot = robotEntity.get(Robot)!;
  robotEntity.set(Robot, { active: true });
  Object.assign(robot.footprint, { x: -2, y: 0.55, z: 0, heading: 0 });
  const letter = physics.spawnSolidBody([0, 0, 0.5], prism());
  const body = letter.get(Body)!;
  world.set(Time, { delta: 1 / 60 });

  try {
    for (let frame = 0; frame < 120; frame++) {
      robot.footprint.x = -2 + frame / 60;
      moveRobotBodies(world);
      stepPhysics(world);
    }

    expect(body.position[0]).toBeGreaterThan(0.4);
    expect(body.position[2]).toBeCloseTo(0.5, 1);
    expect(body.rotation[0]).toBeCloseTo(0);
    expect(body.rotation[1]).toBeCloseTo(0);
    expect(letter.get(Body)!.landed).toBe(false);
    physics.holdBody(letter, { x: robot.footprint.x, y: robot.footprint.y, z: 4, yaw: 0 });
    physics.releaseBody(letter, [0, 0, -35], 0);
    robotEntity.set(Robot, { active: false });
    moveRobotBodies(world);

    for (let frame = 0; frame < 240; frame++) stepPhysics(world);

    expect(body.position[2]).toBeCloseTo(0.5, 1);
  } finally {
    world.destroy();
  }
});

it('keeps a letter the robot sweeps through from flying when its heading wraps past a half turn', () => {
  const world = createWorld(Time);
  physicsActions(world).initializePhysics();
  const physics = physicsActions(world);
  physics.setPhysicsFloor(0);
  const robotEntity = robotActions(world).spawnRobot();
  const robot = robotEntity.get(Robot)!;
  robotEntity.set(Robot, { active: true });
  Object.assign(robot.footprint, { x: 0, y: 0, z: 0.04, heading: Math.PI - 0.3 });
  const letter = physics.spawnSolidBody([-1.4, 0.6, 0.5], prism());
  const body = letter.get(Body)!;
  const engine = world.get(Physics)!.engine;
  const handle = rigidBody.get(engine, body.id)!;
  world.set(Time, { delta: 1 / 60 });
  let peak = 0;

  try {
    // Turn at the cart's hardest pivot back and forth across the half turn while sliding into the letter.
    for (let frame = 0; frame < 120; frame++) {
      robot.footprint.heading = wrapAngle(robot.footprint.heading + (frame % 40 < 20 ? 9.4 : -9.4) / 60);
      robot.footprint.x -= 2 / 60;
      moveRobotBodies(world);
      stepPhysics(world);
      peak = Math.max(peak, Math.hypot(...handle.motionProperties.linearVelocity));
    }

    // Nothing the robot does at two units a second and one turn a second can fling a letter faster than its own sweep.
    expect(peak).toBeLessThan(12);
    expect(Math.hypot(body.position[0], body.position[1])).toBeLessThan(6);
  } finally {
    world.destroy();
  }
});

it('bounces rain off the robot', () => {
  const world = createWorld(Time);
  physicsActions(world).initializePhysics();
  const physics = physicsActions(world);
  physics.setPhysicsFloor(-0.4);
  const robotEntity = robotActions(world).spawnRobot();
  const robot = robotEntity.get(Robot)!;
  robotEntity.set(Robot, { active: true });
  Object.assign(robot.footprint, { x: 0, y: 0, z: 0.04, heading: 0 });
  const drop = physics.spawnSolidBody([0.1, 0.2, 12], prism(), { stacks: true, gravityFactor: 0.6, airborne: true });
  const body = drop.get(Body)!;
  const engine = world.get(Physics)!.engine;
  const handle = rigidBody.get(engine, body.id)!;
  world.set(Time, { delta: 1 / 60 });
  let rebound = 0;

  try {
    for (let frame = 0; frame < 180; frame++) {
      moveRobotBodies(world);
      stepPhysics(world);

      if (body.position[2] > 2.5) rebound = Math.max(rebound, handle.motionProperties.linearVelocity[2]);
    }

    expect(rebound).toBeGreaterThan(4);
  } finally {
    world.destroy();
  }
});
