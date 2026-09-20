import { useFrame } from '@react-three/fiber/webgpu';
import { useWorld } from 'koota/react';
import { useKeyboard, usePointer } from './input/hooks';
import { fadePointer, samplePointer } from './input/systems';
import { useHeroReady } from './hero/prepare';
import { applyLetterLandings, triggerRobotDeparture, sampleViewport, updatePaper } from './hero/systems';
import { updateTime } from './time/systems';
import { updateGlassShadows } from './letters/shadows';
import { advanceSequence } from './sequence/systems';
import { advanceCollapse, syncBlackHoleView } from './black-hole/systems';
import { syncStarEmbers, syncEmberView } from './star-embers/systems';
import { moveIconFields, syncIconViews } from './icon-field/systems';
import { stepPhysics } from './physics/systems';
import {
  moveRobots,
  moveRobotBodies,
  stepDust,
  syncRobotPose,
  animateRobotRig,
  syncRobotDisplay,
  syncDustViews,
} from './robot/systems';
import { moveTitle, syncTitle, typeFeature, syncTitleViews, syncFeatureViews } from './letters/systems';

export function FrameLoop() {
  const world = useWorld();
  const isReady = useHeroReady();

  useKeyboard(world, isReady);
  usePointer(world);

  useFrame(
    ({ viewport, camera, pointer, size, time }, delta) => {
      sampleViewport(world, viewport.width, viewport.height, camera.position.z, size.width / size.height);
      samplePointer(world, pointer.x, pointer.y);

      if (!isReady) return;

      updateTime(world, delta, time);
      advanceSequence(world);
      moveRobots(world);
      triggerRobotDeparture(world);

      advanceSequence(world);
      advanceCollapse(world);
      syncStarEmbers(world);
      moveTitle(world);
      moveRobotBodies(world);
      stepPhysics(world);
      syncTitle(world);
      applyLetterLandings(world);

      advanceSequence(world);

      typeFeature(world);
      fadePointer(world);
      moveIconFields(world);
      stepDust(world);
    },
    { id: 'hero-simulation', phase: 'physics', fps: 60 },
  );

  useFrame(
    () => {
      updatePaper(world);
      syncTitleViews(world);
      syncIconViews(world);

      if (isReady) {
        syncFeatureViews(world);
        syncRobotPose(world);
        animateRobotRig(world);
        syncRobotDisplay(world);
        syncDustViews(world);
        syncBlackHoleView(world);
        syncEmberView(world);
      }

      updateGlassShadows(world, isReady);
    },
    { id: 'hero-views', phase: 'render', before: 'hero-render', fps: 60 },
  );

  return null;
}
