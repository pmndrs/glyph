import { trait } from 'koota';
import type { Object3D } from 'three/webgpu';

export interface DiveDraw {
  /** The drop cap's outline, drawn in em units about its pen origin. */
  group: Object3D;
  uniforms: typeof import('./materials').diveUniforms;
}

export const DiveView = trait((): DiveDraw | undefined => undefined);
