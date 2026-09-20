import { trait, type Entity } from 'koota';
import type { Mesh } from 'three/webgpu';
import type { Side } from './utils';

export const Viewport = trait({ width: 1, height: 1 });

/**
 * The body and its stats. It runs along the floor to stand under whichever letter lands first, but only as fast as
 * `speed` allows, and a hand closes only on a letter within `grip` of it: too many letters in the air and some drop.
 */
export const Juggler = trait({
  x: 0,
  vx: 0,
  stride: 0,
  idleSince: 0,
  /** Body speed in px/s. */
  speed: 1400,
  /** Hand speed in px/s. */
  handSpeed: 2000,
  /** How far from the shoulder a free hand reaches toward an incoming letter. */
  reach: 80,
  /** Largest gap between a hand and a landing letter that still counts as a catch. */
  grip: 34,
  dropped: 0,
});

/** One hand. It catches on the outside, carries inward, throws from beside the body, and reaches for what comes next. */
export const Hand = trait({
  side: 'left' as Side,
  x: 0,
  y: 0,
  heldFor: 0,
  holding: undefined as Entity | undefined,
  /** Where the next letter assigned to this hand will land, if one is airborne. */
  incoming: false,
  incomingX: 0,
});

export interface FigureDraw {
  parts: Map<string, Mesh>;
  /** Eased body velocity so lean and stride do not flicker with the chase steps. */
  eased: number;
  joint: [number, number];
}

export const FigureView = trait((): FigureDraw | undefined => undefined);
