import { useRenderPipeline } from '@react-three/fiber/webgpu';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { pass } from 'three/tsl';

/** Scene, plus a little bloom on the brightest highlights. Nothing else: the glass reads from its own material. */
export function Post() {
  useRenderPipeline(({ renderPipeline, scene, camera }) => {
    const scenePass = pass(scene, camera, { samples: 4 });
    const beauty = scenePass.getTextureNode('output');
    renderPipeline.outputNode = beauty.add(bloom(beauty, 0.18, 0.4, 1));
  });
  return null;
}
