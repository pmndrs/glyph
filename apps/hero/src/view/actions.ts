import { createActions } from 'koota';
import { Preparation, Viewport } from './traits';

export const viewActions = createActions((world) => ({
  sampleView(width: number, height: number, cameraZ: number, aspect: number, ready: boolean) {
    world.set(Viewport, { width, height, cameraZ, aspect });
    world.set(Preparation, { ready });
  },
}));
