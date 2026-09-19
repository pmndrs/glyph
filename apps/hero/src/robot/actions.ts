import { createActions } from 'koota';
import { Time } from '../time/traits';
import { physicsActions } from '../physics/actions';
import { Robot, ROBOT_HALF_EXTENTS } from './traits';

export const robotActions = createActions((world) => ({
  spawnRobot() {
    const entity = world.spawn(Robot);
    physicsActions(world).attachKinematicBody(entity, ROBOT_HALF_EXTENTS);

    return entity;
  },
  resetRobot() {
    world.query(Robot).updateEach(([robot]) => {
      robot.time = undefined;
      robot.runAt = Number.POSITIVE_INFINITY;
      robot.held = undefined;
      robot.active = false;
      robot.departed = false;
    });
  },
  runRobot(delay = 0) {
    world.query(Robot).updateEach(([robot]) => {
      robot.runAt = world.get(Time)!.now + delay * 1000;
    });
  },
  holdRobot(at: number | undefined) {
    world.query(Robot).updateEach(([robot]) => {
      robot.held = at;

      if (at !== undefined) robot.runAt = 0;
    });
  },
}));
