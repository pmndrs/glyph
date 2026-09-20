import { createWorld } from 'koota';
import { actions } from './actions';
import { Timeline } from './sequence/traits';
import { Collapse } from './black-hole/traits';
import { Impacts } from './icon-field/traits';
import { Keys, Pointer } from './input/traits';
import { Time } from './time/traits';
import { Viewport } from './hero/traits';

/** The application shares one initialized world across its domains. */
export const world = createWorld(Time, Keys, Pointer, Viewport, Timeline, Collapse, Impacts);
actions(world).initializeHero();
