import { useFrame } from '@react-three/fiber/webgpu';
import { useActions, useWorld } from 'koota/react';
import { actions } from './actions';
import { Time } from './time/traits';
import { useInput } from './input/hooks';
import { heroReady } from './hero/prepare';
import { updatePaper, uTime } from './hero/materials';
import { PATTERN_ANGLE } from './icon-field/content';
import { advanceHero } from './hero/systems';

export function FrameLoop() {
  const world = useWorld();
  const commands = useActions(actions);

  useInput(world, () => {
    if (heroReady()) commands.replayHero();
  });

  useFrame(
    ({ viewport, camera, pointer, size, time: now }, delta) => {
      commands.sampleView(viewport.width, viewport.height, camera.position.z, size.width / size.height, heroReady());
      commands.samplePointer(pointer.x, pointer.y);
      advanceHero(world, delta, now);
      const time = world.get(Time)!;
      uTime.value = time.elapsed;
      updatePaper(time.elapsed, PATTERN_ANGLE);
    },
    { id: 'hero-simulation', phase: 'physics', fps: 60 },
  );

  return null;
}
