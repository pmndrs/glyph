import { Canvas, useFrame, useThree } from '@react-three/fiber/webgpu';
import { Leva } from 'leva';
import { StrictMode, Suspense, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { AgXToneMapping } from 'three/webgpu';

import { LookPanel, live } from './controls';
import { bindDebugToggle, useDebugVisible } from './debug-visibility';
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

/** Dev overlays, shown on load and toggled with the space bar. */
function DevPanel() {
  const visible = useDebugVisible();
  useEffect(bindDebugToggle, []);

  // `hidden` rather than unmounting: leva keeps its store either way, so a
  // toggle never resets a value that was dialled in.
  return (
    <>
      <Leva collapsed hidden={!visible} titleBar={{ title: 'glÿph' }} />
      <LookPanel />
    </>
  );
}

const root = document.querySelector('#root')!;
createRoot(root).render(
  <StrictMode>
    <div className="stage">
      {import.meta.env.DEV && <DevPanel />}
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
