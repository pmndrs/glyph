import { expect, it } from 'vitest';
import { rigidBody } from 'crashcat';
import { mat4 } from 'math';
import { createWorld } from 'koota';
import { robotActions } from '../robot/actions';
import { Time } from '../time/traits';
import { Robot } from '../robot/traits';
import { moveRobotBodies } from '../robot/systems';
import { typographyActions } from '../typography/actions';
import { Title } from '../typography/traits';
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
  const typography = typographyActions(world);
  typography.spawnTypography();
  const titleEntity = world.queryFirst(Title)!;
  const title = typography.prepareTitle(
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
    typography.disposeTitle(titleEntity);
    expect(rigidBody.get(engine, id)).toBeUndefined();
    expect(titleEntity.get(Title)!.bodies).toBeUndefined();
  } finally {
    world.destroy();
  }

  expect(resource.entities.size).toBe(0);
  expect(() => typography.disposeTitle(titleEntity)).not.toThrow();
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
