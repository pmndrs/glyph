import './view/styles.css';

import { FrameLoop } from './frameloop';
import { useWorld, WorldProvider } from 'koota/react';
import { Collapse } from './black-hole/traits';
import { Canvas } from '@react-three/fiber/webgpu';
import { StrictMode, Suspense } from 'react';
import { NeutralToneMapping } from 'three/webgpu';
import { actions } from './actions';
import { createHeroWorld } from './world';
import { useFonts } from './view/hooks';
import { BlackHole } from './black-hole/renderer';
import { StarEmbersRenderer } from './star-embers/renderer';
import { Post } from './sequence/renderer';
import { GlassShadows } from './letters/shadows';
import { GlassTitle, FeatureLine } from './letters/renderer';
import { IconFieldRenderer } from './icon-field/renderer';
import { Lighting, Paper } from './view/renderer';
import { RobotRenderer } from './robot/renderer';
import { HeroLoading, PrepareHero } from './view/startup';

const world = createHeroWorld();

if (import.meta.hot) import.meta.hot.dispose(() => actions(world).disposeHero());

export function Hero() {
  return (
    <StrictMode>
      <HeroLoading />
      <WorldProvider world={world}>
        <Canvas
          camera={{ far: 90, fov: 35, near: 0.5, position: [0, 0, 16] }}
          dpr={[1, 2]}
          background={'#f2efe8'}
          // Preserve paper white under the scene lighting.
          renderer={{ scheduler: { fps: 60 }, toneMapping: NeutralToneMapping, toneMappingExposure: 1 }}
        >
          <Suspense fallback={null}>
            <Scene />
          </Suspense>
        </Canvas>
      </WorldProvider>
    </StrictMode>
  );
}

function Scene() {
  const fonts = useFonts();
  const collapse = useWorld().get(Collapse)!.hole;

  return (
    <>
      <PrepareHero />
      <FrameLoop />
      <Lighting />
      <Paper />
      <IconFieldRenderer font={fonts.icons} />
      <GlassTitle font={fonts.title} />
      <GlassShadows />
      <FeatureLine field={fonts.feature} collapse={collapse} />
      <RobotRenderer font={fonts.robot} icons={fonts.icons} />
      <BlackHole />
      <StarEmbersRenderer font={fonts.stars} />
      <Post />
    </>
  );
}
