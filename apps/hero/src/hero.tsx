import { WorldProvider } from 'koota/react';
import { createHeroWorld } from './world';
import { FrameLoop } from './frameloop';
import { useThree } from '@react-three/fiber/webgpu';
import { useEffect } from 'react';

import { useFaces, useFeatureField } from './fonts';
import { Post } from './post/Post';
import { BlackHole, GlyphBurst } from './sequence/renderer';
import { GlassShadows } from './typography/shadows';
import { GlassTitle, FeatureLine } from './typography/renderer';
import { FieldRenderer } from './field/renderer';
import { Lighting } from './view/Lighting';
import { Paper } from './view/Paper';
import { RobotRenderer } from './robot/renderer';
import { useInspector } from './useInspector';
import { PrepareHero } from './startup';

/** `?post=0` renders the plain scene: a clean capture pass, and a way to isolate post-processing. */
const POST_ENABLED = new URLSearchParams(location.search).get('post') !== '0';

const world = createHeroWorld();
if (import.meta.hot) import.meta.hot.dispose(() => world.destroy());

export function Hero() {
  return (
    <WorldProvider world={world}>
      <HeroScene />
    </WorldProvider>
  );
}

function HeroScene() {
  useInspector();
  const faces = useFaces();
  const featureField = useFeatureField();
  const scene = useThree((state) => state.scene);
  const renderer = useThree((state) => state.renderer);
  useEffect(() => {
    // Development-only handle for inspecting the scene from DevTools.
    if (!import.meta.env.DEV) return;
    Object.assign(globalThis, { heroScene: scene, heroRenderer: renderer });
  }, [renderer, scene]);

  return (
    <>
      <PrepareHero postProcessing={POST_ENABLED} />
      <FrameLoop />
      <Lighting />
      <Paper />
      <FieldRenderer faces={faces} />
      <GlassTitle faces={faces} />
      <GlassShadows />
      <FeatureLine field={featureField} />
      <RobotRenderer faces={faces} />
      <BlackHole />
      <GlyphBurst faces={faces} />
      {POST_ENABLED ? <Post /> : null}
    </>
  );
}
