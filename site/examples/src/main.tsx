import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { installExplainerPages } from '../../docs/components/explainer';
import examples from '../../docs/components/pages/examples';
import { EXAMPLES, isExampleSlug } from './catalog';
import { Gallery } from './components/gallery';
import { Preview } from './components/preview';
import './styles.css';

/**
 * Two pages on one element. `?example=<slug>` is one scene filling the page,
 * for the docs to iframe. No slug is the gallery: every example, one root,
 * scenes started by hand.
 */
installExplainerPages(new Map([['examples', examples]]));

const requested = new URL(window.location.href).searchParams.get('example');
const root = document.querySelector('#root');
if (root === null) throw new Error('the examples page needs a #root element');

if (requested !== null && isExampleSlug(requested)) {
  const entry = EXAMPLES[requested];
  document.title = `${entry.title} · @pmndrs/glyph`;
  document.documentElement.dataset['example'] = requested;
  createRoot(root).render(
    <StrictMode>
      <Preview slug={requested} entry={entry} />
    </StrictMode>,
  );
} else {
  document.title = 'Examples · @pmndrs/glyph';
  document.documentElement.dataset['mode'] = 'gallery';
  createRoot(root).render(
    <StrictMode>
      <Gallery />
    </StrictMode>,
  );
}
