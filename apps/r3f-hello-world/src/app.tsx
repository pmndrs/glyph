import { Canvas } from '@react-three/fiber/webgpu';
import { Suspense, useState } from 'react';

import { TechniqueScene, type Technique } from './technique-scene';

export function App() {
  const [technique, setTechnique] = useState<Technique>('msdf');

  return (
    <Canvas
      camera={{ far: 1_000, near: -1_000, position: [0, 0, 10] }}
      fallback={<div className="fallback">WebGPU or WebGL2 is required.</div>}
      flat
      orthographic
    >
      <color attach="background" args={['#07090f']} />
      <Suspense fallback={null}>
        <TechniqueScene onTechniqueChange={setTechnique} technique={technique} />
      </Suspense>
    </Canvas>
  );
}
