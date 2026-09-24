import { createActions } from 'koota';
import { EmberView, type EmberDraw } from './traits';

export const starEmberActions = createActions((world) => ({
  mountEmberView: (view: EmberDraw) => {
    world.add(EmberView(view));
  },
  unmountEmberView: () => {
    world.remove(EmberView);
  },
}));
