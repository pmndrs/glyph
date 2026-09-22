import { createActions } from 'koota';
import { iconFieldActions } from '../icon-field/actions';
import { robotActions } from '../robot/actions';
import { RESET_SECONDS } from '../robot/content';
import { sequenceActions } from '../sequence/actions';
import { Time } from '../time/traits';
import { Frame, Lens, LensView, type LensDraw } from './traits';

export const cameoActions = createActions((world) => ({
  setFrame: (aspect: number) => {
    world.set(Frame, { aspect });
  },
  mountLensView: (view: LensDraw) => {
    world.add(LensView(view));
  },
  unmountLensView: () => {
    world.remove(LensView);
  },
  /** Knock the lens. A hard stop a few feet from it is felt, which is most of what sells the stop. */
  kickLens: (force: number) => {
    world.set(Lens, { shookAt: world.get(Time)!.elapsed, force });
  },
  /**
   * The whole film: one take is called shortly after the scene is ready, and the robot leaving calls the next.
   * Everything inside a take is the robot's own clock, declared in its script.
   */
  initializeCameo: () => {
    iconFieldActions(world).spawnIconField();
    robotActions(world).spawnRobot();
    sequenceActions(world).loadSequence([
      { at: 0.6, run: () => robotActions(world).callRobotAction() },
      { on: 'take-finished', after: RESET_SECONDS, run: () => robotActions(world).callRobotAction() },
    ]);
  },
}));
