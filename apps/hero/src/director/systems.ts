import type { World } from 'koota';
import { sequenceActions } from '../sequence/actions';
import { iconPaperActions } from '../icon-paper/actions';
import { Robot } from '../robot/traits';
import { Title } from '../letters/traits';

/** Feed robot departure into the script. */
export function triggerRobotDeparture(world: World): void {
  world.query(Robot).readEach(([robot]) => {
    if (robot.departed) sequenceActions(world).triggerSequence('robot-departed');
  });
}

/** Turn letter landings into field impacts and script events. */
export function applyLetterLandings(world: World): void {
  world.query(Title).readEach(([title]) => {
    const bodies = title.bodies;

    if (bodies === undefined || bodies.landingCount === 0) return;

    for (let slot = 0; slot < bodies.landingCount; slot++) {
      const landing = bodies.landings[slot]!;
      iconPaperActions(world).impactIconPaper(landing.x, landing.y);
    }

    sequenceActions(world).triggerSequence('letters-landed');
  });
}
