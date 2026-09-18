import { useRenderPipeline } from '@react-three/fiber/webgpu';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { pass, uv, vec3 } from 'three/tsl';

export function OriginPost() {
  useRenderPipeline(({ renderPipeline, scene, camera }) => {
    const scenePass = pass(scene, camera, { samples: 4 });
    const beauty = scenePass.getTextureNode('output');
    const lit = beauty.add(bloom(beauty, 0.42, 0.65, 0.72));
    // Radial falloff from the centre, squared so the middle stays untouched.
    const offset = uv().sub(0.5);
    const falloff = offset.dot(offset).mul(0.55).oneMinus().clamp(0, 1);
    renderPipeline.outputNode = lit.mul(vec3(falloff, falloff, falloff));
  });
  return null;
}
