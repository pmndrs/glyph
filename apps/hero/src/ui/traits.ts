import { trait } from 'koota';
import type { OrthographicCamera } from 'three/webgpu';

export interface PlayButtonDraw {
  camera: OrthographicCamera;
  reveal: { value: number };
  hover: { value: number };
  time: { value: number };
  /** Receives the hover state for the cursor. */
  root: { dataset: DOMStringMap };
}

export const PlayButtonView = trait((): PlayButtonDraw | undefined => undefined);

/** How far the button has drawn itself in, 0..1, and whether the pointer is over it once it has begun to. */
export const PlayButton = trait({ reveal: 0, over: false });
