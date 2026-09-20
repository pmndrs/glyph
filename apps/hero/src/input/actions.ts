import { createActions } from 'koota';
import { Keys, Pointer } from './traits';

export const inputActions = createActions((world) => ({
  setKey: (key: string, down: boolean) => {
    const keys = world.get(Keys)!;

    if (down) keys.add(key);
    else keys.delete(key);

    world.set(Keys, keys);
  },
  clearKeys: () => {
    const keys = world.get(Keys)!;
    keys.clear();
    world.set(Keys, keys);
  },
  movePointer: (x: number, y: number) => {
    world.set(Pointer, { x, y, strength: 1 });
  },
  clearPointer: () => {
    world.set(Pointer, { strength: 0 });
  },
}));
