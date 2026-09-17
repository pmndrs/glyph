import { glyph } from '@pmndrs/glyph';
import { defineThreeConfig, type ThreeHandle } from '@pmndrs/glyph/three';

/**
 * The landing page's own Glyph handle.
 *
 * The promise is created at module scope, so the handle is minted exactly once
 * no matter how often React re-renders.
 */
const landing: Promise<ThreeHandle> = glyph
  .init()
  .then(() => glyph.handle('@pmndrs/glyph-site:landing', defineThreeConfig()));

export function landingHandle(): Promise<ThreeHandle> {
  return landing;
}
