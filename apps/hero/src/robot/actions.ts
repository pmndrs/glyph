import { createActions } from 'koota';
import { Robot } from './traits';

export const robotActions = createActions((world) => ({
  run() {
    world.query(Robot).updateEach(([robot]) => {
      robot.runAt = 0;
    });
  },
  hold(at: number | undefined) {
    world.query(Robot).updateEach(([robot]) => {
      robot.held = at;
      if (at !== undefined) robot.runAt = 0;
    });
  },
}));
