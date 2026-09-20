import { createActions } from 'koota';
import { Pointer } from './traits';

export const inputActions = createActions((world) => ({
  activatePointer: () => {
    world.set(Pointer, { strength: 1 });
  },
  clearPointer: () => {
    world.set(Pointer, { strength: 0 });
  },
}));
