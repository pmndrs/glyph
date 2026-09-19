import { useFrame } from '@react-three/fiber/webgpu';
import { useEffect } from 'react';
import { useWorld, useActions } from 'koota/react';
import { actions } from './actions';
import { Collapse } from './black-hole/traits';
import { useInput } from './input/hooks';
import { Time } from './time/traits';
import { advanceSequence } from './sequence/systems';
import { heroReady } from './view/startup';
import { updatePaper, uTime } from './view/materials';
import { PATTERN_ANGLE } from './icon-field/utils/lattice';

export function FrameLoop() {
  const world = useWorld();
  const commands = useActions(actions);

  useInput(world, () => {
    if (heroReady()) commands.replaySequence();
  });

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    Object.assign(globalThis, {
      heroWorld: world,
      heroHole: {
        open: commands.openBlackHole,
        dismiss: commands.dismissBlackHole,
        hold: commands.holdBlackHole,
        state: () => world.get(Collapse)!.hole,
      },
      heroRobot: {
        spawn: commands.spawnRobot,
        reset: commands.resetRobot,
        run: commands.runRobot,
        hold: commands.holdRobot,
      },
    });
  }, [world, commands]);

  useFrame(
    ({ viewport, camera, pointer, size }, delta) => {
      commands.sampleView(viewport.width, viewport.height, camera.position.z, size.width / size.height, heroReady());
      commands.samplePointer(pointer.x, pointer.y);
      advanceSequence(world, delta, performance.now());
      const time = world.get(Time)!;
      uTime.value = time.elapsed;
      updatePaper(time.elapsed, PATTERN_ANGLE);
    },
    { id: 'hero-simulation', phase: 'physics', fps: 60 },
  );

  return null;
}
