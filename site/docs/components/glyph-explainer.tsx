import './glyph-explainer.css';

const registerElements = () => {
  void import('./glyph-offscreen-root').then(() => import('./introduction-glyph'));
};

if (document.readyState === 'complete') registerElements();
else window.addEventListener('load', registerElements, { once: true });
