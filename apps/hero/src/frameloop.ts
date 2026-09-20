import { useFrame } from '@react-three/fiber/webgpu';
import { useActions, useWorld } from 'koota/react';
import { actions } from './actions';
import { useInput } from './input/hooks';
import { fadePointer } from './input/systems';
import { heroReady } from './hero/prepare';
import { syncHeroFrame } from './hero/frame';
import { applyLetterLandings, triggerRobotDeparture } from './hero/systems';
import { advanceSequence } from './sequence/systems';
import { advanceCollapse } from './black-hole/systems';
import { syncStarEmbers } from './star-embers/systems';
import { moveIconFields } from './icon-field/systems';
import { stepPhysics } from './physics/systems';
import { moveRobots, moveRobotBodies, stepDust } from './robot/systems';
import { moveTitle, syncTitle, typeFeature } from './letters/systems';

export function FrameLoop() {
  const world = useWorld();
  const commands = useActions(actions);

  useInput(world, () => {
    if (heroReady()) commands.replayHero();
  });

  useFrame(
    (frame, delta) => {
      if (!syncHeroFrame(world, frame, delta)) return;

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

  return null;
}
