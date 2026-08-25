import { useRenderPipeline } from '@react-three/fiber/webgpu';
import { vec3 } from 'three/tsl';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { lensflare } from 'three/examples/jsm/tsl/display/LensflareNode.js';

/**
 * Bloom feeds the flare, not the other way round: `lensflare` takes the bloom
 * texture as its input, so the ghosts are drawn from whatever the bloom judged
 * bright. The specular glint is what makes something bright in the first place.
 */
export function Effects() {
  useRenderPipeline(({ passes, renderPipeline }) => {
    const scene = passes.scenePass.getTextureNode();
    const bloomPass = bloom(scene, 0.16, 0.65, 0.96);
    const flare = lensflare(bloomPass.getTextureNode(), {
      ghostAttenuationFactor: 22,
      ghostSamples: 3,
      ghostSpacing: 0.32,
      ghostTint: vec3(0.78, 0.85, 1),
      threshold: 0.95,
    });

    renderPipeline.outputNode = scene.add(bloomPass).add(flare);
  });

  return null;
}
