import { useRenderPipeline } from '@react-three/fiber/webgpu';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';

/** A restrained finishing pass: bright highlights glow without washing out the metal. */
export function MetalBloom() {
  useRenderPipeline(({ passes, renderPipeline }) => {
    if (renderPipeline === null) return;
    const scene = passes.scenePass.getTextureNode();
    const highlights = bloom(scene, 0.28, 0.18, 0.78);
    renderPipeline.outputNode = scene.add(highlights);
  });

  return null;
}
