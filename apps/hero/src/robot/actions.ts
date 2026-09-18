import { createActions } from 'koota';
import { Time } from '../time/traits';
import { physicsActions } from '../physics/actions';
import { Robot, ROBOT_HALF_EXTENTS } from './traits';

export const robotActions = createActions((world) => ({
  spawn() {
    const entity = world.spawn(Robot);
    physicsActions(world).attachKinematic(entity, ROBOT_HALF_EXTENTS);

    return entity;
  },
  reset() {
    world.query(Robot).updateEach(([robot]) => {
      robot.time = undefined;
      robot.runAt = Number.POSITIVE_INFINITY;
      robot.held = undefined;
      robot.active = false;
      robot.departed = false;
    });
  },
  run(delay = 0) {
    world.query(Robot).updateEach(([robot]) => {
      robot.runAt = world.get(Time)!.now + delay * 1000;
    });
  },
  hold(at: number | undefined) {
    world.query(Robot).updateEach(([robot]) => {
      robot.held = at;

      if (at !== undefined) robot.runAt = 0;
    });
  },
}));
