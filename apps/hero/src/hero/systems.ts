import type { World } from 'koota';
import { sequenceActions } from '../sequence/actions';
import { advanceSequence } from '../sequence/systems';
import { iconFieldActions } from '../icon-field/actions';
import { starEmberActions } from '../star-embers/actions';
import { advanceCollapse } from '../black-hole/systems';
import { Collapse } from '../black-hole/traits';
import { moveIconFields } from '../icon-field/systems';
import { fadePointer } from '../input/systems';
import { stepPhysics } from '../physics/systems';
import { moveRobots, moveRobotBodies, stepDust } from '../robot/systems';
import { Robot } from '../robot/traits';
import { updateTime } from '../time/systems';
import { moveTitle, syncTitle, typeFeature } from '../letters/systems';
import { Title } from '../letters/traits';
import { Preparation } from './traits';

/** Step the domains and feed their published events into the hero script. */
export function advanceHero(world: World, delta: number, now: number): void {
  const ready = world.get(Preparation)!.ready;
  updateTime(world, delta, now, ready);

  if (!ready) return;

  advanceSequence(world);

  moveRobots(world);

  world.query(Robot).readEach(([robot]) => {
    if (robot.departed) sequenceActions(world).triggerSequence('robot-departed');
  });

  advanceSequence(world);
  advanceCollapse(world);
  const hole = world.get(Collapse)!.hole;
  starEmberActions(world).sampleStarEmbers(hole.sincePop);
  moveTitle(world, hole);
  moveRobotBodies(world);
  stepPhysics(world);
  syncTitle(world);

  world.query(Title).readEach(([title]) => {
    const bodies = title.bodies;

    if (bodies === undefined || bodies.landingCount === 0) return;

    for (let slot = 0; slot < bodies.landingCount; slot++) {
      const landing = bodies.landings[slot]!;
      iconFieldActions(world).impactIconFields(landing.x, landing.y, 0);
    }

    sequenceActions(world).triggerSequence('letters-landed');
  });

  advanceSequence(world);

  if (hole.beat === 'closed') typeFeature(world);

  fadePointer(world);
  moveIconFields(world, hole);
  stepDust(world);
}
