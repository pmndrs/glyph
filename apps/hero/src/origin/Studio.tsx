import { Environment, Lightformer } from '@react-three/drei/webgpu';
import type { Texture } from 'three/webgpu';

export function Studio({ video }: { readonly video: Texture }) {
  return (
    <>
      <color args={['#05060a']} attach="background" />
      {/* Just enough fill to keep the unlit sides of the letters from going to pure black. */}
      <ambientLight intensity={0.12} />
      <Environment frames={Infinity} resolution={64}>
        {/* Warm video light from camera-left gives the letters a distinct near edge. */}
        <Lightformer
          color="#ffd2a6"
          form="rect"
          intensity={2.6}
          map={video}
          position={[-3.6, 1.4, 3.2]}
          scale={[8, 5, 1]}
          target
        />
        {/* The opposite bounce, cool, so the far edges separate from the room instead of dissolving into it. */}
        <Lightformer
          color="#9ec6ff"
          form="rect"
          intensity={2.2}
          map={video}
          position={[5.6, 0.8, 4.2]}
          scale={[6, 4.5, 1]}
          target
        />
        {/* Overhead fill highlights the top edge. */}
        <Lightformer form="box" intensity={0.5} position={[0, 5, 0]} scale={[9, 1, 6]} target />
      </Environment>
      {/* One real light so the word casts a shadow the reflector can pick up. */}
      <directionalLight castShadow intensity={0.65} position={[-4, 6, 5]} shadow-mapSize={[1024, 1024]} />
    </>
  );
}
