import { trait } from 'koota';
import type { Vector2 } from 'three/webgpu';

/** Dimensions at the floor plane and camera metrics, synchronized from React. */
export const Viewport = trait({ width: 1, height: 1, cameraZ: 16, aspect: 1 });

export const PaperView = trait((): Vector2 | undefined => undefined);
