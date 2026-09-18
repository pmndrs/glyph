import { MeshReflectorMaterial } from '@react-three/drei/webgpu';

/**
 * The reflector the word stands on. Dead level: tipping it a few degrees put the whole ground out of true, and with
 * a level horizon to compare against, everything in the scene read as skewed. Blur and roughness keep it a wet-floor
 * suggestion rather than a second copy of the word.
 */
/** Sits just under the word's lowest ink, so the reflection comes straight off the letters with no gap beneath. */
export const FLOOR_Y = -0.95;

export function Floor() {
  return (
    <mesh position={[0, FLOOR_Y, 0]} receiveShadow rotation-x={-Math.PI / 2}>
      <planeGeometry args={[60, 40]} />
      <MeshReflectorMaterial
        blur={[110, 36]}
        color="#000000"
        depthScale={1.1}
        distortion={0.06}
        metalness={0.9}
        mirror={0.96}
        mixBlur={0.6}
        mixStrength={5.5}
        resolution={1024}
        roughness={0.22}
      />
    </mesh>
  );
}
