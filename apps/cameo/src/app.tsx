import './cameo/styles.css';

import { Canvas } from '@react-three/fiber/webgpu';
import { WorldProvider } from 'koota/react';
import { Suspense } from 'react';
import { NeutralToneMapping } from 'three/webgpu';
import { CAMERA } from './cameo/content';
import { CameoLoading } from './cameo/loading';
import { Cameo } from './cameo/renderer';
import { FrameLoop } from './frameloop';
import { world } from './world';

export function App() {
  return (
    <WorldProvider world={world}>
      <CameoLoading />

      <Canvas
        camera={{ far: CAMERA.far, fov: CAMERA.fov, near: CAMERA.near, position: [...CAMERA.position] }}
        dpr={[1, 2]}
        background={'#e8e5dd'}
        shadows
        // Preserve the paper white of the floor under the studio lighting.
        renderer={{ scheduler: { fps: 60 }, toneMapping: NeutralToneMapping, toneMappingExposure: 1 }}
      >
        <Suspense fallback={null}>
          <FrameLoop />
          <Cameo />
        </Suspense>
      </Canvas>
    </WorldProvider>
  );
}
