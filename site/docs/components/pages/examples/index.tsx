import { lazy, type ComponentType } from 'react';
import { AgXToneMapping, NoToneMapping } from 'three/webgpu';

import {
  EXAMPLES,
  EXAMPLE_SLUGS,
  isExampleSlug,
  type ExampleEntry,
  type ExampleSlug,
} from '../../../../examples/src/catalog';
import { defineExplainerPage, type GlyphSceneProps } from '../../explainer/page';
import { ExampleStage, FOV } from './stage';

/**
 * The examples catalog as an explainer page: a proxy's `data-scene` is an
 * example slug, each scene is loaded on first use and stands on the stage its
 * catalog entry asks for. The docs pages, the gallery, and the single-example
 * preview all run scenes through this one table.
 */
function staged(slug: ExampleSlug): ComponentType<GlyphSceneProps> {
  const Scene = lazy(EXAMPLES[slug].load);
  const { stage } = EXAMPLES[slug];
  return function ExampleScene({ onReady }: GlyphSceneProps) {
    return (
      <ExampleStage options={stage} onReady={onReady}>
        <Scene />
      </ExampleStage>
    );
  };
}

const scenes = Object.fromEntries(EXAMPLE_SLUGS.map((slug) => [slug, staged(slug)])) as Record<
  ExampleSlug,
  ComponentType<GlyphSceneProps>
>;

export default defineExplainerPage(scenes, scenes.hello, {
  camera: { fov: FOV, near: 0.1, far: 100, position: [0, 0, 12] },
  prepare(scene, renderer) {
    // Film-like tone mapping only where PBR materials ask for it; text stays untouched.
    const entry: ExampleEntry | undefined = isExampleSlug(scene) ? EXAMPLES[scene] : undefined;
    renderer.toneMapping = entry?.stage.lit === true ? AgXToneMapping : NoToneMapping;
  },
});
