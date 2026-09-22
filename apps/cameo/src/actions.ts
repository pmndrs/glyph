import { createActions } from 'koota';
import { cameoActions } from './cameo/actions';
import { iconFieldActions } from './icon-field/actions';
import { robotActions } from './robot/actions';
import { sequenceActions } from './sequence/actions';

/** Domain commands share one action set for application composition. */
export const actions = createActions((world) => ({
  ...cameoActions(world),
  ...iconFieldActions(world),
  ...robotActions(world),
  ...sequenceActions(world),
}));
