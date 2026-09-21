import { createActions, type Entity } from 'koota';
import type { Group } from 'three/webgpu';
import { Time } from '../time/traits';
import { physicsActions } from '../physics/actions';
import { jitter } from '../utils';
import { Robot, ROBOT_HALF_EXTENTS, RobotView, DustView, MarkerView, type MarkerDraw, type RobotDraw } from './traits';

export const robotActions = createActions((world) => ({
  mountRobotView: (entity: Entity, view: RobotDraw) => {
    entity.add(RobotView(view));
  },
  unmountRobotView: (entity: Entity) => {
    entity.remove(RobotView);
  },
  mountMarkerView: (entity: Entity, view: MarkerDraw) => {
    entity.add(MarkerView(view));
  },
  unmountMarkerView: (entity: Entity) => {
    entity.remove(MarkerView);
  },
  mountDustView: (entity: Entity, groups: (Group | null)[]) => {
    entity.add(DustView(groups));
  },
  unmountDustView: (entity: Entity) => {
    entity.remove(DustView);
  },
  spawnRobot: () => {
    const entity = world.spawn(Robot);
    physicsActions(world).attachKinematicBody(entity, ROBOT_HALF_EXTENTS);

    return entity;
  },
  resetRobot: () => {
    world.query(Robot).updateEach(([robot]) => {
      robot.time = undefined;
      robot.face = undefined;
      robot.runAt = Number.POSITIVE_INFINITY;
      robot.active = false;
      robot.departed = false;
      robot.drive.hasTarget = false;
      robot.drive.speed = 0;
      robot.drive.rested = 0;
    });
  },
  /** Stand the robot at a floor point, facing `heading`, ready to be driven. */
  placeRobot: (x: number, y: number, heading: number) => {
    world.query(Robot).updateEach(([robot]) => {
      const pose = robot.motion.pose;
      pose.x = x;
      pose.y = y;
      pose.heading = heading;
      pose.look = 0;
      robot.footprint.x = x;
      robot.footprint.y = y;
      robot.footprint.heading = heading;
    });
  },
  /** Send the driven robot to a floor point. Each trip sways the other way from the last. */
  driveRobotTo: (x: number, y: number) => {
    world.query(Robot).updateEach(([robot]) => {
      const drive = robot.drive;
      drive.targetX = x;
      drive.targetY = y;
      drive.hasTarget = true;
      drive.travelled = 0;
      drive.since = 0;
      drive.rested = 0;
      drive.bend = (drive.trips % 2 === 0 ? 1 : -1) * (0.45 + jitter(drive.trips) * 0.3);
      drive.trips++;
    });
  },
  runRobot: (delay = 0) => {
    world.query(Robot).updateEach(([robot]) => {
      robot.runAt = world.get(Time)!.now + delay * 1000;
    });
  },
}));
