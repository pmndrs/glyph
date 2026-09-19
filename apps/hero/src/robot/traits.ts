import { trait, type TraitRecord } from 'koota';
import { vec2, vec3 } from 'math';
import { COUNT } from './utils';

/** Along the heading, across it, and up. Shared by the visual rig and its prepared collider. */
export const ROBOT_HALF_EXTENTS: readonly [number, number, number] = [0.68, 1.07, 1.5];

/** An upright robot footprint in the screen plane, shared with title collisions. */
export interface Footprint {
  readonly x: number;
  readonly y: number;
  /** Centre height above the floor. */
  readonly z: number;
  /** Direction of travel, from the x axis. */
  readonly heading: number;
  /** Along the direction of travel, across it, and up. */
  readonly halfExtents: readonly [number, number, number];
}

export const Robot = trait({
  motion: () => ({ path: { inward: 0, outward: 0, phase: 0 }, pose: { x: 0, y: 0, heading: 0, look: 0 } }),
  dust: () => ({
    particles: Array.from({ length: COUNT }, () => ({
      age: 1,
      life: 1,
      position: vec3.create(),
      velocity: vec3.create(),
      roll: 0,
      spin: 0,
      size: 1,
    })),
    previous: vec2.create(),
    hasPrevious: false,
    carry: 0,
    emitted: 0,
  }),
  footprint: () => ({ x: 0, y: 0, z: 0.04, heading: 0, halfExtents: ROBOT_HALF_EXTENTS }),
  physicsPose: () => ({ x: 0, y: 0, z: 0, yaw: 0 }),
  active: false,
  time: undefined as number | undefined,
  runAt: Number.POSITIVE_INFINITY,
  held: undefined as number | undefined,
  runs: 0,
  departed: false,
  gone: false,
});

export type DustState = TraitRecord<typeof Robot>['dust'];
