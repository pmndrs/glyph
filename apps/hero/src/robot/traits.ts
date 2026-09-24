import { trait } from 'koota';
import { vec2, vec3 } from 'math';
import { COUNT } from './content';
import type { Group, Object3D, AnimationMixer, Quaternion } from 'three/webgpu';
import type { Mat4, Quat, Vec3 } from 'math';
import type { RetainedLine } from '../letters/utils';

export interface RobotDraw {
  root: Group;
  lean: Group;
  screen: Group;
  head: Object3D | undefined;
  mixer: AnimationMixer;
  line: RetainedLine;
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
  };
}

export const RobotView = trait((): RobotDraw | undefined => undefined);

/** The floor marker at the robot's destination. */
export interface MarkerDraw {
  mesh: Object3D;
  presence: { value: number };
  age: { value: number };
}

export const MarkerView = trait((): MarkerDraw | undefined => undefined);
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
  /** Seconds since the robot was sent, which times the marker's entrance. */
  since: number;
  /** Signed sway amplitude for this trip, so no two trips bend alike. */
  bend: number;
  /** Seconds spent at the target. The robot looks up and greets once it has rested. */
  rested: number;
  trips: number;
}

export const Robot = trait({
  path: (): Path => ({ inward: 0, outward: 0, phase: 0 }),
  /** Where the robot is on the floor and which way it faces, published for the physics, the rain, and the sound. */
  pose: (): Pose => ({ x: 0, y: 0, heading: 0, look: 0 }),
  drive: (): Drive => ({
    targetX: 0,
    targetY: 0,
    hasTarget: false,
    speed: 0,
    travelled: 0,
    since: 0,
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
  physicsPose: () => ({ x: 0, y: 0, z: 0, yaw: 0 }),
  active: false,
  time: undefined as number | undefined,
  /** Seconds on the display's clock, or undefined while the face is blank, and how many letters it has printed. */
  face: undefined as number | undefined,
  printed: 0,
  /** Whether the scripted run starts on the next move. */
  run: false,
  runs: 0,
  departed: false,
  gone: false,
});
