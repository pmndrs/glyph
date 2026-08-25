import { Canvas } from '@react-three/fiber/webgpu';
import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { AgXToneMapping } from 'three/webgpu';

import { Overlay } from './overlay';
import { Scene } from './scene';
import './styles.css';

const root = document.querySelector('#root')!;
createRoot(root).render(
  <StrictMode>
    <div className="stage">
      <Canvas
        camera={{ far: 100, fov: 32, near: 0.1, position: [0, 0, 6] }}
        fallback={<div className="fallback">WebGPU or WebGL2 is required to render the mark.</div>}
        // Underexposed on purpose: the specular glints are meant to be the only
        // genuinely bright thing on the page, and AgX rolls them off rather
        // than clipping them flat.
        renderer={{ toneMapping: AgXToneMapping, toneMappingExposure: 0.82 }}
      >
        <color args={['#07080b']} attach="background" />
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
      </Canvas>
      <Overlay />
    </div>
  </StrictMode>,
);
