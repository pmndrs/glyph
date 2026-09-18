import { MeshReflectorMaterial } from '@react-three/drei/webgpu';

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
