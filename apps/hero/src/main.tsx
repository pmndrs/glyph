import './view/styles.css';

import { Canvas } from '@react-three/fiber/webgpu';
import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { NeutralToneMapping } from 'three/webgpu';
import { WorldProvider } from 'koota/react';

import { Hero } from './hero';
import { createHeroWorld } from './world';
import { HeroLoading } from './view/startup';

/** Fixed DPR for repeatable capture workloads. Normal viewing retains the adaptive 1-1.5 range. */
const dpr = Number(new URLSearchParams(location.search).get('dpr'));
const world = createHeroWorld();

if (import.meta.hot) import.meta.hot.dispose(() => world.destroy());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HeroLoading />
    <WorldProvider world={world}>
      <Canvas
        camera={{ far: 90, fov: 35, near: 0.5, position: [0, 0, 16] }}
        dpr={[1, 1.5, 2, 3].includes(dpr) ? dpr : [1, 1.5]}
        fallback={<div>WebGPU or WebGL2 is required.</div>}
        // Preserve paper white under the scene lighting.
        renderer={{ scheduler: { fps: 60 }, toneMapping: NeutralToneMapping, toneMappingExposure: 1 }}
      >
        <color args={['#f2efe8']} attach="background" />
        <Suspense fallback={null}>
          <Hero />
        </Suspense>
      </Canvas>
    </WorldProvider>
  </StrictMode>,
);
