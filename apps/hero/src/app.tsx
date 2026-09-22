import './hero/styles.css';

import { Canvas } from '@react-three/fiber/webgpu';
import { WorldProvider } from 'koota/react';
import { Suspense } from 'react';
import { NeutralToneMapping } from 'three/webgpu';
import { FrameLoop } from './frameloop';
import { HeroLoading } from './hero/loading';
import { Hero } from './hero/renderer';
import { world } from './world';

/**
 * A `?profile` page records GPU timestamps for the performance checks, and `dpr` pins the pixel ratio they run at;
 * the device feature costs nothing else.
 */
const query = new URLSearchParams(location.search);
const profiling = query.has('profile');
const pinnedDpr = Number(query.get('dpr'));

export function App() {
  return (
    <WorldProvider world={world}>
      <HeroLoading />

      <Canvas
        camera={{ far: 90, fov: 35, near: 0.5, position: [0, 0, 16] }}
        dpr={pinnedDpr > 0 ? pinnedDpr : [1, 2]}
        background={'#f2efe8'}
        // Preserve paper white under the scene lighting.
        renderer={{
          scheduler: { fps: 60 },
          toneMapping: NeutralToneMapping,
          toneMappingExposure: 1,
          trackTimestamp: profiling,
        }}
      >
        <Suspense fallback={null}>
          <FrameLoop />
          <Hero />
        </Suspense>
      </Canvas>
    </WorldProvider>
  );
}
