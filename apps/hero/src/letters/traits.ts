import { trait, type Entity } from 'koota';
import type { Mat4, Vec3 } from 'math';
import type { HeldPose } from '../physics/traits';
import type { Flight } from '../black-hole/traits';
import type { Solid } from './utils';
import { FEATURE_LINE } from './content';

/** One letter of the title: its rest place in world units, its solid for the physics, and its glyph. */
export interface Letter {
  readonly home: readonly [x: number, y: number, z: number];
  readonly solid: Solid;
  /** The letter's glyph in the broken-apart copy of the paragraph, and its rest matrix there. */
  readonly index: number;
  readonly original: Mat4;
}

/** A letter's place on the floor, in world units. */
export interface Landing {
  index: number;
  x: number;
  y: number;
}

export interface TitleBodies {
  matrices: Float64Array;
  inverse: Mat4;
  pieces: { letter: Letter; offset: Mat4; entity: Entity }[];
  liftHeight: number;
  lifting: boolean;
  elapsed: number;
  replays: number;
  departing: boolean;
  from: HeldPose[];
  origins: HeldPose[];
  released: Uint8Array;
  swallowed: Uint8Array;
  grow: Float64Array;
  landings: Landing[];
  landingCount: number;
  pose: HeldPose;
  flight: Flight;
  velocity: Vec3;
  scale: Vec3;
  body: Mat4;
  matrix: Mat4;
}

export const Title = trait({
  bodies: (): TitleBodies | undefined => undefined,
  width: undefined as number | undefined,
  reach: 0,
});
export const Typing = trait({
  count: FEATURE_LINE.length,
  beat: 0,
  start: Number.POSITIVE_INFINITY,
});
