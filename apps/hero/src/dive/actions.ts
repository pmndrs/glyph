import { createActions } from 'koota';
import { DiveView, type DiveDraw } from './traits';

export const diveActions = createActions((world) => ({
  mountDiveView: (view: DiveDraw) => {
    world.set(DiveView, view);
  },
  unmountDiveView: () => {
    world.set(DiveView, undefined);
  },
}));
