import { useRef } from 'react';

import type { ExampleEntry, ExampleSlug } from '../../catalog';

/** One card: a proxy the reader engages, and a footer naming the example and its page. */
export function Card({ slug, entry }: { readonly slug: ExampleSlug; readonly entry: ExampleEntry }) {
  const stage = useRef<HTMLDivElement>(null);

  const toggleFullscreen = () => {
    const target = stage.current;
    if (target === null) return;
    if (document.fullscreenElement === target) void document.exitFullscreen();
    else void target.requestFullscreen({ navigationUI: 'hide' });
  };

  return (
    <article className="card">
      <div ref={stage} className="card-stage" style={{ aspectRatio: entry.aspect ?? '16 / 9' }}>
        <img
          className="card-poster"
          src={`${import.meta.env.BASE_URL}thumbnails/${slug}.webp`}
          alt=""
          aria-hidden="true"
        />
        {/* A custom element cannot be a <button>; the proxy handles Enter, Space, focus, and touch itself. */}
        {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role */}
        <glyph-proxy fit="cover" root="gallery" data-scene={slug} role="button" tabIndex={0} aria-label={entry.title} />
        <FullscreenButton onClick={toggleFullscreen} />
      </div>
      <footer>
        <h2>{entry.title}</h2>
        <a href={`?example=${slug}`}>open demo</a>
      </footer>
    </article>
  );
}

function FullscreenButton({ onClick }: { readonly onClick: () => void }) {
  return (
    <button className="fullscreen-control" type="button" title="Fullscreen" aria-label="Fullscreen" onClick={onClick}>
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
        <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />
      </svg>
    </button>
  );
}
