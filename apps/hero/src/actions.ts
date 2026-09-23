import { createActions } from 'koota';
import { heroActions } from './hero/actions';
import { blackHoleActions } from './black-hole/actions';
import { iconPaperActions } from './icon-paper/actions';
import { inputActions } from './input/actions';
import { physicsActions } from './physics/actions';
import { robotActions } from './robot/actions';
import { letterActions } from './letters/actions';
import { sequenceActions } from './sequence/actions';
import { starEmberActions } from './star-embers/actions';
import { rainActions } from './rain/actions';
import { soundActions } from './sound/actions';

/** Domain commands share one action set for application composition and input. */
export const actions = createActions((world) => ({
  ...blackHoleActions(world),
  ...heroActions(world),
  ...iconPaperActions(world),
  ...inputActions(world),
  ...physicsActions(world),
  ...robotActions(world),
  ...sequenceActions(world),
  ...starEmberActions(world),
  ...rainActions(world),
  ...soundActions(world),
  ...letterActions(world),
}));
