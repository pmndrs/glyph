import { StrictMode } from 'react';
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
    <App />
  </StrictMode>,
);
