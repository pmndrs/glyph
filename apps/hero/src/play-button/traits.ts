import { trait } from 'koota';
import type { OrthographicCamera } from 'three/webgpu';

export interface PlayButtonDraw {
  camera: OrthographicCamera;
  reveal: { value: number };
  hover: { value: number };
  /** Receives the hover state for the cursor. */
  root: { dataset: DOMStringMap };
}

export const PlayButtonView = trait((): PlayButtonDraw | undefined => undefined);
