import { useRenderPipeline } from '@react-three/fiber/webgpu';
import { convertToTexture, pass, uv } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { collapseSheet, uHoleBlackout, uHoleShake } from '../black-hole/materials';
import { composeStarEmbers, uEmberBloom } from '../star-embers/materials';

/** Collapse the scene first, then compose the star embers over black. */
export function Post() {
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
