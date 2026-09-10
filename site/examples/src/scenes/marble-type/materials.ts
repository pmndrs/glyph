import { defineTextMaterial } from '@pmndrs/glyph/three';
import { color, float, mix, mx_fractal_noise_float, positionLocal, sin, smoothstep, vec3 } from 'three/tsl';
import { DoubleSide, MeshPhysicalNodeMaterial, NormalBlending } from 'three/webgpu';

/** A compact, texture-free Carrara-like stone graph evaluated in object space. */
export function marbleMaterial(): MeshPhysicalNodeMaterial {
  const material = new MeshPhysicalNodeMaterial({
    clearcoat: 0.24,
    clearcoatRoughness: 0.34,
    metalness: 0.015,
    roughness: 0.46,
  });
  const p = positionLocal.mul(vec3(0.72, 1.4, 2.2));
  const broad = mx_fractal_noise_float(p, 3, 2, 0.52, 1).mul(0.5).add(0.5);
  const folded = sin(p.x.mul(3.2).add(p.y.mul(0.55)).add(broad.mul(6.5))).abs();
  const veins = smoothstep(0.82, 0.98, folded);
  const pores = mx_fractal_noise_float(p.mul(5.5), 2, 2, 0.5, 1).mul(0.5).add(0.5);
  const warmStone = mix(color('#d9d5cb'), color('#f0ede4'), broad.mul(0.55));
  material.colorNode = mix(warmStone, color('#68717b'), veins.mul(0.72));
  material.roughnessNode = mix(float(0.36), float(0.58), pores.mul(0.5).add(veins.mul(0.5)));
  return material;
}

/** Recessed-looking ink that still participates in the scene's PBR lighting. */
export const engravedInk = defineTextMaterial((context) => {
  if (context.kind !== 'glyph' || context.format !== 'pmndrs.msdf') return context.createDefaultMaterial();
  const material = new MeshPhysicalNodeMaterial({
    blending: NormalBlending,
    depthTest: true,
    depthWrite: false,
    side: DoubleSide,
    transparent: true,
  });
  material.positionNode = context.position;
  material.colorNode = mix(color('#08090b'), color('#343940'), context.shader.fillCoverage.mul(0.16));
  material.opacityNode = context.shader.opacity;
  material.roughnessNode = float(0.92);
  material.metalnessNode = float(0);
  return material;
});
