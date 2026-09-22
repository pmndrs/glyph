import { createWorld } from 'koota';
import { actions } from './actions';
import { WORLD_TRAITS } from './traits';

/** The application shares one initialized world across its domains. */
export const world = createWorld(...WORLD_TRAITS);
actions(world).initializeCameo();
