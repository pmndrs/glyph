import { useLoader } from '@react-three/fiber/webgpu';
import { SRGBColorSpace, TextureLoader } from 'three';

import { GRID_TEXTURE_URL, SKY_TEXTURE_URL } from './generated-textures';

export function ArchvizEnvironment() {
  const grid = useLoader(TextureLoader, GRID_TEXTURE_URL);
  const sky = useLoader(TextureLoader, SKY_TEXTURE_URL);

  return (
    <>
      <primitive attach="background" colorSpace={SRGBColorSpace} object={sky} />
      <hemisphereLight args={['#bfe4ff', '#f7cdbd', 1.75]} />
      <ambientLight color="#fff8f2" intensity={0.16} />
      <directionalLight
        castShadow
        color="#fff0d8"
        intensity={2.05}
        position={[-7, 10, 6]}
        shadow-bias={-0.00008}
        shadow-camera-bottom={-24}
        shadow-camera-far={54}
        shadow-camera-left={-24}
        shadow-camera-near={0.1}
        shadow-camera-right={24}
        shadow-camera-top={24}
        shadow-mapSize-height={1024}
        shadow-mapSize-width={1024}
        shadow-normalBias={0.006}
        shadow-radius={5}
      />
      <directionalLight color="#9dd8ff" intensity={0.38} position={[7, 4, -6]} />
      <directionalLight color="#ffc6b2" intensity={0.28} position={[-5, 2, -7]} />
      <mesh position={[0, -1.25, 0]} receiveShadow rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[42, 32]} />
        <meshStandardMaterial color="#fffaf7" metalness={0} roughness={0.92}>
          <primitive attach="map" colorSpace={SRGBColorSpace} object={grid} />
        </meshStandardMaterial>
      </mesh>
    </>
  );
}
