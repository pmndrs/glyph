import { createActions } from 'koota';
import type { Projection } from './renderer';
import { LensView, ShadowView, type Lens } from './traits';

export const glassActions = createActions((world) => ({
  mountShadowView: (view: Projection) => {
    world.add(ShadowView(view));
  },
  unmountShadowView: () => {
    world.remove(ShadowView);
  },
  mountLensView: (view: Lens) => {
    world.add(LensView(view));
  },
  unmountLensView: () => {
    world.remove(LensView);
  },
}));
