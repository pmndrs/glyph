import { createActions } from 'koota';
import { Viewport } from './traits';

export const viewportActions = createActions((world) => ({
  setViewport: (width: number, height: number, cameraZ: number, aspect: number) => {
    world.set(Viewport, { width, height, cameraZ, aspect });
  },
}));
