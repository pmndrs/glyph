import { trait } from 'koota';
import type { Vector2 } from 'three/webgpu';

/** Dimensions at the floor plane and camera metrics, synchronized from React. */
export const Viewport = trait({ width: 1, height: 1, cameraZ: 16, aspect: 1 });

export type ModeKind = 'sequence' | 'play';

/**
 * Which script the world is running: the scripted sequence, or free play with the robot under the pointer, and the
 * playback second it began.
 */
export const Mode = trait({ kind: 'sequence' as ModeKind, since: 0 });

export const PaperView = trait((): Vector2 | undefined => undefined);
