import type { World } from 'koota';
import { sequenceActions } from './actions';
import { blackHoleActions } from '../black-hole/actions';
import { iconFieldActions } from '../icon-field/actions';
import { robotActions } from '../robot/actions';
import { letterActions } from '../letters/actions';
import { starEmberActions } from '../star-embers/actions';
import { Playback } from './traits';
import { advanceCollapse } from '../black-hole/systems';
import { Collapse } from '../black-hole/traits';
import { moveIconFields } from '../icon-field/systems';
import { fadePointer } from '../input/systems';
import { stepPhysics } from '../physics/systems';
import { moveRobots, moveRobotBodies, stepDust } from '../robot/systems';
import { Robot } from '../robot/traits';
import { updateTime } from '../time/systems';
import { Time } from '../time/traits';
import { moveTitle, syncTitle, typeFeature } from '../letters/systems';
import { Title } from '../letters/traits';
import { Preparation } from '../view/traits';

/** Advance the sequence and connect each domain's published events to the next beat. */
export function advanceSequence(world: World, delta: number, now: number): void {
  const ready = world.get(Preparation)!.ready;
  updateTime(world, delta, now, ready);

  if (!ready) return;

  // Give the prepared scene one beat before the first lift.
  if (!world.get(Playback)!.started && world.get(Time)!.elapsed >= 1) sequenceActions(world).replaySequence();

  moveRobots(world);

  world.query(Robot).readEach(([robot]) => {
    if (robot.departed) blackHoleActions(world).openBlackHole();
  });

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

    letterActions(world).typeFeatureAfter(0.55);
    robotActions(world).runRobot(1.4);
  });

  if (hole.beat === 'closed') typeFeature(world);

  fadePointer(world);
  moveIconFields(world, hole);
  stepDust(world);
}
