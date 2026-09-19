import { createActions } from 'koota';
import { blackHoleActions } from './black-hole/actions';
import { iconFieldActions } from './icon-field/actions';
import { inputActions } from './input/actions';
import { physicsActions } from './physics/actions';
import { robotActions } from './robot/actions';
import { letterActions } from './letters/actions';
import { viewActions } from './view/actions';
import { sequenceActions } from './sequence/actions';
import { starEmberActions } from './star-embers/actions';

/** Domain commands share one action set for application composition and input. */
export const actions = createActions((world) => ({
  ...blackHoleActions(world),
  ...iconFieldActions(world),
  ...inputActions(world),
  ...physicsActions(world),
  ...robotActions(world),
  ...sequenceActions(world),
  ...starEmberActions(world),
  ...letterActions(world),
  ...viewActions(world),
  initializeHero: () => {
    physicsActions(world).initializePhysics();
    sequenceActions(world).spawnSequence();
  },
  disposeHero: () => {
    world.destroy();
  },
}));
