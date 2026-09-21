import { trait } from 'koota';
import { vec2, vec3 } from 'math';
import { COUNT } from './content';
import type { Group, Object3D, AnimationMixer, Quaternion, Matrix4 } from 'three/webgpu';
import type { Mat4, Quat, Vec3 } from 'math';
import type { RetainedLine } from '../letters/text';

export interface RobotDraw {
  root: Group;
  lean: Group;
  screen: Group | null;
  head: Object3D | undefined;
  mixer: AnimationMixer;
  line: RetainedLine;
  faceLocal: Matrix4;
  eyes: { value: number };
  tear: { value: number };
  seed: { value: number };
  transforms: {
    axis: Vec3;
    parent: Quat;
    tilt: Quat;
    rotation: Quat;
    local: Quat;
    parentWorld: Quaternion;
    world: Mat4;
    head: Mat4;
    face: Mat4;
    eyes: { shown: number; tear: number };
  };
}

export const RobotView = trait((): RobotDraw | undefined => undefined);
export const DustView = trait((): (Group | null)[] | undefined => undefined);

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

/** Free play: where the pointer sent the robot, and how its trip there is going. */
export interface Drive {
  targetX: number;
  targetY: number;
  hasTarget: boolean;
  speed: number;
  /** Arc length covered on this trip, which phases the sway. */
  travelled: number;
  /** Signed sway amplitude for this trip, so no two trips bend alike. */
  bend: number;
  /** Seconds spent at the target. The robot looks up and greets once it has rested. */
  rested: number;
  trips: number;
}

/** Along the heading, across it, and up. Shared by the visual rig and its prepared collider. */
export const ROBOT_HALF_EXTENTS: readonly [number, number, number] = [0.68, 1.07, 1.5];

export const Robot = trait({
  motion: () => ({ path: { inward: 0, outward: 0, phase: 0 }, pose: { x: 0, y: 0, heading: 0, look: 0 } }),
  drive: (): Drive => ({
    targetX: 0,
    targetY: 0,
    hasTarget: false,
    speed: 0,
    travelled: 0,
    bend: 0,
    rested: 0,
    trips: 0,
  }),
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
  /** Seconds on the display's clock, or undefined while the face is blank. */
  face: undefined as number | undefined,
  runAt: Number.POSITIVE_INFINITY,
  runs: 0,
  departed: false,
  gone: false,
});
