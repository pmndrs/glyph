import { trait, type Entity } from 'koota';
import type { Mat4, Vec3 } from 'math';
import type { HeldPose } from '../physics/traits';
import type { Flight } from '../black-hole/traits';
import type { Solid } from './utils';
import { FEATURE_LINE } from './content';
import type { Projection } from './shadows';
import type { Glyphs } from '@pmndrs/glyph/three';
import type { Matrix4 } from 'three/webgpu';
import type { RetainedLine } from './text';

export const ShadowView = trait((): Projection | undefined => undefined);

export interface TitleDraw {
  glyphs: Glyphs;
  draw: Matrix4;
}

export interface FeatureDraw {
  line: RetainedLine;
  collapsed: boolean;
  work: {
    transform: Mat4;
    rotation: Mat4;
    pivot: Mat4;
    world: Mat4;
    inverse: Mat4;
    center: Vec3;
    scale: Vec3;
    flight: Flight;
  };
}

export const TitleView = trait((): TitleDraw | undefined => undefined);
export const FeatureView = trait((): FeatureDraw | undefined => undefined);

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
