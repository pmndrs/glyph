import { createActions } from 'koota';
import { Robot } from './traits';

export const robotActions = createActions((world) => ({
  run() {
    for (const entity of world.query(Robot)) entity.get(Robot)!.runAt = 0;
  },
  hold(at: number | undefined) {
    for (const entity of world.query(Robot)) {
      const robot = entity.get(Robot)!;
      robot.held = at;
      if (at !== undefined) robot.runAt = 0;
    }
  },
}));
