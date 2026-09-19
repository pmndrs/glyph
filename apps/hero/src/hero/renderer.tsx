import './styles.css';

import { useActions, useWorld, WorldProvider } from 'koota/react';
import { Collapse } from '../black-hole/traits';
import { Canvas, useFrame, useRenderPipeline } from '@react-three/fiber/webgpu';
import { StrictMode, Suspense, useEffect } from 'react';
import { NeutralToneMapping } from 'three/webgpu';
import { actions } from '../actions';
import { createHeroWorld } from '../world';
import { useFonts } from './fonts';
import { BlackHole } from '../black-hole/renderer';
import { StarEmbersRenderer } from '../star-embers/renderer';
import { GlassShadows } from '../letters/shadows';
import { GlassTitle, FeatureLine } from '../letters/renderer';
import { IconFieldRenderer } from '../icon-field/renderer';
import { Lighting, Paper } from './lighting';
import { RobotRenderer } from '../robot/renderer';
import { PrepareHero, heroReady } from './prepare';
import { HeroLoading } from './loading';

import { Time } from '../time/traits';
import { useInput } from '../input/hooks';
import { updatePaper, uTime } from './materials';
import { PATTERN_ANGLE } from '../icon-field/content';
import { advanceHero } from './systems';
import { convertToTexture, pass, uv } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { collapseSheet, uHoleBlackout, uHoleShake } from '../black-hole/materials';
import { composeStarEmbers, uEmberBloom } from '../star-embers/materials';

const heroWorld = createHeroWorld();

if (import.meta.hot) import.meta.hot.dispose(() => actions(heroWorld).disposeHero());

export function Hero() {
  return (
    <StrictMode>
      <HeroLoading />
      <WorldProvider world={heroWorld}>
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

function FrameLoop() {
  const world = useWorld();
  const commands = useActions(actions);

  useInput(world, () => {
    if (heroReady()) commands.replayHero();
  });

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    Object.assign(globalThis, {
      heroWorld: world,
      heroHole: {
        open: commands.openBlackHole,
        dismiss: commands.dismissBlackHole,
        hold: commands.holdBlackHole,
        state: () => world.get(Collapse)!.hole,
      },
      heroRobot: {
        spawn: commands.spawnRobot,
        reset: commands.resetRobot,
        run: commands.runRobot,
        hold: commands.holdRobot,
      },
    });
  }, [world, commands]);

  useFrame(
    ({ viewport, camera, pointer, size }, delta) => {
      commands.sampleView(viewport.width, viewport.height, camera.position.z, size.width / size.height, heroReady());
      commands.samplePointer(pointer.x, pointer.y);
      advanceHero(world, delta, performance.now());
      const time = world.get(Time)!;
      uTime.value = time.elapsed;
      updatePaper(time.elapsed, PATTERN_ANGLE);
    },
    { id: 'hero-simulation', phase: 'physics', fps: 60 },
  );

  return null;
}

/** Collapse the scene first, then compose the star embers over black. */
function Post() {
  useRenderPipeline(({ renderPipeline, scene, camera }) => {
    const scenePass = pass(scene, camera, { samples: 4 });
    const beauty = scenePass.getTextureNode('output');
    const lit = convertToTexture(beauty.add(bloom(beauty, uEmberBloom, 0.55, 1)));
    const point = uv().sub(0.5).add(uHoleShake);
    const sheet = collapseSheet(lit, point);
    renderPipeline.outputNode = composeStarEmbers(sheet, lit.rgb, uHoleBlackout, point);
  });

  return null;
}
