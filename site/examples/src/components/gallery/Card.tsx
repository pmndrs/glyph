import type { ExampleEntry, ExampleSlug } from '../../catalog';

/** One card: a proxy the reader engages, and a footer naming the example and its page. */
export function Card({ slug, entry }: { readonly slug: ExampleSlug; readonly entry: ExampleEntry }) {
  return (
    <article className="card" style={{ aspectRatio: entry.aspect ?? '16 / 9' }}>
      {/* A custom element cannot be a <button>; the proxy handles Enter, Space, focus, and touch itself. */}
      {/* oxlint-disable-next-line jsx-a11y/prefer-tag-over-role */}
      <glyph-proxy root="gallery" data-scene={slug} role="button" tabIndex={0} aria-label={entry.title} />
      <footer>
        <h2>{entry.title}</h2>
        <a href={entry.page} target="_top">
          read the page
        </a>
      </footer>
    </article>
  );
}
