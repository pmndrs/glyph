import { createWorld } from 'koota';
import { actions } from './actions';
import { Timeline } from './sequence/traits';
import { Collapse } from './black-hole/traits';
import { Impacts } from './icon-paper/traits';
import { Pointer } from './input/traits';
import { Time } from './time/traits';
import { Mode } from './director/traits';
import { Viewport } from './viewport/traits';

/** The application shares one initialized world across its domains. */
export const world = createWorld(Time, Pointer, Viewport, Mode, Timeline, Collapse, Impacts);
actions(world).initializeScene();
