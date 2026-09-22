import { trait } from 'koota';
import { vec2, vec3 } from 'math';
import { DUST_COUNT } from './content';
import type { Mat4, Quat, Vec3 } from 'math';
import type { AnimationMixer, Group, Matrix4, Object3D, Quaternion } from 'three/webgpu';
import type { PrintedCard } from './text';

export interface RobotDraw {
  root: Group;
  lean: Group;
  screen: Group | null;
  head: Object3D | undefined;
  mixer: AnimationMixer;
  /** Every screenful, in the order the take prints them. */
  cards: readonly PrintedCard[];
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

export interface Pose {
  x: number;
  y: number;
  /** Where the robot is pointed, from the x axis. */
  heading: number;
  /** 0 = watching where it is going, 1 = turned to the lens. */
  look: number;
  /** Body pitch from the travel track's acceleration: forward into a charge, back out of a brake. */
  lean: number;
}

export const Robot = trait({
  pose: (): Pose => ({ x: 0, y: 0, heading: 0, look: 0, lean: 0 }),
  dust: () => ({
    particles: Array.from({ length: DUST_COUNT }, () => ({
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
  /** Seconds into the current take, or undefined between takes. */
  time: undefined as number | undefined,
  /** Playback seconds at which the next take begins. */
  startAt: Number.POSITIVE_INFINITY,
  takes: 0,
  /** Set for the one frame the robot leaves the frame, so the take can be scheduled again. */
  finished: false,
});
