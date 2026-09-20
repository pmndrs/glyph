import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app';
import './styles.css';

const root = document.querySelector<HTMLElement>('#root');
if (root === null) throw new Error('The juggler needs a #root element');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
