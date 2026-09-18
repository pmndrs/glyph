import { createActions } from 'koota';
import { vec3 } from 'math';
import { Frame, Sequence } from './traits';
import { collapseAt } from './motion';
import { Robot } from '../robot/traits';
import { Title, Typing } from '../typography/traits';
import { replayTitle } from '../typography/bodies';

/** Discrete transitions live here; callers supply the world rather than reaching into module globals. */
export const sequenceActions = createActions((world) => ({
  openCollapse() {
    const sequence = world.get(Sequence)!;
    sequence.openedAt ??= world.get(Frame)!.now;
  },
  dismissCollapse() {
    const sequence = world.get(Sequence)!;
    sequence.openedAt = undefined;
    sequence.held = undefined;
    collapseAt(sequence.hole, -1);
  },
  holdCollapse(at: number | undefined) {
    const sequence = world.get(Sequence)!;
    sequence.held = at;
    if (at !== undefined) sequence.openedAt ??= world.get(Frame)!.now;
  },
  impact(x: number, y: number, z: number) {
    const sequence = world.get(Sequence)!;
    sequence.latestImpact = (sequence.latestImpact + 1) % sequence.impacts.length;
    const impact = sequence.impacts[sequence.latestImpact]!;
    impact.id = sequence.nextImpact++;
    impact.at = world.get(Frame)!.now;
    vec3.set(impact.world, x, y, z);
  },
  replay() {
    const sequence = world.get(Sequence)!;
    sequence.replays++;
    sequence.openedAt = undefined;
    sequence.held = undefined;
    collapseAt(sequence.hole, -1);
    for (const entity of world.query(Title)) {
      const title = entity.get(Title)!;
      if (title.bodies !== undefined) replayTitle(title.bodies);
    }
    for (const entity of world.query(Typing)) {
      const typing = entity.get(Typing)!;
      typing.start = Number.POSITIVE_INFINITY;
      typing.beat = 0;
      typing.count = 0;
      typing.wave = sequence.nextImpact - 1;
    }
    for (const entity of world.query(Robot)) {
      const robot = entity.get(Robot)!;
      robot.time = undefined;
      robot.runAt = Number.POSITIVE_INFINITY;
      robot.held = undefined;
      robot.active = false;
      robot.wave = sequence.nextImpact - 1;
    }
  },
}));
