import { useFrame } from '@react-three/fiber/webgpu';
import { PerspectiveCamera } from 'three/webgpu';

import { WORLD_WIDTH } from '../../theme';

export const FOV = 32;

/** Keeps `WORLD_WIDTH` units visible across the viewport whatever its aspect. */
export function FitWidth() {
  useFrame(({ camera, size }) => {
    if (!(camera instanceof PerspectiveCamera)) return;
    const aspect = size.width / Math.max(size.height, 1);
    // Visible height at distance d is 2·d·tan(fov/2); width is that times aspect.
    const distance = WORLD_WIDTH / 2 / Math.tan((FOV / 2) * (Math.PI / 180)) / aspect;
    if (Math.abs(camera.position.z - distance) > 1e-3) {
      camera.position.z = distance;
      camera.updateProjectionMatrix();
    }
  });
  return null;
}
