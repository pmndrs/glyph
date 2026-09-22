import { useFrame } from '@react-three/fiber/webgpu';
import { useWorld } from 'koota/react';
import { useFrameShape } from './cameo/hooks';
import { useCameoReady } from './cameo/prepare';
import { pressFloorWithRobot, shakeLens, triggerTakeEnd } from './cameo/systems';
import { moveIconField, syncIconViews } from './icon-field/systems';
import { animateRobotRig, runTake, stepDust, syncDustViews, syncRobotFace, syncRobotPose } from './robot/systems';
import { advanceSequence } from './sequence/systems';
import { updateTime } from './time/systems';

export function FrameLoop() {
  const world = useWorld();
  const isReady = useCameoReady();

  useFrameShape(world);

  useFrame(
    ({ time }, delta) => {
      if (!isReady) return;

      updateTime(world, delta, time);
      advanceSequence(world);
      runTake(world);
      triggerTakeEnd(world);
      advanceSequence(world);
      pressFloorWithRobot(world);
      moveIconField(world);
      stepDust(world);
    },
    { id: 'cameo-simulation', phase: 'physics', fps: 60 },
  );

  useFrame(
    () => {
      if (!isReady) return;

      syncIconViews(world);
      syncRobotPose(world);
      animateRobotRig(world);
      syncRobotFace(world);
      syncDustViews(world);
      shakeLens(world);
    },
    { id: 'cameo-views', phase: 'render', before: 'cameo-render', fps: 60 },
  );

  return null;
}
