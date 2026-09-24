import { createActions } from 'koota';
import { directorActions } from './director/actions';
import { blackHoleActions } from './black-hole/actions';
import { iconPaperActions } from './icon-paper/actions';
import { inputActions } from './input/actions';
import { physicsActions } from './physics/actions';
import { robotActions } from './robot/actions';
import { letterActions } from './letters/actions';
import { sequenceActions } from './sequence/actions';
import { starEmberActions } from './star-embers/actions';
import { rainActions } from './rain/actions';
import { paperActions } from './paper/actions';
import { glassActions } from './glass/actions';
import { uiActions } from './ui/actions';
import { soundActions } from './sound/actions';
import { viewportActions } from './viewport/actions';

/** Domain commands share one action set for application composition and input. */
export const actions = createActions((world) => ({
  ...blackHoleActions(world),
  ...directorActions(world),
  ...iconPaperActions(world),
  ...inputActions(world),
  ...physicsActions(world),
  ...robotActions(world),
  ...sequenceActions(world),
  ...starEmberActions(world),
  ...rainActions(world),
  ...paperActions(world),
  ...glassActions(world),
  ...uiActions(world),
  ...soundActions(world),
  ...letterActions(world),
  ...viewportActions(world),
}));
