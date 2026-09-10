import { EXAMPLES, EXAMPLE_SLUGS } from '../../catalog';
import { Card } from './Card';

/**
 * Every example on one page, on one root. Cards are proxies under pointer
 * activation: a scene starts when a card is hovered with intent, touched,
 * clicked, or focused, two run at a time, and a card that scrolls away keeps
 * its last frame until it is engaged again.
 */
export function Gallery() {
  return (
    <main className="gallery">
      <header className="gallery-header">
        <h1>Examples</h1>
        <p>
          One feature, one scene, a few dozen lines each. Rest on a card to run it; it keeps its last frame when it
          scrolls away. Every card links to the page that explains it.
        </p>
      </header>
      <glyph-explainer-root
        id="gallery"
        data-explainer-page="examples"
        activation="pointer"
        hover-delay="160"
        max-slots="2"
        idle-ttl="15000"
        max-dpr="1.5"
        opaque
      />
      <section className="masonry">
        {EXAMPLE_SLUGS.map((slug) => (
          <Card key={slug} slug={slug} entry={EXAMPLES[slug]} />
        ))}
      </section>
    </main>
  );
}
