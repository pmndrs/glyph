import { useFrame } from '@react-three/fiber/webgpu';
import { useActions, useWorld } from 'koota/react';
import { actions } from './actions';
import { Time } from './time/traits';
import { updateTime } from './time/systems';
import { useInput } from './input/hooks';
import { fadePointer } from './input/systems';
import { heroReady } from './hero/prepare';
import { updatePaper, uTime } from './hero/materials';
import { PATTERN_ANGLE } from './icon-field/content';
import { applyLetterLandings, triggerRobotDeparture } from './hero/systems';
import { advanceSequence } from './sequence/systems';
import { advanceCollapse } from './black-hole/systems';
import { Collapse } from './black-hole/traits';
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
    ({ viewport, camera, pointer, size, time: now }, delta) => {
      const ready = heroReady();
      commands.sampleView(viewport.width, viewport.height, camera.position.z, size.width / size.height);
      commands.samplePointer(pointer.x, pointer.y);
      updateTime(world, delta, now, ready);
      const time = world.get(Time)!;
      uTime.value = time.elapsed;
      updatePaper(time.elapsed, PATTERN_ANGLE);

      if (!ready) return;

      advanceSequence(world);
      moveRobots(world);
      triggerRobotDeparture(world);

      advanceSequence(world);
      advanceCollapse(world);
      const hole = world.get(Collapse)!.hole;
      commands.sampleStarEmbers(hole.sincePop);
      moveTitle(world, hole);
      moveRobotBodies(world);
      stepPhysics(world);
      syncTitle(world);
      applyLetterLandings(world);

      advanceSequence(world);

      if (hole.beat === 'closed') typeFeature(world);

      fadePointer(world);
      moveIconFields(world, hole);
      stepDust(world);
    },
    { id: 'hero-simulation', phase: 'physics', fps: 60 },
  );

  return null;
}
