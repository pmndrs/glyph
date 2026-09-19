import { createActions } from 'koota';
import { blackHoleActions } from './black-hole/actions';
import { fieldActions } from './field/actions';
import { inputActions } from './input/actions';
import { physicsActions } from './physics/actions';
import { robotActions } from './robot/actions';
import { typographyActions } from './typography/actions';
import { viewActions } from './view/actions';
import { Playback } from './traits';

/** Domain commands share one action set for application composition and input. */
export const actions = createActions((world) => ({
  ...blackHoleActions(world),
  ...fieldActions(world),
  ...inputActions(world),
  ...physicsActions(world),
  ...robotActions(world),
  ...typographyActions(world),
  ...viewActions(world),
  initializeHero() {
    physicsActions(world).initializePhysics();
    robotActions(world).spawnRobot();
    typographyActions(world).spawnTypography();
    fieldActions(world).spawnFields();
  },
  replayHero() {
    world.get(Playback)!.started = true;
    blackHoleActions(world).dismissBlackHole();
    typographyActions(world).replayTitle();
    robotActions(world).resetRobot();
    fieldActions(world).resetFields();
  },
  disposeHero() {
    world.destroy();
  },
}));
