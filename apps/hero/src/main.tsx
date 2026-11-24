import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// A `?probe` page hands the capture and profile scripts a handle. Nothing else loads it.
if (new URLSearchParams(location.search).has('probe')) {
  void import('./probe').then(({ installProbe }) => installProbe());
}
