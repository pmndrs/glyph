import type { Text } from '@pmndrs/glyph/three';
import { trait } from 'koota';

/** Characters the headline may hold: the shader's arrival table is this long. */
export const HEADLINE_CAPACITY = 24;

/**
 * The headline as it types itself. Its text is laid out whole from the start, so the line never shifts; a
 * character is drawn from the moment it arrives, and the ink of a new arrival is still spreading.
 */
export const Headline = trait({
  /** Characters typed so far. */
  shown: 0,
  length: 0,
  typing: false,
  /** When the next character lands, on the playback clock. */
  nextAt: 0,
  /** When each character arrived, on the playback clock. Not yet arrived is far in the future. */
  arrivals: () => new Float32Array(HEADLINE_CAPACITY).fill(1e9),
  /** The caret stop before each character and after the last, in page units, and the caret's top and height. */
  edges: () => new Float32Array(HEADLINE_CAPACITY + 1),
  top: 0,
  height: 1,
  measured: false,
});

export interface HeadlineDraw {
  text: Text<never>;
  /** The headline's own origin on the page. */
  originX: number;
  originY: number;
  uniforms: typeof import('./materials').titleUniforms;
}

export const HeadlineView = trait((): HeadlineDraw | undefined => undefined);
