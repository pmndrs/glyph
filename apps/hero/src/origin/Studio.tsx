import { Environment, Lightformer } from '@react-three/drei/webgpu';
import type { Texture } from 'three/webgpu';

/**
 * A dark room lit almost entirely by the clip. The lightformers carry the video as their map and are captured into
 * the environment every frame, so what the letters show and what lights them are the same moving picture — the
 * nebula's bright core genuinely throws light across the scene rather than being faked with a tint.
 *
 * Resolution stays low on purpose: the environment is re-rendered every frame, and at this size it is a blur of
 * colour anyway, which is all an area light needs to be.
 */
const ENVIRONMENT_RESOLUTION = 64;

export function Studio({ video }: { readonly video: Texture }) {
  return (
    <>
      <color args={['#05060a']} attach="background" />
      {/* Just enough fill to keep the unlit sides of the letters from going to pure black. */}
      <ambientLight intensity={0.12} />
      <Environment frames={Infinity} resolution={ENVIRONMENT_RESOLUTION}>
        {/* The key: a broad panel of the clip, camera-left, tinted warm. Splitting the two sides by temperature is
            what gives the letters an edge — lit evenly from both, they read as one flat wash of nebula. */}
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
        {/* A soft box overhead for the studio feel — the top edge highlight that says "lit", not "emissive". */}
        <Lightformer form="box" intensity={0.5} position={[0, 5, 0]} scale={[9, 1, 6]} target />
      </Environment>
      {/* One real light so the word casts a shadow the reflector can pick up. */}
      <directionalLight castShadow intensity={0.65} position={[-4, 6, 5]} shadow-mapSize={[1024, 1024]} />
    </>
  );
}
