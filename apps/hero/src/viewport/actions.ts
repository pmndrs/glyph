import { createActions } from 'koota';
import { Viewport } from './traits';

export const viewportActions = createActions((world) => ({
  setViewport: (width: number, height: number) => {
    world.set(Viewport, { width, height, aspect: width / Math.max(height, 1) });
  },
}));
