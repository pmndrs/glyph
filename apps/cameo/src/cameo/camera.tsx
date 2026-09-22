import { useThree } from '@react-three/fiber/webgpu';
import { useWorld } from 'koota/react';
import { useEffect } from 'react';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three/webgpu';
import { cameoActions } from './actions';
import { CAMERA } from './content';

const TARGET = new Vector3(...CAMERA.target);

/**
 * Points the fixed camera at the mark. The world is z-up, so the camera is told which way up is before it is
 * aimed, and the roll is applied afterwards about its own line of sight: a tilt of the head, not of the world.
 *
 * The orientation it settles at is published as the lens's rest, and nothing but a knock moves it again.
 */
export function Framing() {
  const world = useWorld();
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);

  useEffect(() => {
    if (!(camera instanceof PerspectiveCamera)) return;

    camera.up.set(0, 0, 1);
    camera.position.set(...CAMERA.position);
    camera.lookAt(TARGET);
    camera.rotateZ(CAMERA.roll);
    camera.fov = CAMERA.fov;
    camera.near = CAMERA.near;
    camera.far = CAMERA.far;
    camera.aspect = size.width / size.height;
    camera.updateProjectionMatrix();
    cameoActions(world).mountLensView({ camera, rest: new Quaternion().copy(camera.quaternion) });

    return () => cameoActions(world).unmountLensView();
  }, [camera, size, world]);

  return null;
}
