import { FrameLoop } from './frameloop';
import { useWorld } from 'koota/react';
import { Collapse } from './black-hole/traits';
import { useThree } from '@react-three/fiber/webgpu';
import { useEffect } from 'react';

import { useFonts } from './view/fonts';
import { Post } from './black-hole/post';
import { BlackHole, GlyphBurst } from './black-hole/renderer';
import { GlassShadows } from './typography/shadows';
import { GlassTitle, FeatureLine } from './typography/renderer';
import { FieldRenderer } from './field/renderer';
import { Lighting } from './view/Lighting';
import { Paper } from './view/Paper';
import { RobotRenderer } from './robot/renderer';
import { PrepareHero } from './view/startup';

/** `?post=0` renders the plain scene: a clean capture pass, and a way to isolate post-processing. */
const POST_ENABLED = new URLSearchParams(location.search).get('post') !== '0';

export function Hero() {
  const fonts = useFonts();
  const collapse = useWorld().get(Collapse)!.hole;
  const scene = useThree((state) => state.scene);
  const renderer = useThree((state) => state.renderer);

  useEffect(() => {
    // Development-only handle for inspecting the scene from DevTools.
    if (!import.meta.env.DEV) return;

    Object.assign(globalThis, { heroScene: scene, heroRenderer: renderer });
  }, [renderer, scene]);

  return (
    <>
      <PrepareHero
        postProcessing={POST_ENABLED}
        required={['title', 'feature', 'icons:-6', 'icons:-9.5', 'robot', 'dust', 'burst']}
        sceneReady={() => scene.environment !== null && scene.getObjectByName('glass-shadows') !== undefined}
      />
      <FrameLoop />
      <Lighting />
      <Paper />
      <FieldRenderer font={fonts.icons} />
      <GlassTitle font={fonts.title} />
      <GlassShadows />
      <FeatureLine field={fonts.feature} collapse={collapse} />
      <RobotRenderer font={fonts.robot} icons={fonts.icons} />
      <BlackHole />
      <GlyphBurst font={fonts.stars} />
      {POST_ENABLED ? <Post /> : null}
    </>
  );
}
