import { defineTextMaterial, type ThreeTextMaterial } from '@pmndrs/glyph/three';
import { clamp, mix, positionWorld, texture, uniform, vec2, vec3, vec4 } from 'three/tsl';
import { DoubleSide, Matrix4, MeshStandardNodeMaterial, Vector2, type Texture } from 'three/webgpu';

/**
 * Where the word's ink sits in the paragraph's own space. The clip is sampled against this rather than against each
 * glyph's quad, so one continuous picture runs across the whole word instead of repeating inside every letter.
 * Uniforms because the extents are only known once a layout has committed.
 */
export const uWordOrigin = uniform(new Vector2(0, 0));
export const uWordSize = uniform(new Vector2(1, 1));
/**
 * Cover correction. The clip is 960x360 and the word's ink box is a different shape, so mapping 0..1 across both
 * stretches the picture. This scales the sampled region about its centre to the clip's own aspect, cropping the
 * overflow rather than squashing it.
 */
export const uWordUvScale = uniform(new Vector2(1, 1));
/**
 * No pan and no zoom: the window is the whole frame, fixed. Drifting the sampled window did add motion, but it moved
 * the picture independently of the footage, and two unrelated motions made it hard to read what the clip actually
 * was. Speed lives in the playback rate instead, where it belongs.
 */
/** 1 paints the sampling coordinate instead of the clip. Live uniform, not a URL flag, so it can be flipped without
 * a reload — the material is built once and a reload was caching the old graph. */
export const uDebugUv = uniform(0);
/**
 * World space back into the word's own space. The uv has to come from somewhere stable, and the position the material
 * is handed is Slug's *dilated* quad position — each glyph quad is pushed outward to cover its antialiasing
 * footprint, and that push depends on the view. Deriving the uv from it made the coordinate move with the camera,
 * which is the flicker along glyph edges and the skew where the dilation is widest. The fragment's world position is
 * the real point on the letter's plane; run it through this and the uv is fixed to the word, not to the quad.
 */
export const uWordInverse = uniform(new Matrix4());

/** A little of the clip as its own light, so the nebula's core reads as glowing through the letter. */
const EMISSIVE_GAIN = 0.55;

/**
 * The word as a window onto the clip. Slug publishes analytic coverage, which is all a mask needs — no distance
 * field, so this technique is untouched by the gap in pmndrs/glyph#179.
 */
export function screenMaterial(video: Texture): ThreeTextMaterial {
  return defineTextMaterial((context) => {
    if (context.kind !== 'glyph' || context.format !== 'pmndrs.slug') return context.createDefaultMaterial();
    const { shader, position } = context;
    const material = new MeshStandardNodeMaterial({
      // `transparent` does not imply this in three, and the default is to write depth. Glyph quads overlap wherever
      // letters are kerned tightly — the L's box runs under the Y's left arm — so two coplanar quads end up fighting
      // over the same depth and the winner changes with the camera. That is the flickering black corner.
      depthWrite: false,
      metalness: 0.15,
      roughness: 0.35,
      side: DoubleSide,
      transparent: true,
    });

    material.positionNode = position;

    // The letter's plane position, in the word's local space. No custom varying and no second evaluation of Slug's
    // position graph — that graph assigns Slug's own varying as a side effect, so touching it twice was never safe.
    const local = uWordInverse.mul(vec4(positionWorld, 1)).xy;
    const wordUv = local.sub(uWordOrigin).div(uWordSize);
    // Cropped about the centre to keep the clip's aspect, then v flipped: paragraph space counts up, texture down.
    const covered = wordUv.sub(0.5).mul(uWordUvScale).add(0.5);
    const frame = texture(video, vec2(clamp(covered.x, 0, 1), clamp(covered.y, 0, 1).oneMinus()));
    material.colorNode = mix(frame.rgb, vec3(covered.x, covered.y, 0), uDebugUv);
    material.emissiveNode = frame.rgb.mul(EMISSIVE_GAIN);
    material.opacityNode = shader.coverage;
    // Coverage is what the shadow pass has to read; alphaTest does nothing there.
    material.maskShadowNode = shader.coverage;
    return material;
  });
}

/**
 * The story column, in metal. Slug's coverage masks a standard material, so the copy is a real lit surface rather
 * than flat ink: at this metalness it mirrors the environment, and the environment is the same clip that fills the
 * word. The colour that lands on the paragraph is therefore the nebula's, arriving the same way it would in a room —
 * no faking, because three has no global illumination and the letters' own emissive lights nothing.
 */
export const storyMaterial = defineTextMaterial((context) => {
  if (context.kind !== 'glyph' || context.format !== 'pmndrs.slug') return context.createDefaultMaterial();
  const { shader, position } = context;
  const material = new MeshStandardNodeMaterial({
    color: '#aab4c8',
    // Same reason as the word: overlapping quads must not fight over depth.
    depthWrite: false,
    metalness: 0.5,
    roughness: 0.3,
    side: DoubleSide,
    transparent: true,
  });
  material.positionNode = position;
  material.opacityNode = shader.coverage;
  // A floor under the lighting: metal in a dark room goes almost black, and copy has to stay readable.
  material.emissiveNode = vec3(0.1, 0.115, 0.14);
  return material;
});
