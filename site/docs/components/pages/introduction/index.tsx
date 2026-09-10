import { defineExplainerPage, type GlyphSceneProps } from '../../explainer/page';
import type { ComponentType } from 'react';

import { ColumnsScene } from './columns-scene';
import { EditingScene } from './editing-scene';
import { FontStackScene } from './font-stack-scene';
import { IconsScene } from './icons-scene';
import { ObjectShowcaseScene } from './object-showcase';
import { PhysicsScene } from './physics-scene';
import { PositioningScene } from './positioning-scene';
import { StylingScene } from './styling-scene';
import { TechniqueScene } from './technique-scene';
import { WordScene } from './word-scene';

const scenes: Readonly<Record<string, ComponentType<GlyphSceneProps>>> = {
  glyph: WordScene,
  shaping: WordScene,
  techniques: TechniqueScene,
  styling: StylingScene,
  positioning: PositioningScene,
  'object-showcase': ObjectShowcaseScene,
  columns: ColumnsScene,
  'font-stack': FontStackScene,
  icons: IconsScene,
  editing: EditingScene,
  physics: PhysicsScene,
};

export default defineExplainerPage(scenes, WordScene);

export { PhysicsScene } from './physics-scene';
