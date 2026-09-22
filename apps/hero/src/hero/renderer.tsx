import { useRenderPipeline } from '@react-three/fiber/webgpu';
import { convertToTexture, pass, uv } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { BlackHole } from '../black-hole/renderer';
import { collapseSheet, uHoleBlackout, uHoleScreen, uHoleShake } from '../black-hole/materials';
import { StarEmbersRenderer } from '../star-embers/renderer';
import { composeStarEmbers, uEmberBloom } from '../star-embers/materials';
import { PlayButtonRenderer, playSheet } from '../play-button/renderer';
import { RainRenderer } from '../rain/renderer';
import { composePlayButton } from '../play-button/materials';
import { GlassShadows } from '../letters/shadows';
import { GlassLens } from '../letters/lens';
import { GlassTitle, FeatureLine } from '../letters/renderer';
import { IconPaperRenderer } from '../icon-paper/renderer';
import { RobotRenderer } from '../robot/renderer';
import { Lighting, Paper } from './lighting';
import { PrepareHero } from './prepare';
import { useFonts } from './fonts';

export function Hero() {
  const fonts = useFonts();

  return (
    <>
      <PrepareHero />
      <Lighting />
      <Paper />
      <IconPaperRenderer font={fonts.icons} />
      <GlassTitle font={fonts.title} />
      <GlassLens />
      <GlassShadows />
      <FeatureLine field={fonts.feature} />
      <RobotRenderer font={fonts.robot} icons={fonts.icons} />
      <BlackHole />
      <StarEmbersRenderer font={fonts.stars} />
      <RainRenderer font={fonts.title} />
      <PlayButtonRenderer font={fonts.robot} />
      <Post />
    </>
  );
}

/**
 * Collapse the scene into the hole first, compose the star embers over black about the same point, then lay the
 * play button's sheet on top.
 */
function Post() {
  useRenderPipeline(({ renderPipeline, scene, camera }) => {
    const scenePass = pass(scene, camera, { samples: 4 });
    const beauty = scenePass.getTextureNode('output');
    const lit = convertToTexture(beauty.add(bloom(beauty, uEmberBloom, 0.55, 1)));
    const point = uv().sub(0.5).sub(uHoleScreen).add(uHoleShake);
    const sheet = collapseSheet(lit, point);
    const button = pass(playSheet.scene, playSheet.camera, { depthBuffer: false });
    renderPipeline.outputNode = composePlayButton(
      composeStarEmbers(sheet, lit.rgb, uHoleBlackout, point),
      button.getTextureNode('output'),
    );
  });

  return null;
}
