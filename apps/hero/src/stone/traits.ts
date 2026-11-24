import { trait } from 'koota';
import type { Camera, Object3D } from 'three/webgpu';
import { HORIZON } from './content';

/** The stone on the page, in page units, x right and y down. */
export const Stone = trait({
  /** Whether it is on the page at all. Its drawn `presence` eases after this. */
  present: false,
  presence: 0,
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  /** Where it is being led: a hand holding it, or the script's path. Undefined lets it coast. */
  leadX: undefined as number | undefined,
  leadY: undefined as number | undefined,
  horizon: HORIZON,
  /** Accumulated turn of the disk, in radians. */
  spin: 0,
  /** 0..1, rising with each letter swallowed and cooling after. */
  heat: 0,
  /** Capture allowance: whole letters it may take this frame accumulate here. */
  appetite: 0,
  /** The rewind in progress: seconds since it began, or negative when none. */
  rewinding: -1,
  swallowed: 0,
  /** The spread geometry the walls were last stood for. */
  fenced: -1,
});

/** The stone's mounted drawing, and the camera its place on screen is taken through. */
export interface StoneDraw {
  group: Object3D;
  camera: Camera;
  uniforms: typeof import('./materials').stoneUniforms;
}

export const StoneView = trait((): StoneDraw | undefined => undefined);

/** The order letters were taken in, as letter indices, so the rewind gives them back last taken first. */
export const Taken = trait(() => ({ order: [] as number[] }));
