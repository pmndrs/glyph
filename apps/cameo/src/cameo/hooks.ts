import { useThree } from '@react-three/fiber/webgpu';
import type { World } from 'koota';
import { useLayoutEffect } from 'react';
import { cameoActions } from './actions';

/** Publish the canvas shape into the world before frames consume it. */
export function useFrameShape(world: World): void {
  const aspect = useThree((state) => state.size.width / state.size.height);

  useLayoutEffect(() => {
    cameoActions(world).setFrame(aspect);
  }, [world, aspect]);
}
