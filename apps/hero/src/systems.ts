import type { World } from 'koota';
import { actions } from './actions';
import { Playback } from './traits';
import { advanceCollapse } from './black-hole/systems';
import { Collapse } from './black-hole/traits';
import { moveFields } from './field/systems';
import { fadePointer } from './input/systems';
import { stepPhysics } from './physics/systems';
import { moveRobots, moveRobotBodies, emitDust } from './robot/systems';
import { Robot } from './robot/traits';
import { updateTime } from './time/systems';
import { Time } from './time/traits';
import { moveTitle, syncTitle, typeFeature } from './typography/systems';
import { Title } from './typography/traits';
import { Preparation } from './view/traits';

/** Domain order and cross-domain reactions belong to the application. */
export function advanceHero(world: World, delta: number, now: number): void {
  const ready = world.get(Preparation)!.ready;
  updateTime(world, delta, now, ready);

  if (!ready) return;

  // Give the prepared scene one beat before the first lift.
  if (!world.get(Playback)!.started && world.get(Time)!.elapsed >= 1) actions(world).replayHero();

  moveRobots(world);

  world.query(Robot).readEach(([robot]) => {
    if (robot.departed) actions(world).openBlackHole();
  });

  advanceCollapse(world);
  const hole = world.get(Collapse)!.hole;
  moveTitle(world, hole);
  moveRobotBodies(world);
  stepPhysics(world);
  syncTitle(world);

  world.query(Title).readEach(([title]) => {
    const bodies = title.bodies;

    if (bodies === undefined || bodies.landingCount === 0) return;

    for (let slot = 0; slot < bodies.landingCount; slot++) {
      const landing = bodies.landings[slot]!;
      actions(world).impactFields(landing.x, landing.y, 0);
    }

    actions(world).typeFeatureAfter(0.55);
    actions(world).runRobot(1.4);
  });

  if (hole.beat === 'closed') typeFeature(world);

  fadePointer(world);
  moveFields(world, hole);
  emitDust(world);
}
