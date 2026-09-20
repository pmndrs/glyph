import { createActions } from 'koota';
import { StarEmbers, EmberView, type EmberDraw } from './traits';

export const starEmberActions = createActions((world) => ({
  mountEmberView: (view: EmberDraw) => {
    world.add(EmberView(view));
  },
  unmountEmberView: () => {
    world.remove(EmberView);
  },
  initializeStarEmbers: () => {
    world.add(StarEmbers);
  },
  resetStarEmbers: () => {
    world.set(StarEmbers, { age: -1 });
  },
}));
