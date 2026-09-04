import { glyph } from '@pmndrs/glyph';
import { defineThreeConfig, type ThreeHandle } from '@pmndrs/glyph/three';

/**
 * The landing page's own Glyph handle.
 *
 * `independent` lets Rust reorder compatible draws. The default is `ordered`,
 * which forbids it — correct for text that overlaps itself, and needlessly
 * strict here: the chorus words never touch each other, so nothing depends on
 * the order they are composited in, and same-atlas runs scattered through the
 * paragraph can collapse into one draw.
 *
 * Compositing is an immutable adapter property, so it is chosen once on the
 * config rather than per TextGroup. The promise is created at module scope, so
 * the handle is minted exactly once no matter how often React re-renders.
 */
const landing: Promise<ThreeHandle> = glyph
  .init()
  .then(() => glyph.handle('@pmndrs/glyph-site:landing', defineThreeConfig({ compositing: 'independent' })));

export function landingHandle(): Promise<ThreeHandle> {
  return landing;
}
