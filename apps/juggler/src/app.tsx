import { useMsdf } from '@pmndrs/glyph/react';
import { Canvas } from '@react-three/fiber/webgpu';
import { WorldProvider } from 'koota/react';
import { Suspense } from 'react';
import { NoToneMapping } from 'three/webgpu';
import fontUrl from '../assets/inter-latin.font.glb?url';
import { FrameLoop } from './frameloop';
import { StickFigure } from './juggler/renderer';
import { Letters } from './letters/renderer';
import { world } from './world';

useMsdf.preload(fontUrl);

export function App() {
  return (
    <WorldProvider world={world}>
      <Canvas
        camera={{ far: 1_000, near: -1_000, position: [0, 0, 10] }}
        fallback={<div className="fallback">WebGPU or WebGL2 is required.</div>}
        orthographic
        renderer={{ toneMapping: NoToneMapping }}
      >
        <color attach="background" args={['#07090f']} />
        <Suspense fallback={null}>
          <FrameLoop />
          <StickFigure />
          <Scene />
        </Suspense>
      </Canvas>
    </WorldProvider>
  );
}

function Scene() {
  const font = useMsdf(fontUrl);

  return <Letters font={font} />;
}
