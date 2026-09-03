import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { EXAMPLES, type ExampleSlug, isExampleSlug } from './catalog';
import { ExamplePreview } from './components/preview';
import './styles.css';

/**
 * One page, one scene. `?example=<slug>` selects a scene from the catalog and
 * only that scene's module is loaded, so the docs can iframe any example
 * without paying for the others. The preview owns the scene's life: it runs
 * while in view and keeps its last frame while it is not.
 */
const url = new URL(window.location.href);
const requested = url.searchParams.get('example');
const slug: ExampleSlug = requested !== null && isExampleSlug(requested) ? requested : 'hello';
const entry = EXAMPLES[slug];

document.title = `${entry.title} · @pmndrs/glyph`;
document.documentElement.dataset['example'] = slug;

const root = document.querySelector('#root');
if (root === null) throw new Error('the examples page needs a #root element');

createRoot(root).render(
  <StrictMode>
    <ExamplePreview slug={slug} entry={entry} />
    <a className="example-source" href={entry.page} target="_top">
      {entry.title} — read the page
    </a>
  </StrictMode>,
);
