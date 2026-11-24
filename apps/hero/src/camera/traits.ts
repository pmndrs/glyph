import type { BasicMultiChannelPerlinNoise, Klipp, LensExtension, TargetPose, VirtualCamera } from '@pmndrs/klipp';
import { trait } from 'koota';
import type { PerspectiveCamera } from 'three/webgpu';
import type { ShotName } from './content';

/** One virtual camera and the poses that drive it. */
export interface RigCamera {
  camera: VirtualCamera;
  /** Where it stands and what it looks at. */
  stand: TargetPose;
  subject: TargetPose;
  lens: LensExtension;
  noise: BasicMultiChannelPerlinNoise;
}

export interface RigState {
  klipp: Klipp;
  cameras: Record<ShotName, RigCamera>;
  /** Rises with each activation, so the newest shot always has the highest priority. */
  priority: number;
}

/** The camera rig: Klipp's mixer and one virtual camera a shot. Initialized by the camera actions. */
export const Rig = trait((): RigState | undefined => undefined);

/** The shot as it is this frame, after blending: what the view writes into the real camera. */
export const Shot = trait({
  name: 'caret' as ShotName,
  position: (): [number, number, number] => [0, 0, 10],
  quaternion: (): [number, number, number, number] => [0, 0, 0, 1],
  fov: 30,
  /** Distance along the view to the page, which is what the lens focuses on. */
  focus: 10,
  aperture: 0,
  /** 0..1: how far the dive has gone, and how far it has been asked to go. 1 is through the letter. */
  dive: 0,
  diveTarget: 0,
  /** Dive progress per second toward its target. */
  diveSpeed: 0.5,
  /** The pointer over the canvas in -1..1, for the free shot's lean. */
  leanX: 0,
  leanY: 0,
});

export interface CameraDraw {
  camera: PerspectiveCamera;
  uniforms: typeof import('./materials').cameraUniforms;
}

export const CameraView = trait((): CameraDraw | undefined => undefined);
