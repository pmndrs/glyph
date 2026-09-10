import { useFrame } from '@react-three/fiber/webgpu';
import { useEffect, useMemo, useRef } from 'react';
import { DoubleSide, Group, MeshPhysicalNodeMaterial } from 'three/webgpu';

const SHARDS = [
  { position: [-3.6, 1.7, 1.1], rotation: [0.4, -0.3, -0.5], scale: [0.32, 0.88, 0.2] },
  { position: [-2.7, -1.45, 0.8], rotation: [-0.3, 0.55, 0.85], scale: [0.22, 0.64, 0.16] },
  { position: [2.9, 1.55, 1.2], rotation: [0.15, -0.6, 0.45], scale: [0.3, 0.78, 0.18] },
  { position: [3.8, -1.25, 0.9], rotation: [-0.5, 0.25, -0.7], scale: [0.24, 0.7, 0.16] },
  { position: [0.2, -2.05, 0.7], rotation: [0.5, 0.2, 0.95], scale: [0.18, 0.52, 0.14] },
] as const;

/** Faceted transmissive glass gives the flat text a readable refractive reference. */
export function RefractiveShards() {
  const group = useRef<Group>(null);
  const material = useMemo(
    () =>
      new MeshPhysicalNodeMaterial({
        attenuationColor: '#7dd3fc',
        attenuationDistance: 2.6,
        color: '#d8f4ff',
        dispersion: 0.18,
        ior: 1.46,
        metalness: 0,
        roughness: 0.08,
        side: DoubleSide,
        thickness: 0.5,
        transmission: 0.96,
      }),
    [],
  );

  useEffect(() => () => material.dispose(), [material]);
  useFrame(({ elapsed }) => {
    if (group.current === null) return;
    group.current.rotation.y = Math.sin(elapsed * 0.22) * 0.16;
    group.current.rotation.z = Math.sin(elapsed * 0.17) * 0.035;
  });

  return (
    <group ref={group}>
      {SHARDS.map((shard, index) => (
        <mesh key={index} position={shard.position} rotation={shard.rotation} scale={shard.scale} material={material}>
          <tetrahedronGeometry args={[1, 0]} />
        </mesh>
      ))}
    </group>
  );
}
