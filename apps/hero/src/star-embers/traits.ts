import { trait } from 'koota';
import type { Group } from 'three/webgpu';

export interface EmberDraw {
  groups: (Group | null)[];
  particles: readonly {
    index: number;
    delay: number;
    size: number;
    reachX: number;
    reachY: number;
    angle: number;
    spin: number;
  }[];
  age: { value: number };
  bloom: { value: number };
}

export const EmberView = trait((): EmberDraw | undefined => undefined);

/** Seconds since emission. Negative while waiting. */
export const StarEmbers = trait({ age: -1 });

export const EMBER_SECONDS = 1.25;

/** Unicode star shapes shared by the renderer and its baked font subset. */
export const STAR_SYMBOLS = ['★', '☆', '✦', '✧', '✩', '✶'] as const;
