import type { ComponentType } from 'react';

import type { GlyphInputStream } from './channel';

export type GlyphSceneProps = {
  inputs: GlyphInputStream;
  onReady: () => void;
  scene: string;
};

export type ExplainerPageDefinition = Readonly<{
  fallback: ComponentType<GlyphSceneProps>;
  scenes: Readonly<Record<string, ComponentType<GlyphSceneProps>>>;
}>;

/** Define one page's scene table; its folder name becomes the loader key. */
export function defineExplainerPage(
  scenes: Readonly<Record<string, ComponentType<GlyphSceneProps>>>,
  fallback: ComponentType<GlyphSceneProps>,
): ExplainerPageDefinition {
  return Object.freeze({ fallback, scenes });
}
