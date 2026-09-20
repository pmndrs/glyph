import { trait } from 'koota';

/** Dimensions at the floor plane, sampled by the renderer. */
export const Viewport = trait({ width: 1, height: 1, cameraZ: 16, aspect: 1 });
