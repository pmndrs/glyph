import { createActions } from 'koota';
import { Preparation, Viewport } from './traits';

export const viewActions = createActions((world) => ({
  sampleView(width: number, height: number, cameraZ: number, aspect: number, ready: boolean) {
    const view = world.get(Viewport)!;
    view.width = width;
    view.height = height;
    view.cameraZ = cameraZ;
    view.aspect = aspect;
    world.get(Preparation)!.ready = ready;
  },
}));
