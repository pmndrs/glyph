import { createActions } from 'koota';
import { vec3 } from 'math';
import { Frame, Sequence } from './traits';
import { collapseAt } from './motion';
import { Robot } from '../robot/traits';
import { Title, Typing } from '../typography/traits';
import { replayTitle } from '../typography/bodies';

/** World-bound playback transitions. */
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

    world.query(Title).updateEach(([title]) => {
      if (title.bodies !== undefined) replayTitle(world, title.bodies);
    });

    world.query(Typing).updateEach(([typing]) => {
      typing.start = Number.POSITIVE_INFINITY;
      typing.beat = 0;
      typing.count = 0;
      typing.wave = sequence.nextImpact - 1;
    });

    world.query(Robot).updateEach(([robot]) => {
      robot.time = undefined;
      robot.runAt = Number.POSITIVE_INFINITY;
      robot.held = undefined;
      robot.active = false;
      robot.wave = sequence.nextImpact - 1;
    });
  },
}));
