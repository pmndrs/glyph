import './view/styles.css';

import { Canvas } from '@react-three/fiber/webgpu';
import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { NeutralToneMapping } from 'three/webgpu';

import { Hero } from './hero';
import { Origin } from './origin/renderer';
import { HeroLoading } from './view/startup';

/** `?scene=origin` loads the second hero; anything else keeps the first. */
const ORIGIN = new URLSearchParams(location.search).get('scene') === 'origin';
/** Fixed DPR for repeatable capture workloads; normal viewing retains the adaptive 1–1.5 range. */
const CAPTURE_DPR = new URLSearchParams(location.search).get('dpr');
const DPR =
  CAPTURE_DPR === '1' ? 1 : CAPTURE_DPR === '1.5' ? 1.5 : CAPTURE_DPR === '2' ? 2 : CAPTURE_DPR === '3' ? 3 : undefined;

const root = document.querySelector<HTMLElement>('#root');
if (root === null) throw new Error('Glyph Hero needs a #root element');

createRoot(root).render(
  <StrictMode>
    {!ORIGIN && <HeroLoading />}
    <Canvas
      camera={
        ORIGIN
          ? { far: 120, fov: 34, near: 0.5, position: [0.4, 0.25, 15.2] }
          : { far: 90, fov: 35, near: 0.5, position: [0, 0, 16] }
      }
      dpr={DPR ?? [1, 1.5]}
      fallback={<div>WebGPU or WebGL2 is required.</div>}
      // Neutral, not AgX: paper white should stay paper white.
      renderer={{ scheduler: { fps: 60 }, toneMapping: NeutralToneMapping, toneMappingExposure: 1 }}
    >
      {!ORIGIN && <color args={['#f2efe8']} attach="background" />}
      <Suspense fallback={null}>{ORIGIN ? <Origin /> : <Hero />}</Suspense>
    </Canvas>
  </StrictMode>,
);
