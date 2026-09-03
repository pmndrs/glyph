import { defineTextMaterial } from '@pmndrs/glyph/three';
import { color, mix, positionWorld, texture, uniform, uv, vec2 } from 'three/tsl';

import { LANE_TURN } from './config';
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial, type Texture } from 'three/webgpu';

/**
 * Ink on a path: depth-tested, so the knot hides what passes behind it, and
 * dimmed with distance from the camera plane. `depthWrite` stays off — a
 * glyph quad is transparent outside its ink.
 */
export const pathInk = defineTextMaterial((context) => {
  const material = context.createDefaultMaterial();
  if (context.kind !== 'glyph') return material;
  material.depthTest = true;
  // The shadow pass runs the same vertex placement (the material's positionNode) but knows nothing about the
  // glyph's ink, so a quad would cast its rectangle. three's maskShadowNode discards shadow fragments where the
  // mask is false; Slug's coverage is analytic per pixel, so the shadow is the glyph's outline, crisp at any size.
  const shader = context.shader;
  if ('coverage' in shader) material.maskShadowNode = shader.coverage.greaterThan(0.5);
  else if ('fillCoverage' in shader) material.maskShadowNode = shader.fillCoverage.greaterThan(0.5);
  const near = positionWorld.z.add(4).div(6).clamp(0.4, 1);
  material.colorNode = context.shader.color.mul(near);
  material.opacityNode = context.shader.opacity;
  return material;
});

/** How far the tile has scrolled along the knot, in tile widths. */
export const surfaceScroll = uniform(0);

/**
 * The knot's skin, the Codrops way: the render target is a strip holding the
 * passage as it is typed in its middle lane and small type in the outer
 * ones; it repeats `repeat.x` times along the knot, wraps the tube once, and
 * scrolls by a uniform — the Codrops
 * `uv * repeat - time`, wrapped by the sampler rather than a `fract`. The strip's colour is taken as is, so the
 * accented word stays accented on the surface; a facing term and a depth
 * term shade the tube so the knot reads as a solid. The strip is a live Slug
 * scene, so the words can change under the pattern without the pattern
 * noticing.
 */
export function surfaceMaterial(
  surface: Texture,
  repeat: { readonly x: number; readonly y: number },
): MeshStandardNodeMaterial {
  // Lit, so the rings can throw shadows onto it; the light rig lives in the scene.
  const material = new MeshStandardNodeMaterial();
  material.roughness = 0.82;
  material.metalness = 0;
  // u runs against the reading direction on this geometry, so x is mirrored back; scrolling then runs with the text.
  // The sampler wraps; the second term turns the strip around the tube so the big lane rides the outside.
  const scrolled = uv().mul(vec2(-repeat.x, repeat.y)).add(vec2(surfaceScroll, LANE_TURN));
  const ink = texture(surface, scrolled).rgb;
  const depth = positionWorld.z.add(5.5).div(6.5).clamp(0.25, 1);
  material.colorNode = ink.mul(1.6).add(color('#161b26')).mul(depth);
  return material;
}

/** A soft radial ground behind everything, so the knot sits in a space rather than on a flat black. */
export function groundMaterial(): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial();
  const d = uv().sub(vec2(0.5, 0.42)).length();
  material.colorNode = mix(color('#131826'), color('#07080b'), d.mul(1.9).clamp(0, 1));
  return material;
}
