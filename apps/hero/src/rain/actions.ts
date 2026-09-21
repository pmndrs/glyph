import { createActions } from 'koota';
import type { Solid } from '../letters/utils';
import { physicsActions } from '../physics/actions';
import { Rain, RainView, type RainDraw } from './traits';

export const rainActions = createActions((world) => ({
  initializeRain: () => {
    world.add(Rain);
  },
  /** Keep a slot's glyph solid, cut at unit size, for the drops that use it. */
  prepareRainGlyph: (slot: number, solid: Solid) => {
    world.get(Rain)!.solids[slot] = solid;
  },
  /** Take a glyph's body away and free its slot, either fading it out first or at once. */
  dismissDrop: (slot: number, fade: boolean) => {
    const drop = world.get(Rain)!.drops[slot]!;

    if (drop.entity !== undefined) physicsActions(world).destroyBody(drop.entity);

    drop.entity = undefined;
    drop.phase = fade ? 'fading' : 'idle';
    drop.age = 0;
  },
  mountRainView: (view: RainDraw) => {
    world.add(RainView(view));
  },
  unmountRainView: () => {
    world.remove(RainView);
  },
}));
