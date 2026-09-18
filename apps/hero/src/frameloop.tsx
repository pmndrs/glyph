import { useFrame } from '@react-three/fiber/webgpu';
import { useEffect } from 'react';
import { useWorld, useActions } from 'koota/react';
import { Frame, Sequence } from './sequence/traits';
import { sequenceActions } from './sequence/actions';
import { robotActions } from './robot/actions';
import { advanceHero } from './systems';
import { heroReady } from './view/startup';
import { updatePaper } from './view/Paper';
import { uTime } from './sequence/uniforms';

export function FrameLoop() {
  const world = useWorld();
  const actions = useActions(sequenceActions);
  const robots = useActions(robotActions);

  useEffect(() => {
    const pointer = world.get(Frame)!.pointer;

    const moved = () => {
      pointer.strength = 1;
    };

    const left = () => {
      pointer.strength = 0;
    };

    const restart = (event: KeyboardEvent) => {
      if (event.key !== ' ' || !heroReady()) return;

      if (
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable || event.target.closest('input, textarea, select, button') !== null)
      )
        return;

      event.preventDefault();

      if (!event.repeat) actions.replay();
    };

    window.addEventListener('keydown', restart);
    window.addEventListener('pointermove', moved, { passive: true });
    window.addEventListener('pointerleave', left, { passive: true });

    if (import.meta.env.DEV) {
      Object.assign(globalThis, {
        heroWorld: world,
        heroHole: {
          open: actions.openCollapse,
          dismiss: actions.dismissCollapse,
          hold: actions.holdCollapse,
          state: () => world.get(Sequence)!.hole,
        },
        heroRobot: robots,
      });
    }

    return () => {
      window.removeEventListener('keydown', restart);
      window.removeEventListener('pointermove', moved);
      window.removeEventListener('pointerleave', left);
    };
  }, [world, actions, robots]);

  useFrame(
    ({ viewport, camera, pointer, size }, delta) => {
      const frame = world.get(Frame)!;
      frame.ready = heroReady();
      frame.width = viewport.width;
      frame.height = viewport.height;
      frame.cameraZ = camera.position.z;
      frame.aspect = size.width / size.height;
      frame.pointer.x = pointer.x;
      frame.pointer.y = pointer.y;
      advanceHero(world, delta, performance.now());
      uTime.value = frame.elapsed;
      updatePaper(frame.elapsed);
    },
    { id: 'hero-simulation', phase: 'physics', fps: 60 },
  );

  return null;
}
