import { useRenderPipeline } from '@react-three/fiber/webgpu';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { pass, uv, vec3 } from 'three/tsl';

/**
 * The dark-room finish. Bloom is doing the real work: the nebula's bright cores sit inside the letterforms, and
 * letting them spill a little is what makes the word read as lit from within rather than as a picture pasted into a
 * stencil. The vignette closes the corners so the room falls away rather than ending at the viewport edge; it works
 * against the floor pool, so that pool is kept weak enough to sit under it rather than fight it.
 *
 * The pass also gives the scene MSAA, which the plain render had none of.
 */
const BLOOM_STRENGTH = 0.42;
const BLOOM_RADIUS = 0.65;
const BLOOM_THRESHOLD = 0.72;
/** How hard the corners close. Gentle: this should be felt, not seen. */
const VIGNETTE = 0.55;
export function OriginPost() {
  useRenderPipeline(({ renderPipeline, scene, camera }) => {
    const scenePass = pass(scene, camera, { samples: 4 });
    const beauty = scenePass.getTextureNode('output');
    const lit = beauty.add(bloom(beauty, BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD));
    // Radial falloff from the centre, squared so the middle stays untouched.
    const offset = uv().sub(0.5);
    const falloff = offset.dot(offset).mul(VIGNETTE).oneMinus().clamp(0, 1);
    renderPipeline.outputNode = lit.mul(vec3(falloff, falloff, falloff));
  });
  return null;
}
