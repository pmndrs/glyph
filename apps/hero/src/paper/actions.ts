import { createActions } from 'koota';
import type { Vector2 } from 'three/webgpu';
import { PaperView } from './traits';

export const paperActions = createActions((world) => ({
  mountPaperView: (drift: Vector2) => {
    world.add(PaperView(drift));
  },
  unmountPaperView: () => {
    world.remove(PaperView);
  },
}));
