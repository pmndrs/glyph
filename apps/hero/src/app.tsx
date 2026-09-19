import './hero/styles.css';

import { Canvas } from '@react-three/fiber/webgpu';
import { WorldProvider } from 'koota/react';
import { StrictMode, Suspense } from 'react';
import { NeutralToneMapping } from 'three/webgpu';
import { actions } from './actions';
import { createHeroWorld } from './world';
import { FrameLoop } from './frameloop';
import { Hero } from './hero/renderer';
import { HeroLoading } from './hero/loading';

const heroWorld = createHeroWorld();

if (import.meta.hot) import.meta.hot.dispose(() => actions(heroWorld).disposeHero());

export function App() {
  return (
    <StrictMode>
      <HeroLoading />
      <WorldProvider world={heroWorld}>
        <Canvas
          camera={{ far: 90, fov: 35, near: 0.5, position: [0, 0, 16] }}
          dpr={[1, 2]}
          background={'#f2efe8'}
          // Preserve paper white under the scene lighting.
          renderer={{ scheduler: { fps: 60 }, toneMapping: NeutralToneMapping, toneMappingExposure: 1 }}
        >
          <Suspense fallback={null}>
            <FrameLoop />
            <Hero />
          </Suspense>
        </Canvas>
      </WorldProvider>
    </StrictMode>
  );
}
