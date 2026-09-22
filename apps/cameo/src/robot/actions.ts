import { createActions, type Entity } from 'koota';
import type { Group } from 'three/webgpu';
import { Time } from '../time/traits';
import { DustView, Robot, RobotView, type RobotDraw } from './traits';

export const robotActions = createActions((world) => ({
  mountRobotView: (entity: Entity, view: RobotDraw) => {
    entity.add(RobotView(view));
  },
  unmountRobotView: (entity: Entity) => {
    entity.remove(RobotView);
  },
  mountDustView: (entity: Entity, groups: (Group | null)[]) => {
    entity.add(DustView(groups));
  },
  unmountDustView: (entity: Entity) => {
    entity.remove(DustView);
  },
  spawnRobot: () => world.spawn(Robot),
  /** Run a take `delay` seconds from now. */
  callRobotAction: (delay = 0) => {
    const now = world.get(Time)!.elapsed;

    world.query(Robot).updateEach(([robot]) => {
      robot.startAt = now + delay;
    });
  },
  /** Send the robot off frame and cancel whatever take it was in. */
  cutRobot: () => {
    world.query(Robot).updateEach(([robot]) => {
      robot.time = undefined;
      robot.startAt = Number.POSITIVE_INFINITY;
      robot.finished = false;
    });
  },
}));
