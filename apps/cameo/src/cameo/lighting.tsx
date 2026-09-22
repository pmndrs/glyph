import { Environment, Lightformer } from '@react-three/drei/webgpu';
import { useThree } from '@react-three/fiber/webgpu';
import { useEffect } from 'react';
import { CAMERA } from './content';
import { bakeFloorGrain, floorMaterial } from './materials';

/**
 * A soft studio in a z-up world: a broad key overhead, a strip either side for the edge highlights that give the
 * robot's shell its shape, and a cool fill from behind the lens.
 */
export function Lighting() {
  return (
    <>
      <Environment resolution={256} background={false} environmentIntensity={1.05}>
        <Lightformer form="rect" intensity={5} color="#ffffff" position={[0, 1, 9]} scale={[14, 10, 1]} />
        <Lightformer
          form="rect"
          intensity={2.6}
          color="#ffffff"
          position={[-9, 1, 3]}
          rotation-y={Math.PI / 2}
          scale={[8, 5, 1]}
        />
        <Lightformer
          form="rect"
          intensity={2.6}
          color="#ffffff"
          position={[9, 1, 3]}
          rotation-y={-Math.PI / 2}
          scale={[8, 5, 1]}
        />
        <Lightformer form="ring" intensity={1.6} color="#dbe6ff" position={[0, -10, 2]} scale={12} />
      </Environment>
      {/* Keyed from over the camera's right shoulder, so the robot throws its shadow away from the lens. */}
      <directionalLight
        castShadow
        color="#fff6e8"
        intensity={2.1}
        position={[5.5, -6, 9]}
        shadow-bias={-0.0006}
        shadow-camera-bottom={-7}
        shadow-camera-far={30}
        shadow-camera-left={-9}
        shadow-camera-right={9}
        shadow-camera-top={7}
        shadow-mapSize={[1024, 1024]}
        shadow-normalBias={0.02}
      />
      <ambientLight intensity={0.3} />
    </>
  );
}

/** The floor the whole frame is made of: wide enough that its far edge never reaches the top of the picture. */
export function Floor() {
  const renderer = useThree((state) => state.renderer);

  useEffect(() => {
    bakeFloorGrain(renderer);
  }, [renderer]);

  return (
    <mesh material={floorMaterial} name="cameo-floor" receiveShadow>
      <planeGeometry args={[CAMERA.far, CAMERA.far]} />
    </mesh>
  );
}
