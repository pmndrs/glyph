import { Canvas, useFrame, useThree } from '@react-three/fiber/webgpu';
import { Leva } from 'leva';
import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { AgXToneMapping } from 'three/webgpu';

import { LookPanel, live } from './controls';
import { Overlay } from './overlay';
import { Scene } from './scene';
import './styles.css';

/**
 * Exposure is a renderer field rather than a node, so it is driven from inside
 * the canvas where the renderer is reachable.
 */
function Exposure() {
  const renderer = useThree((state) => state.renderer);
  useFrame(() => {
    renderer.toneMappingExposure = live.exposure;
  });
  return null;
}

const root = document.querySelector('#root')!;
createRoot(root).render(
  <StrictMode>
    <div className="stage">
      {import.meta.env.DEV && (
        <>
          <Leva collapsed titleBar={{ title: 'glÿph' }} />
          <LookPanel />
        </>
      )}
      <Canvas
        camera={{ far: 100, fov: 32, near: 0.1, position: [0, 0, 6] }}
        fallback={<div className="fallback">WebGPU or WebGL2 is required to render the mark.</div>}
        // AgX rather than ACES: the mark's specular is meant to roll off like
        // film instead of clipping to a flat white.
        renderer={{ toneMapping: AgXToneMapping }}
      >
        <color args={['#07080b']} attach="background" />
        <Exposure />
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
      </Canvas>
      <Overlay />
    </div>
  </StrictMode>,
);
