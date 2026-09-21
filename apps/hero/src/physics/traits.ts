import { trait, type Entity } from 'koota';
import { quat, vec3, type Quat, type Vec3 } from 'math';
import type { Listener, World as Simulation } from 'crashcat';

export interface HeldPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export const Floor = trait();

/** Entity-owned motion and the handle into the shared solver. */
export const Body = trait({
  id: 0,
  mode: 'dynamic' as 'static' | 'dynamic' | 'held' | 'parked',
  /** Whether other bodies may rest on this one's top face. Title letters never stack; rain may pile up. */
  stacks: false,
  position: () => vec3.create(),
  rotation: () => quat.create(),
  from: () => ({ x: 0, y: 0, z: 0, yaw: 0 }),
  to: () => ({ x: 0, y: 0, z: 0, yaw: 0 }),
  airborne: false,
  landed: false,
  moved: false,
});

export interface PhysicsState {
  engine: Simulation;
  entities: Map<number, Entity>;
  listener: Listener;
  movingLayer: number;
  floorLayer: number;
  parkedLayer: number;
  accumulator: number;
  position: Vec3;
  rotation: Quat;
  velocity: Vec3;
}

/** Initialized by physics actions before any body is created. */
export const Physics = trait((): PhysicsState | undefined => undefined);
