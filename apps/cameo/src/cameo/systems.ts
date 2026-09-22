import type { World } from 'koota';
import { iconFieldActions } from '../icon-field/actions';
import { pressIconField } from '../icon-field/systems';
import { SHOCKS } from '../robot/content';
import { Robot } from '../robot/traits';
import { sequenceActions } from '../sequence/actions';
import { Time } from '../time/traits';
import { cameoActions } from './actions';
import { Lens, LensView } from './traits';

/** Feed the robot leaving the frame back into the script, which calls the next take. */
export function triggerTakeEnd(world: World): void {
  world.query(Robot).readEach(([robot]) => {
    if (robot.finished) sequenceActions(world).triggerSequence('take-finished');
  });
}

/**
 * Put the robot on the icon floor: its wheels shove the cells they roll past, and the beats where it brakes or
 * pulls away thump the sheets, which answer with a travelling ring.
 */
export function pressFloorWithRobot(world: World): void {
  const delta = world.get(Time)!.delta;

  world.query(Robot).readEach(([robot]) => {
    const now = robot.time;
    pressIconField(world, robot.pose.x, robot.pose.y, now !== undefined);

    if (now === undefined) return;

    for (const shock of SHOCKS) {
      if (now < shock.at || now - delta >= shock.at) continue;

      iconFieldActions(world).shockIconField(robot.pose.x, robot.pose.y);
      cameoActions(world).kickLens(shock.force);
    }
  });
}

/** How long a knock rings out. */
const SHAKE_SECONDS = 0.45;

/**
 * Ring the lens out after a knock: three fast, decaying wobbles about its own axes, on top of the orientation it
 * rests at. Nothing else ever moves it, so the rest is simply copied back when the ringing is over.
 */
export function shakeLens(world: World): void {
  const view = world.get(LensView);

  if (view === undefined) return;

  const { shookAt, force } = world.get(Lens)!;
  const since = world.get(Time)!.elapsed - shookAt;
  view.camera.quaternion.copy(view.rest);

  if (since < 0 || since > SHAKE_SECONDS || force <= 0) return;

  const fade = Math.exp(-since / 0.1) * force;
  view.camera.rotateX(Math.sin(since * 58) * 0.007 * fade);
  view.camera.rotateY(Math.sin(since * 41 + 1.7) * 0.006 * fade);
  view.camera.rotateZ(Math.sin(since * 33 + 0.6) * 0.005 * fade);
}
