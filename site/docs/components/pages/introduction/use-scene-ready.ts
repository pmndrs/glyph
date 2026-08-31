import { useEffect } from 'react';

/** Signal that a scene's synchronous resources are ready for presentation. */
export function useSceneReady(onReady: () => void) {
  useEffect(() => onReady(), [onReady]);
}
