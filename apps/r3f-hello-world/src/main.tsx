import { Canvas } from '@react-three/fiber/webgpu';
import { StrictMode } from 'react';
import { Suspense } from 'react';
import { createRoot } from 'react-dom/client';

import shaperWasmUrl from '@pmndrs/text/text-shaper.wasm?url';

import { App } from './app';
import './styles.css';

const root = document.querySelector('#root');
if (root === null) throw new Error('R3F hello-world root is missing');

const shaperPreload = document.createElement('link');
shaperPreload.rel = 'preload';
shaperPreload.as = 'fetch';
shaperPreload.crossOrigin = 'anonymous';
shaperPreload.href = shaperWasmUrl;
document.head.append(shaperPreload);

createRoot(root).render(
  <StrictMode>
    <Canvas
      camera={{ far: 1_000, near: -1_000, position: [0, 0, 10] }}
      fallback={<div className="fallback">WebGPU or WebGL2 is required.</div>}
      flat
      orthographic
    >
      <color attach="background" args={['#07090f']} />
      <Suspense fallback={null}>
        <App />
      </Suspense>
    </Canvas>
  </StrictMode>,
);
