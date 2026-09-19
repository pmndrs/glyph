import { useRenderPipeline } from '@react-three/fiber/webgpu';
import { useWorld } from 'koota/react';
import { convertToTexture, pass, uv } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { Collapse } from '../black-hole/traits';
import { BlackHole } from '../black-hole/renderer';
import { collapseSheet, uHoleBlackout, uHoleShake } from '../black-hole/materials';
import { StarEmbersRenderer } from '../star-embers/renderer';
import { composeStarEmbers, uEmberBloom } from '../star-embers/materials';
import { GlassShadows } from '../letters/shadows';
import { GlassTitle, FeatureLine } from '../letters/renderer';
import { IconFieldRenderer } from '../icon-field/renderer';
import { RobotRenderer } from '../robot/renderer';
import { Lighting, Paper } from './lighting';
import { PrepareHero } from './prepare';
import { useFonts } from './fonts';

export function Hero() {
  const fonts = useFonts();
  const collapse = useWorld().get(Collapse)!.hole;

  return (
    <>
      <PrepareHero />
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
