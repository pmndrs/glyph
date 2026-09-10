import { useRef } from 'react';

import type { ExampleEntry, ExampleSlug } from '../../catalog';

/**
 * One scene filling the page, for a docs iframe: the same root and proxy as
 * everywhere else, with viewport activation. The proxy runs while its iframe
 * is in view, keeps its last frame when it is not, and fades that frame into
 * the live one when it returns.
 */
export function Preview({ slug, entry }: { readonly slug: ExampleSlug; readonly entry: ExampleEntry }) {
  const shell = useRef<HTMLDivElement>(null);

  const toggleFullscreen = () => {
    const target = shell.current;
    if (target === null) return;
    if (document.fullscreenElement === target) void document.exitFullscreen();
    else void target.requestFullscreen({ navigationUI: 'hide' });
  };

  return (
    <div ref={shell} className="preview-shell">
      <glyph-explainer-root id="preview" data-explainer-page="examples" max-slots="1" max-dpr="1.5" opaque />
      <glyph-proxy
        fit="cover"
        className="preview"
        root="preview"
        data-scene={slug}
        tabIndex={0}
        aria-label={entry.title}
      />
      <button
        className="fullscreen-control preview-fullscreen"
        type="button"
        title="Fullscreen"
        aria-label="Fullscreen"
        onClick={toggleFullscreen}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />
        </svg>
      </button>
      <a className="example-source" href={entry.page} target="_top">
        {entry.title} — read the page
      </a>
    </div>
  );
}
