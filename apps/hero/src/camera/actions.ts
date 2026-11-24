import {
  BasicMultiChannelPerlinNoise,
  BlendCurves,
  HardLockToTargetBody,
  HardLookAtAim,
  Klipp,
  LensExtension,
  VirtualCamera,
  targetPose,
  type Ease,
} from '@pmndrs/klipp';
import { createActions } from 'koota';
import { vec3 } from 'math';
import { Quality } from '../quality/traits';
import { SHOTS, type ShotName } from './content';
import { CameraView, Rig, Shot, type CameraDraw, type RigCamera } from './traits';

export const cameraActions = createActions((world) => ({
  /** Build the rig: one virtual camera a shot, each a body locked to its stand, an aim at its subject, a lens, and a hand. */
  initializeCamera: () => {
    const klipp = new Klipp({ defaultBlend: { curve: BlendCurves.easeInOut, time: 3 } });
    const cameras = {} as Record<ShotName, RigCamera>;

    for (const [index, name] of (Object.keys(SHOTS) as ShotName[]).entries()) {
      const plan = SHOTS[name];
      const stand = targetPose.create();
      const subject = targetPose.create();
      vec3.set(stand.position, ...plan.position);
      vec3.set(subject.position, ...plan.target);
      const camera = new VirtualCamera(name, { priority: name === 'caret' ? 1 : 0 });
      camera.body = new HardLockToTargetBody(stand, { damping: plan.lag });
      camera.aim = new HardLookAtAim(subject);
      const lens = new LensExtension({ fov: plan.fov });
      camera.addExtension(lens);
      const noise = new BasicMultiChannelPerlinNoise({
        seed: 11 + index * 7,
        positionAmplitude: [plan.sway, plan.sway, plan.sway * 0.5],
        positionFrequency: [0.21, 0.27, 0.17],
        rotationAmplitude: [plan.shake, plan.shake, plan.shake * 0.4],
        rotationFrequency: [0.33, 0.29, 0.19],
      });
      camera.addNoise(noise);
      klipp.add(camera);
      cameras[name] = { camera, stand, subject, lens, noise };
    }

    world.set(Rig, { klipp, cameras, priority: 1 });
  },
  /** Blend to a shot over `seconds`, eased. Zero seconds is a cut. */
  blendTo: (name: ShotName, seconds: number, curve: Ease = BlendCurves.easeInOut) => {
    const rig = world.get(Rig)!;
    // A visitor who asked for less motion gets cuts.
    const cut = seconds <= 0 || world.get(Quality)!.reducedMotion;
    rig.klipp.defaultBlend = cut ? { curve: BlendCurves.cut, time: 0 } : { curve, time: seconds };
    rig.priority++;
    rig.cameras[name].camera.priority = rig.priority;
    world.set(Shot, { name });
  },
  /** Ask the dive to go to `target` (0 back out, 1 through the letter) at `speed` progress per second. */
  driveDive: (target: number, speed: number) => {
    world.set(Shot, { diveTarget: Math.min(1, Math.max(0, target)), diveSpeed: speed });
  },
  resetDive: () => {
    world.set(Shot, { dive: 0, diveTarget: 0 });
  },
  leanCamera: (x: number, y: number) => {
    world.set(Shot, { leanX: x, leanY: y });
  },
  mountCameraView: (view: CameraDraw) => {
    world.set(CameraView, view);
  },
  unmountCameraView: () => {
    world.set(CameraView, undefined);
  },
}));
