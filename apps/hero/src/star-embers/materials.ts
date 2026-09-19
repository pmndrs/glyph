import { color, float, mix, mx_noise_float, screenSize, smoothstep, uniform, uv, vec2, vec3, vec4 } from 'three/tsl';
import { AdditiveBlending, DoubleSide, MeshBasicNodeMaterial, type Node } from 'three/webgpu';
import { defineTextMaterial } from '@pmndrs/glyph/three';
import { EMBER_SECONDS } from './traits';

/** Seconds since emission. Negative before it. */
export const uEmberAge = uniform(-1);
export const uEmberBloom = uniform(0.18);

/** Burning surface strength. Zero is the flat pastel control used by the WebGPU capture. */
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
  material.name = 'star-ember';
  material.positionNode = context.position;

  // UVs belong to each glyph's quad, so the fire rotates and shrinks with the star rather than sliding over it.
  const point = uv().sub(0.5).mul(2);
  const age = uEmberAge.max(0);
  const phase = context.shader.color.dot(vec3(13, 23, 37));
  const turbulence = mx_noise_float(vec3(point.mul(3.5), age.mul(3).add(phase)))
    .mul(0.5)
    .add(0.5);
  const core = float(1).sub(smoothstep(0.12, 1.05, point.length()));
  const heat = core.mul(0.7).add(turbulence.mul(0.3));
  const cooling = smoothstep(0.12, EMBER_SECONDS, age);
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
  material.opacityNode = context.shader.coverage.mul(uEmberAge.greaterThanEqual(0).select(0.8, 0));
  material.toneMapped = false;

  return material;
});

/** Fade the emitted scene after bloom and add the brief screen-space sparks. */
export function composeStarEmbers(sheet: Node<'vec3'>, lit: Node<'vec3'>, reveal: Node<'float'>, point: Node<'vec2'>) {
  const aspect = vec2(screenSize.x.div(screenSize.y), 1);
  const radius = point.mul(aspect).length();
  // After the pop the scene contains only the emitted glyphs over the opaque black sheet.
  const age = uEmberAge.max(0);
  // Dimming after bloom keeps the halo-to-core ratio intact all the way down to black.
  const emberFade = float(1)
    .sub(smoothstep(0.08, EMBER_SECONDS, age))
    .pow(1.5);
  const sceneColor = mix(sheet, lit.mul(emberFade), reveal);
  const alive = uEmberAge.greaterThanEqual(0).select(float(1).sub(smoothstep(0.03, 0.24, age)), 0);
  const expansion = float(1).sub(age.mul(-14).exp());
  const sparkPoint = point.mul(aspect);
  let sparks: Node<'vec3'> = vec3(0);

  for (let index = 0; index < 7; index += 1) {
    const angle = index * 2.39996;
    const reach = 0.025 + (index % 3) * 0.021;
    const delta = sparkPoint.sub(vec2(Math.cos(angle), Math.sin(angle)).mul(expansion.mul(reach))).abs();
    const glint = delta.x
      .mul(-850)
      .sub(delta.y.mul(180))
      .exp()
      .add(delta.x.mul(-180).sub(delta.y.mul(850)).exp());
    sparks = sparks.add(
      color(index % 2 === 0 ? '#e1c99d' : '#b7c4d9')
        .mul(glint)
        .mul(0.65),
    );
  }

  const ember = radius.mul(-95).exp().mul(age.mul(-24).exp());
  const finished = sceneColor.add(sparks.add(color('#dfccb0').mul(ember)).mul(alive));

  return vec4(finished.mul(uEmberAge.greaterThanEqual(EMBER_SECONDS).select(0, 1)), 1);
}
