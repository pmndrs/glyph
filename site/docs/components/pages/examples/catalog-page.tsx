import { lazy, type ComponentType } from 'react';

import type { ExampleEntry } from '../../../../examples/src/catalog/types';
import { SceneInputsContext } from '../../../../examples/src/lib/inputs';
import { defineExplainerPage, type ExplainerPageDefinition, type GlyphSceneProps } from '../../explainer/page';
import { Planned } from './planned';
import { ExampleStage } from './stage';

/**
 * A set of catalog entries as an explainer page: a proxy's `data-scene` is an example slug, each scene module is
 * fetched when a proxy first asks for it, and it stands on the stage its entry names. A section's page is this
 * over that section's entries, so a docs page fetches one section's table and only the scenes it shows.
 */
export function examplesPage(entries: Readonly<Record<string, ExampleEntry>>): ExplainerPageDefinition {
  const scenes: Record<string, ComponentType<GlyphSceneProps>> = {};
  for (const [slug, entry] of Object.entries(entries)) scenes[slug] = staged(entry);
  return defineExplainerPage(scenes, Planned);
}

function staged(entry: ExampleEntry): ComponentType<GlyphSceneProps> {
  const Scene = lazy(entry.load);
  return function ExampleScene({ inputs, onReady }: GlyphSceneProps) {
    return (
      <SceneInputsContext.Provider value={inputs}>
        <ExampleStage options={entry.stage} onReady={onReady}>
          <Scene />
        </ExampleStage>
      </SceneInputsContext.Provider>
    );
  };
}
