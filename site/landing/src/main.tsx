import { Canvas, useFrame, useThree } from '@react-three/fiber/webgpu';
import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { AgXToneMapping } from 'three/webgpu';

import { live } from './look';
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

  // Reachable from the console in development so draw calls and frame cost can
  // be measured rather than guessed at.
  if (import.meta.env.DEV) {
    (globalThis as unknown as { __renderer: unknown }).__renderer = renderer;
  }
  return null;
}

// Dev overlays: leva, the look panel, and the space-bar toggle. `import.meta.env.DEV`
// is a build-time constant, so production folds this to `null`, the `import()`
// never runs, and leva stays out of the bundle entirely. It has to be reached
// this way rather than by a guarded static import — leva builds its stitches
// theme at module scope, which defeats tree-shaking.
const DevOverlays = import.meta.env.DEV ? lazy(() => import('./dev/panel')) : null;

const root = document.querySelector('#root')!;
createRoot(root).render(
  <StrictMode>
    <div className="stage">
      {DevOverlays !== null && (
        <Suspense fallback={null}>
          <DevOverlays />
        </Suspense>
      )}
      <Canvas
        camera={{ far: 100, fov: 32, near: 0.1, position: [0, 0, 6] }}
        // Clamped on purpose. Left alone this canvas backs a 3064x3224 buffer,
        // and the post chain allocates several full-size float targets over it —
        // measured at 732 MB of texture. The mark is a smooth curve and the
        // chorus is a native strike, so neither is buying much from the extra
        // samples, and the bloom is a blur besides.
        dpr={[1, 1.5]}
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
