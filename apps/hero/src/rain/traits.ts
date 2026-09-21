import { trait, type Entity } from 'koota';
import type { Group } from 'three/webgpu';
import type { Solid } from '../letters/utils';
import { COUNT } from './content';

export type DropPhase = 'idle' | 'live' | 'fading';

export interface Drop {
  phase: DropPhase;
  /** The glyph's body while live. */
  entity: Entity | undefined;
  /** Its last pose, kept for the fade. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  size: number;
  /** Which drop this was, so the oldest can be found. */
  serial: number;
  /** Seconds fading. */
  age: number;
}

/** Glyph rain over the paper in play: one slot a prepared glyph. */
export const Rain = trait({
  drops: (): Drop[] =>
    Array.from({ length: COUNT }, () => ({
      phase: 'idle',
      entity: undefined,
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      size: 1,
      serial: 0,
      age: 0,
    })),
  /** Each slot's glyph as a unit-size solid, prepared by the renderer before playback. */
  solids: (): (Solid | undefined)[] => Array.from({ length: COUNT }, () => undefined),
  /** Playback second of the next drop, and how many have fallen. */
  dropAt: 0,
  dropped: 0,
});

export const RainView = trait((): (Group | null)[] | undefined => undefined);
