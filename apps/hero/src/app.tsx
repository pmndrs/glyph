import './styles.css';

import { Canvas, useRenderPipeline } from '@react-three/fiber/webgpu';
import { WorldProvider } from 'koota/react';
import { Suspense } from 'react';
import { Environment, Lightformer } from '@react-three/drei/webgpu';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { convertToTexture, pass, uv, vec4 } from 'three/tsl';
import { NeutralToneMapping } from 'three/webgpu';
import { BlackHole } from './black-hole/renderer';
import { collapseSheet, uHoleBlackout, uHoleScreen, uHoleShake } from './black-hole/materials';
import { FrameLoop } from './frameloop';
import { GlassRenderer } from './glass/renderer';
import { IconPaperRenderer } from './icon-paper/renderer';
import { FeatureLine, GlassTitle } from './letters/renderer';
import { useFonts } from './loading/fonts';
import { PrepareHero } from './loading/prepare';
import { Paper } from './paper/renderer';
import { HeroLoading, PlayButtonRenderer, playSheet } from './ui/renderer';
import { RainRenderer } from './rain/renderer';
import { RobotRenderer } from './robot/renderer';
import { SoundRenderer } from './sound/renderer';
import { composeStarEmbers, uEmberBloom } from './star-embers/materials';
import { StarEmbersRenderer } from './star-embers/renderer';
import { world } from './world';

/**
 * A `?profile` page records GPU timestamps for the performance checks, `dpr` pins the pixel ratio they run at, and
 * `nomsaa` and `nobloom` leave those out of the post pass to weigh them; the device feature costs nothing else.
 */
const query = new URLSearchParams(location.search);
const profiling = query.has('profile');
const pinnedDpr = Number(query.get('dpr'));

export function App() {
  return (
    <WorldProvider world={world}>
      <HeroLoading />

      <Canvas
        camera={{ far: 90, fov: 35, near: 0.5, position: [0, 0, 16] }}
        dpr={pinnedDpr > 0 ? pinnedDpr : [1, 2]}
        background={'#f2efe8'}
        // Preserve paper white under the scene lighting.
        renderer={{
          scheduler: { fps: 60 },
          toneMapping: NeutralToneMapping,
          toneMappingExposure: 1,
          trackTimestamp: profiling,
        }}
      >
        <Suspense fallback={null}>
          <FrameLoop />
          <Scene />
        </Suspense>
      </Canvas>
    </WorldProvider>
  );
}

/** The scene: every domain's renderer, lit as a studio, composed through the post pass. */
function Scene() {
  const fonts = useFonts();

  return (
    <>
      <PrepareHero />
      <Lighting />
      <Paper />
      <IconPaperRenderer font={fonts.icons} />
      <GlassTitle font={fonts.title} />
      <GlassRenderer />
      <FeatureLine field={fonts.feature} />
      <RobotRenderer font={fonts.robot} icons={fonts.icons} />
      <BlackHole />
      <StarEmbersRenderer font={fonts.stars} />
      <RainRenderer font={fonts.title} />
      <PlayButtonRenderer font={fonts.robot} />
      <Post />
      {/* The scene never waits on its sound: the samples bake beside preparation and join when they are ready. */}
      <Suspense fallback={null}>
        <SoundRenderer />
      </Suspense>
    </>
  );
}

/**
 * Collapse the scene into the hole first, compose the star embers over black about the same point, then lay the
 * play button's sheet on top.
 */
function Post() {
  useRenderPipeline(({ renderPipeline, scene, camera }) => {
    // The profile page can leave out the multisampling and the bloom, to weigh them.
    const scenePass = pass(scene, camera, { samples: query.has('nomsaa') ? 0 : 4 });
    const beauty = scenePass.getTextureNode('output');
    // The bloom takes only what is brighter than white, and a quarter of the frame's resolution is plenty for a glow.
    const glow = bloom(beauty, uEmberBloom, 0.55, 1);
    glow.setResolutionScale(0.25);
    const lit = convertToTexture(query.has('nobloom') ? beauty : beauty.add(glow));
    const point = uv().sub(0.5).sub(uHoleScreen).add(uHoleShake);
    const sheet = collapseSheet(lit, point);
    const button = pass(playSheet.scene, playSheet.camera, { depthBuffer: false });
    // The button's sheet is black wherever the button is not drawn, so it adds straight onto the finished frame.
    const finished = composeStarEmbers(sheet, lit.rgb, uHoleBlackout, point);
    renderPipeline.outputNode = vec4(finished.rgb.add(button.getTextureNode('output').rgb), 1);
  });

  return null;
}

/** Bright studio for glass on paper: a broad key overhead, two side strips for edge highlights, and a soft fill. */
function Lighting() {
  return (
    <>
      <Environment resolution={256} background={false} environmentIntensity={1.15}>
        <Lightformer
          form="rect"
          intensity={5}
          color="#ffffff"
          position={[0, 7, 7]}
          rotation-x={Math.PI / 2}
          scale={[18, 3, 1]}
        />
        <Lightformer
          form="rect"
          intensity={3}
          color="#ffffff"
          position={[-11, 0, 4]}
          rotation-y={Math.PI / 2}
          scale={[3, 12, 1]}
        />
        <Lightformer
          form="rect"
          intensity={3}
          color="#ffffff"
          position={[11, 0, 4]}
          rotation-y={-Math.PI / 2}
          scale={[3, 12, 1]}
        />
        <Lightformer form="ring" intensity={2} color="#dfe8ff" position={[0, 0, -10]} scale={14} />
      </Environment>
      <directionalLight name="glass-key" color="#ffffff" intensity={1.6} position={[4, 6, 10]} />
      <ambientLight intensity={0.35} />
    </>
  );
}
