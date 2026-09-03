import { defineTextMaterial } from '@pmndrs/glyph/three';
import { bumpMap, float, normalLocal, positionLocal, texture, uv, vec2, vec3 } from 'three/tsl';
import { MeshStandardNodeMaterial, type Texture } from 'three/webgpu';

/**
 * Text as a height field: the material writes MSDF coverage as brightness,
 * nothing else, so the tile it renders into is a mask of the word.
 */
export const heightInk = defineTextMaterial((context) => {
  const material = context.createDefaultMaterial();
  if (context.kind !== 'glyph' || context.format !== 'pmndrs.msdf') return material;
  material.colorNode = vec3(context.shader.fillCoverage);
  material.opacityNode = float(1);
  return material;
});

/**
 * The slab: a plane displaced by the tile's height and lit through a bump
 * normal derived from the same texture. The vertex stage samples a coarse
 * mip so the rise is a soft bevel; the fragment stage samples a finer one so
 * the edge keeps its shape under light.
 */
export function slabMaterial(height: Texture, depth: number): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial({ color: '#a89f90', metalness: 0.02, roughness: 0.82 });
  // A render target's rows run top-down while the plane's v runs bottom-up; flip v so the word reads upright.
  const tileUv = vec2(uv().x, uv().y.oneMinus());
  const rise = texture(height, tileUv).level(float(3)).r;
  material.positionNode = positionLocal.add(normalLocal.mul(rise.mul(depth)));
  material.normalNode = bumpMap(texture(height, tileUv).level(float(1)), float(depth * 2.4));
  return material;
}
