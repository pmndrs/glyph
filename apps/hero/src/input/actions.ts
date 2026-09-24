import { createActions } from 'koota';
import { Pointer } from './traits';

export const inputActions = createActions((world) => ({
  movePointer: (x: number, y: number) => {
    world.set(Pointer, { x, y, present: true, strength: 1 });
  },
  clearPointer: () => {
    world.set(Pointer, { present: false, strength: 0 });
  },
}));
