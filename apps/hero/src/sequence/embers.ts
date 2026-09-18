import { BURST_SECONDS } from './motion';
import { defineTextMaterial } from '@pmndrs/glyph/three';
import { color, float, mix, mx_noise_float, smoothstep, uniform, uv, vec3 } from 'three/tsl';
import { AdditiveBlending, DoubleSide, MeshBasicNodeMaterial } from 'three/webgpu';

import { uHoleBurst } from './uniforms';

/** Burning surface strength; zero is the flat pastel control used by the WebGPU capture. */
export const uEmberFire = uniform(1);

/** Analytic star silhouettes filled with a moving hot core, glowing amber tips, and cooling pastel light. */
export const emberMaterial = defineTextMaterial((context) => {
  if (context.kind !== 'glyph' || context.format !== 'pmndrs.slug') return context.createDefaultMaterial();
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
  material.name = 'hole-star-ember';
  material.positionNode = context.position;

  // UVs belong to each glyph's quad, so the fire rotates and shrinks with the star rather than sliding over it.
  const point = uv().sub(0.5).mul(2);
  const age = uHoleBurst.max(0);
  const phase = context.shader.color.dot(vec3(13, 23, 37));
  const turbulence = mx_noise_float(vec3(point.mul(3.5), age.mul(3).add(phase)))
    .mul(0.5)
    .add(0.5);
  const core = float(1).sub(smoothstep(0.12, 1.05, point.length()));
  const heat = core.mul(0.7).add(turbulence.mul(0.3));
  const cooling = smoothstep(0.12, BURST_SECONDS, age);
  const rim = mix(context.shader.color, color('#ff792e'), cooling.mul(0.7).add(0.15));
  const temperature = mix(rim, color('#fff5d6'), smoothstep(0.3, 0.82, heat));
  const flicker = age
    .mul(23)
    .add(phase)
    .sin()
    .mul(0.1)
    .add(age.mul(41).add(phase.mul(1.3)).sin().mul(0.06))
    .add(0.94);
  const radiance = core.mul(3.2).add(turbulence.mul(0.6)).add(0.8).mul(flicker);
  material.colorNode = mix(context.shader.color.mul(4), temperature.mul(radiance), uEmberFire);
  // Fade after bloom in Post: hot details and their halo cool together without losing the star's outline.
  material.opacityNode = context.shader.coverage.mul(uHoleBurst.greaterThanEqual(0).select(0.8, 0));
  material.toneMapped = false;
  return material;
});
