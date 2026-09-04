import type { ComponentType } from 'react';
import type { WebGPURenderer } from 'three/webgpu';

import type { GlyphInputStream } from './channel';
import type { GlyphCameraOptions } from './root';

export type GlyphSceneProps = {
  inputs: GlyphInputStream;
  onReady: () => void;
  scene: string;
};

export type ExplainerPageOptions = Readonly<{
  /** The camera every root on the page starts with. */
  camera?: GlyphCameraOptions;
  /** Renderer state to set before a scene's frame is drawn; the renderer is shared, so it runs every frame. */
  prepare?: (scene: string, renderer: WebGPURenderer) => void;
}>;

export type ExplainerPageDefinition = Readonly<
  {
    fallback: ComponentType<GlyphSceneProps>;
    scenes: Readonly<Record<string, ComponentType<GlyphSceneProps>>>;
  } & ExplainerPageOptions
>;

/** Define one page's scene table; its folder name becomes the loader key. */
export function defineExplainerPage(
  scenes: Readonly<Record<string, ComponentType<GlyphSceneProps>>>,
  fallback: ComponentType<GlyphSceneProps>,
  options: ExplainerPageOptions = {},
): ExplainerPageDefinition {
  return Object.freeze({ fallback, scenes, ...options });
}
