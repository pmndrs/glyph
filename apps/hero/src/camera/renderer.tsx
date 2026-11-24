import { useThree } from '@react-three/fiber/webgpu';
import { useWorld } from 'koota/react';
import { useEffect } from 'react';
import type { PerspectiveCamera } from 'three/webgpu';
import { cameraActions } from './actions';
import { cameraUniforms } from './materials';

/** Hands the canvas's camera to the rig, which places it every frame. */
export function CameraRig() {
  const world = useWorld();
  const camera = useThree((state) => state.camera) as PerspectiveCamera;

  useEffect(() => {
    cameraActions(world).mountCameraView({ camera, uniforms: cameraUniforms });

    return () => cameraActions(world).unmountCameraView();
  }, [world, camera]);

  return null;
}
