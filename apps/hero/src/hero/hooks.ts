import { useThree } from '@react-three/fiber/webgpu';
import type { World } from 'koota';
import { useLayoutEffect } from 'react';
import { heroActions } from './actions';

/** Publish React's viewport into the world before frames consume it. */
export function useViewport(world: World): void {
  const width = useThree((state) => state.viewport.width);
  const height = useThree((state) => state.viewport.height);
  const cameraZ = useThree((state) => state.camera.position.z);
  const aspect = useThree((state) => state.size.width / state.size.height);

  useLayoutEffect(() => {
    heroActions(world).setViewport(width, height, cameraZ, aspect);
  }, [world, width, height, cameraZ, aspect]);
}
