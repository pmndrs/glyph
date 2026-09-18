import { createWorld } from 'koota';
import { Playback, heroActions } from './actions';
import { Collapse } from './black-hole/traits';
import { Impacts } from './field/traits';
import { Pointer } from './input/traits';
import { Physics } from './physics/traits';
import { subscribePhysics } from './physics/systems';
import { Time } from './time/traits';
import { Preparation, Viewport } from './view/traits';

/** Compose domains on one world before playback. */
export function createHeroWorld() {
  const world = createWorld(Time, Pointer, Viewport, Preparation, Playback, Collapse, Impacts, Physics);
  subscribePhysics(world);
  heroActions(world).spawn();

  return world;
}
