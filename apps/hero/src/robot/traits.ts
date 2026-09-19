import { trait } from 'koota';
import { vec2, vec3 } from 'math';
import { COUNT } from './content';

export interface Path {
  /** Arc length from the start to the stop, and from the stop to the exit. */
  inward: number;
  outward: number;
  phase: number;
}

export interface Pose {
  x: number;
  y: number;
  /** Direction of travel at this point, from the x axis. */
  heading: number;
  /** 0 = looking ahead along the path, 1 = face turned up to the camera. */
  look: number;
}

/** Along the heading, across it, and up. Shared by the visual rig and its prepared collider. */
export const ROBOT_HALF_EXTENTS: readonly [number, number, number] = [0.68, 1.07, 1.5];

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
