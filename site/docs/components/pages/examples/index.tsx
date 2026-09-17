import { lazy, type ComponentType } from 'react';

import { EXAMPLES, EXAMPLE_SLUGS, type ExampleSlug } from '../../../../examples/src/catalog';
import { SceneInputsContext } from '../../../../examples/src/lib/inputs';
import { defineExplainerPage, type GlyphSceneProps } from '../../explainer/page';
import { Planned } from './planned';
import { ExampleStage } from './stage';

/**
 * The examples catalog as an explainer page: a proxy's `data-scene` is an
 * example slug, each scene is loaded on first use and stands on the stage its
 * catalog entry asks for. The docs pages, the gallery, and the single-example
 * preview all run scenes through this one table.
 */
function staged(slug: ExampleSlug): ComponentType<GlyphSceneProps> {
  const Scene = lazy(EXAMPLES[slug].load);
  const { stage } = EXAMPLES[slug];
  return function ExampleScene({ inputs, onReady }: GlyphSceneProps) {
    return (
      <SceneInputsContext.Provider value={inputs}>
        <ExampleStage options={stage} onReady={onReady}>
          <Scene />
        </ExampleStage>
      </SceneInputsContext.Provider>
    );
  };
}

const scenes = Object.fromEntries(EXAMPLE_SLUGS.map((slug) => [slug, staged(slug)])) as Record<
  ExampleSlug,
  ComponentType<GlyphSceneProps>
>;

export default defineExplainerPage(scenes, Planned);
