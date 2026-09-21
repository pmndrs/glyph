import { useFrame } from '@react-three/fiber/webgpu';
import { useWorld } from 'koota/react';
import { useKeyboard, usePointer } from './input/hooks';
import { fadePointer } from './input/systems';
import { useHeroReady } from './hero/prepare';
import { applyLetterLandings, triggerRobotDeparture, updatePaper } from './hero/systems';
import { useViewport } from './hero/hooks';
import { updateTime } from './time/systems';
import { updateGlassShadows } from './letters/shadows';
import { advanceSequence } from './sequence/systems';
import { advanceCollapse, syncBlackHoleView } from './black-hole/systems';
import { syncStarEmbers, syncEmberView } from './star-embers/systems';
import { syncPlayButtonView } from './play-button/systems';
import { moveIconPaper, syncIconViews } from './icon-paper/systems';
import { stepPhysics } from './physics/systems';
import {
  moveRobots,
  driveRobots,
  moveRobotBodies,
  stepDust,
  syncRobotPose,
  animateRobotRig,
  syncRobotDisplay,
  syncDustViews,
  syncMarkerView,
} from './robot/systems';
import { moveTitle, syncTitle, typeFeature, syncTitleViews, syncFeatureViews } from './letters/systems';

export function FrameLoop() {
  const world = useWorld();
  const isReady = useHeroReady();

  useKeyboard(world, isReady);
  usePointer(world, isReady);
  useViewport(world);

  useFrame(
    ({ time }, delta) => {
      if (!isReady) return;

      updateTime(world, delta, time);
      advanceSequence(world);
      moveRobots(world);
      driveRobots(world);
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
      moveIconPaper(world);
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
        syncMarkerView(world);
        syncBlackHoleView(world);
        syncEmberView(world);
        syncPlayButtonView(world);
      }

      updateGlassShadows(world, isReady);
    },
    { id: 'hero-views', phase: 'render', before: 'hero-render', fps: 60 },
  );

  return null;
}
