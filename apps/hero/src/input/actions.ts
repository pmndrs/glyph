import { createActions } from 'koota';
import { Pointer } from './traits';

export const inputActions = createActions((world) => ({
  samplePointer: (x: number, y: number) => {
    world.set(Pointer, { x, y });
  },
  activatePointer: () => {
    world.set(Pointer, { strength: 1 });
  },
  clearPointer: () => {
    world.set(Pointer, { strength: 0 });
  },
}));
