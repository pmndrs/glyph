import { trait, type Entity } from 'koota';
import type { Group, Object3D } from 'three/webgpu';
import type { Solid } from '../letters/utils';
import { COUNT } from './content';

export type DropPhase = 'idle' | 'live' | 'fading' | 'eaten';

export interface Drop {
  phase: DropPhase;
  /** The glyph's body while live. */
  entity: Entity | undefined;
  /** Its last pose, kept for the fade, and where the hole took it from, for the flight in. */
  x: number;
  y: number;
  z: number;
  yaw: number;
  size: number;
  /** Which drop this was, so the oldest can be found. */
  serial: number;
  /** Seconds fading or flying in. */
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

/** The rain's draws: the group every glyph hangs under, for the glass projection to capture, and a group a slot. */
export interface RainDraw {
  root: Object3D;
  groups: (Group | null)[];
}

export const RainView = trait((): RainDraw | undefined => undefined);
