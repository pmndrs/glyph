import { defineTextMaterial, type ThreeTextMaterial } from '@pmndrs/glyph/three';
import { clamp, mix, positionWorld, texture, uniform, vec2, vec3, vec4 } from 'three/tsl';
import { DoubleSide, Matrix4, MeshStandardNodeMaterial, Vector2, type Texture } from 'three/webgpu';

/** Committed ink extents in paragraph space keep the video continuous across letters. */
export const uWordOrigin = uniform(new Vector2(0, 0));
export const uWordSize = uniform(new Vector2(1, 1));
/** Scale the sampled region around its center to preserve the video aspect ratio. */
export const uWordUvScale = uniform(new Vector2(1, 1));

/** Set to 1 to inspect video UV coordinates without rebuilding the material. */
export const uDebugUv = uniform(0);
/**
 * Map fragment world positions into word space. This keeps UVs stable under the view-dependent dilation of Slug
 * quads.
 */
export const uWordInverse = uniform(new Matrix4());

/** Analytic Slug coverage masks the video into the word. */
export function screenMaterial(video: Texture): ThreeTextMaterial {
  return defineTextMaterial((context) => {
    if (context.kind !== 'glyph' || context.format !== 'pmndrs.slug') return context.createDefaultMaterial();
    const { shader, position } = context;
    const material = new MeshStandardNodeMaterial({
      // Disable depth writes because overlapping coplanar glyph quads would otherwise fight for depth.
      depthWrite: false,
      metalness: 0.15,
      roughness: 0.35,
      side: DoubleSide,
      transparent: true,
    });

    material.positionNode = position;

    // Transform the fragment into word space without evaluating the Slug position graph twice.
    const local = uWordInverse.mul(vec4(positionWorld, 1)).xy;
    const wordUv = local.sub(uWordOrigin).div(uWordSize);
    // Cropped about the centre to keep the clip's aspect, then v flipped: paragraph space counts up, texture down.
    const covered = wordUv.sub(0.5).mul(uWordUvScale).add(0.5);
    const frame = texture(video, vec2(clamp(covered.x, 0, 1), clamp(covered.y, 0, 1).oneMinus()));
    material.colorNode = mix(frame.rgb, vec3(covered.x, covered.y, 0), uDebugUv);
    material.emissiveNode = frame.rgb.mul(0.55);
    material.opacityNode = shader.coverage;
    // Coverage is what the shadow pass has to read. AlphaTest does nothing there.
    material.maskShadowNode = shader.coverage;
    return material;
  });
}

/** Metallic text reflects the video-lit environment. Analytic coverage masks the letterforms. */
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
