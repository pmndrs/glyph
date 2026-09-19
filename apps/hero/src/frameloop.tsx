import { useFrame } from '@react-three/fiber/webgpu';
import { useEffect } from 'react';
import { useWorld, useActions } from 'koota/react';
import { heroActions } from './actions';
import { blackHoleActions } from './black-hole/actions';
import { Collapse } from './black-hole/traits';
import { robotActions } from './robot/actions';
import { useInput } from './input/hooks';
import { Pointer } from './input/traits';
import { Time } from './time/traits';
import { Preparation, Viewport } from './view/traits';
import { advanceHero } from './systems';
import { heroReady } from './view/startup';
import { updatePaper, uTime } from './view/materials';
import { PATTERN_ANGLE } from './field/utils/lattice';

export function FrameLoop() {
  const world = useWorld();
  const actions = useActions(heroActions);
  const hole = useActions(blackHoleActions);
  const robots = useActions(robotActions);

  useInput(world, () => {
    if (heroReady()) actions.replay();
  });

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    Object.assign(globalThis, {
      heroWorld: world,
      heroHole: {
        open: hole.open,
        dismiss: hole.dismiss,
        hold: hole.hold,
        state: () => world.get(Collapse)!.hole,
      },
      heroRobot: robots,
    });
  }, [world, hole, robots]);

  useFrame(
    ({ viewport, camera, pointer, size }, delta) => {
      world.get(Preparation)!.ready = heroReady();
      const view = world.get(Viewport)!;
      view.width = viewport.width;
      view.height = viewport.height;
      view.cameraZ = camera.position.z;
      view.aspect = size.width / size.height;
      const input = world.get(Pointer)!;
      input.x = pointer.x;
      input.y = pointer.y;
      advanceHero(world, delta, performance.now());
      const time = world.get(Time)!;
      uTime.value = time.elapsed;
      updatePaper(time.elapsed, PATTERN_ANGLE);
    },
    { id: 'hero-simulation', phase: 'physics', fps: 60 },
  );

  return null;
}
