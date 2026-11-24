import { createActions } from 'koota';
import { cameraActions } from './camera/actions';
import { directorActions } from './director/actions';
import { diveActions } from './dive/actions';
import { editorActions } from './editor/actions';
import { pageActions } from './page/actions';
import { physicsActions } from './physics/actions';
import { qualityActions } from './quality/actions';
import { sequenceActions } from './sequence/actions';
import { stoneActions } from './stone/actions';
import { titleActions } from './title/actions';
import { viewportActions } from './viewport/actions';

/** Domain commands share one action set for application composition and input. */
export const actions = createActions((world) => ({
  ...cameraActions(world),
  ...directorActions(world),
  ...diveActions(world),
  ...editorActions(world),
  ...pageActions(world),
  ...physicsActions(world),
  ...qualityActions(world),
  ...sequenceActions(world),
  ...stoneActions(world),
  ...titleActions(world),
  ...viewportActions(world),
}));
