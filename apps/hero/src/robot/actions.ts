import { createActions, type Entity } from 'koota';
import type { Group } from 'three/webgpu';
import { Time } from '../time/traits';
import { physicsActions } from '../physics/actions';
import { Robot, ROBOT_HALF_EXTENTS, RobotView, DustView, type RobotDraw } from './traits';

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
  spawnRobot: () => {
    const entity = world.spawn(Robot);
    physicsActions(world).attachKinematicBody(entity, ROBOT_HALF_EXTENTS);

    return entity;
  },
  resetRobot: () => {
    world.query(Robot).updateEach(([robot]) => {
      robot.time = undefined;
      robot.runAt = Number.POSITIVE_INFINITY;
      robot.active = false;
      robot.departed = false;
    });
  },
  runRobot: (delay = 0) => {
    world.query(Robot).updateEach(([robot]) => {
      robot.runAt = world.get(Time)!.now + delay * 1000;
    });
  },
}));
