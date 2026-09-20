import type { World } from 'koota';
import { Collapse } from '../black-hole/traits';
import { starEmberActions } from './actions';

/** Follow the black-hole pop age so emission and replay share the same clock. */
export function syncStarEmbers(world: World): void {
  starEmberActions(world).sampleStarEmbers(world.get(Collapse)!.hole.sincePop);
}
