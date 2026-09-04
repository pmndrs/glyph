import type { ExampleEntry, ExampleSlug } from '../../catalog';

/**
 * One scene filling the page, for a docs iframe: the same root and proxy as
 * everywhere else, with viewport activation. The proxy runs while its iframe
 * is in view, keeps its last frame when it is not, and fades that frame into
 * the live one when it returns.
 */
export function Preview({ slug, entry }: { readonly slug: ExampleSlug; readonly entry: ExampleEntry }) {
  return (
    <>
      <glyph-explainer-root id="preview" data-explainer-page="examples" max-slots="1" max-dpr="1.5" opaque />
      <glyph-proxy fit="cover" className="preview" root="preview" data-scene={slug} aria-label={entry.title} />
      <a className="example-source" href={entry.page} target="_top">
        {entry.title} — read the page
      </a>
    </>
  );
}
