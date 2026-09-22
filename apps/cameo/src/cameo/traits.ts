import { trait } from 'koota';
import type { PerspectiveCamera, Quaternion } from 'three/webgpu';

/** The canvas shape, which is all the choreography needs from React: it decides where off frame begins. */
export const Frame = trait({ aspect: 1 });

/** When the lens was last knocked, in playback seconds, and how hard. */
export const Lens = trait({ shookAt: Number.NEGATIVE_INFINITY, force: 0 });

export interface LensDraw {
  camera: PerspectiveCamera;
  /** Where the lens points when nothing has hit it, which every knock is applied on top of. */
  rest: Quaternion;
}

export const LensView = trait((): LensDraw | undefined => undefined);
