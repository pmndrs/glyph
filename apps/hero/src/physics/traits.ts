import { trait } from 'koota';
import type { Quat, Vec3 } from 'math';
import type { RigidBody, World as Simulation } from 'crashcat';

/** A rigid body's published pose, in page units with y down, and its turn counter-clockwise as drawn. */
export interface Pose {
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
}

export interface PhysicsState {
  engine: Simulation;
  movingLayer: number;
  wallLayer: number;
  /** Seconds owed to the fixed step. */
  accumulator: number;
  /** Bodies by the key their owner gave them. */
  bodies: Map<number, RigidBody>;
  poses: Map<number, Pose>;
  walls: RigidBody[];
  position: Vec3;
  rotation: Quat;
  velocity: Vec3;
}

/** Initialized by the physics actions before any body is created. */
export const Physics = trait((): PhysicsState | undefined => undefined);
