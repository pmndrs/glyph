import { Environment, Lightformer } from '@react-three/drei/webgpu';
import { bakePaperGrain, paperMaterial, uPaperDrift } from './materials';
import { useThree } from '@react-three/fiber/webgpu';
import { useEffect } from 'react';
import { useActions } from 'koota/react';
import { heroActions } from './actions';

/** Bright studio for glass on paper: a broad key overhead, two side strips for edge highlights, and a soft fill. */
export function Lighting() {
  return (
    <>
      <Environment resolution={256} background={false} environmentIntensity={1.15}>
        <Lightformer
          form="rect"
          intensity={5}
          color="#ffffff"
          position={[0, 7, 7]}
          rotation-x={Math.PI / 2}
          scale={[18, 3, 1]}
        />
        <Lightformer
          form="rect"
          intensity={3}
          color="#ffffff"
          position={[-11, 0, 4]}
          rotation-y={Math.PI / 2}
          scale={[3, 12, 1]}
        />
        <Lightformer
          form="rect"
          intensity={3}
          color="#ffffff"
          position={[11, 0, 4]}
          rotation-y={-Math.PI / 2}
          scale={[3, 12, 1]}
        />
        <Lightformer form="ring" intensity={2} color="#dfe8ff" position={[0, 0, -10]} scale={14} />
      </Environment>
      <directionalLight name="glass-key" color="#ffffff" intensity={1.6} position={[4, 6, 10]} />
      <ambientLight intensity={0.35} />
    </>
  );
}

export function Paper() {
  const { mountPaperView, unmountPaperView } = useActions(heroActions);
  const renderer = useThree((state) => state.renderer);

  useEffect(() => {
    bakePaperGrain(renderer);
    mountPaperView(uPaperDrift.value);

    return unmountPaperView;
  }, [mountPaperView, renderer, unmountPaperView]);

  return (
    <mesh material={paperMaterial} position={[0, 0, -14]}>
      <planeGeometry args={[160, 90]} />
    </mesh>
  );
}
