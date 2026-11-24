import { GlyphInputError } from '../glyph-error.js';
import type { TextStyle } from '../text-properties.js';

/** The source layout features one baked font dropped, as its artifact records them. */
export interface BakedLayoutFeatureGaps {
  readonly dropped: ReadonlySet<string>;
  /** The font's family name, for the message; absent when the artifact does not carry one. */
  readonly family?: string;
}

/**
 * Throws where a style meets its fonts when it enables a feature one of them dropped at bake time. Every font in the
 * stack is checked, because shaping can resolve a run to any of them. A tag the source never had is not recorded and
 * stays silent, as in HarfBuzz, and a feature turned off (`value: 0`) never throws.
 */
export function assertLayoutFeaturesBaked(
  style: TextStyle | undefined,
  fonts: readonly BakedLayoutFeatureGaps[],
  path: readonly (string | number)[],
): void {
  const features = style?.features;
  if (features === undefined || features.length === 0 || fonts.length === 0) return;
  for (const [index, feature] of features.entries()) {
    if (feature.value === 0) continue;
    for (const font of fonts) {
      if (!font.dropped.has(feature.tag)) continue;
      throw new GlyphInputError(
        [...path, 'features', index],
        `feature '${feature.tag}' was not baked into ${font.family ?? 'this font'}; ` +
          `bake with --layout-features ${feature.tag} (layoutFeatures: ['${feature.tag}'])`,
      );
    }
  }
}
