import { useThree } from '@react-three/fiber/webgpu';
import type { World } from 'koota';
import { useLayoutEffect } from 'react';
import { viewportActions } from './actions';

/** Publish React's canvas size into the world before frames consume it. */
export function useViewport(world: World): void {
  const width = useThree((state) => state.size.width);
  const height = useThree((state) => state.size.height);

  useLayoutEffect(() => {
    viewportActions(world).setViewport(width, height);
  }, [world, width, height]);
}
