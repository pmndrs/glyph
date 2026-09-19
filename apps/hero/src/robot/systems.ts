import type { World } from 'koota';
import { Time } from '../time/traits';
import { Viewport } from '../view/traits';
import { Robot } from './traits';
import { layPath, poseAt, RUN_SECONDS, LEAVE_AT, BODY_REACH, stepDust } from './utils';
import { Body } from '../physics/traits';
import { physicsActions } from '../physics/actions';

export function moveRobots(world: World): void {
  const time = world.get(Time)!;
  const viewport = world.get(Viewport)!;

  world.query(Robot).updateEach(([robot]) => {
    robot.departed = false;

    if (robot.time === undefined) {
      robot.active = false;

      if (time.now < robot.runAt) return;

      robot.time = 0;
      robot.runAt = Number.POSITIVE_INFINITY;
      layPath(robot.motion.path, viewport.width, viewport.height, robot.runs++);
      robot.gone = false;
    }

    robot.time = robot.held ?? robot.time + time.delta;

    if (robot.time >= RUN_SECONDS) {
      robot.time = undefined;
      robot.active = false;
      robot.departed = true;

      return;
    }

    const pose = poseAt(robot.motion.pose, robot.time, robot.motion.path);
    robot.active = true;
    robot.footprint.x = pose.x;
    robot.footprint.y = pose.y;
    robot.footprint.heading = pose.heading;

    if (
      !robot.gone &&
      robot.time >= LEAVE_AT &&
      (Math.abs(pose.x) > viewport.width / 2 + BODY_REACH || Math.abs(pose.y) > viewport.height / 2 + BODY_REACH)
    ) {
      robot.gone = true;
      robot.departed = true;
    }
  });
}

export function emitDust(world: World): void {
  const time = world.get(Time)!;

  world.query(Robot).updateEach(([robot]) => {
    stepDust(robot.dust, time.delta, robot.active ? robot.footprint : undefined);
  });
}

export function moveRobotBodies(world: World): void {
  const physics = physicsActions(world);

  // Only robot data is written back here, preserving the physics actions' body updates.
  world
    .query(Robot, Body)
    .select(Robot)
    .updateEach(([robot], entity) => {
      const body = entity.get(Body)!;

      if (!robot.active) {
        if (body.mode !== 'parked') physics.parkBody(entity);

        return;
      }

      const target = robot.footprint;
      const pose = robot.physicsPose;
      pose.x = target.x;
      pose.y = target.y;
      pose.z = target.z;
      pose.yaw = target.heading;
      const dx = target.x - body.to.x;
      const dy = target.y - body.to.y;

      if (body.mode === 'parked' || dx * dx + dy * dy > 2.5 * 2.5) physics.reviveBody(entity, pose);

      physics.holdBody(entity, pose);
    });
}
