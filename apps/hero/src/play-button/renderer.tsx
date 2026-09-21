import { createPortal } from '@react-three/fiber/webgpu';
import { useWorld } from 'koota/react';
import { useEffect, useMemo } from 'react';
import { OrthographicCamera, Scene } from 'three/webgpu';
import { playButtonActions } from './actions';
import { BUTTON_HEIGHT, BUTTON_WIDTH, FRAME_MARGIN } from './content';
import { createPlayModuleMaterial, uPlayHover, uPlayReveal } from './materials';

const scene = new Scene();
scene.name = 'play-button-sheet';
const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
camera.position.z = 1;

/** The button's own sheet and camera, rendered by the hero's post pass after the scene has gone black. */
export const playSheet = { scene, camera };

/** A segment-display module reading "PLAY" over black, powered up by its shader once the embers have gone out. */
export function PlayButtonRenderer() {
  const world = useWorld();
  const module = useMemo(() => createPlayModuleMaterial(), []);

  useEffect(() => {
    playButtonActions(world).mountPlayButtonView({
      camera,
      reveal: uPlayReveal,
      hover: uPlayHover,
      root: document.documentElement,
    });

    return () => {
      playButtonActions(world).unmountPlayButtonView();
      delete document.documentElement.dataset.heroHover;
    };
  }, [world]);

  useEffect(() => () => module.dispose(), [module]);

  return createPortal(
    <group name="play-button">
      <mesh material={module}>
        <planeGeometry args={[BUTTON_WIDTH + 2 * FRAME_MARGIN, BUTTON_HEIGHT + 2 * FRAME_MARGIN]} />
      </mesh>
    </group>,
    scene,
  );
}
