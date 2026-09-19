import { createActions } from 'koota';
import { Pointer } from './traits';

export const inputActions = createActions((world) => ({
  samplePointer(x: number, y: number) {
    const pointer = world.get(Pointer)!;
    pointer.x = x;
    pointer.y = y;
  },
  activatePointer() {
    world.get(Pointer)!.strength = 1;
  },
  clearPointer() {
    world.get(Pointer)!.strength = 0;
  },
}));
