import { Canvas } from '@react-three/fiber/webgpu';
import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { NoToneMapping } from 'three/webgpu';

import { App } from './app.js';

export function mountR3fExample(root: HTMLElement): () => void {
  const reactRoot = createRoot(root);
  reactRoot.render(
    <StrictMode>
      <Canvas
        camera={{ far: 1_000, near: -1_000, position: [0, 0, 10] }}
        fallback={<div className="fallback">WebGPU or WebGL2 is required.</div>}
        orthographic
        renderer={{ toneMapping: NoToneMapping }}
      >
        <color attach="background" args={['#07090f']} />
        <Suspense fallback={null}>
          <App />
        </Suspense>
      </Canvas>
    </StrictMode>,
  );
  return () => reactRoot.unmount();
}
