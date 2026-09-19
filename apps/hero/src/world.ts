import { createWorld } from 'koota';
import { actions } from './actions';
import { Playback } from './sequence/traits';
import { Collapse } from './black-hole/traits';
import { Impacts } from './icon-field/traits';
import { Pointer } from './input/traits';
import { Time } from './time/traits';
import { Preparation, Viewport } from './view/traits';

/** Compose domains on one world before playback. */
export function createHeroWorld() {
  const world = createWorld(Time, Pointer, Viewport, Preparation, Playback, Collapse, Impacts);
  actions(world).initializeHero();

  return world;
}
