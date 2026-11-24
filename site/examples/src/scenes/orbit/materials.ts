import { defineTextMaterial } from '@pmndrs/glyph/three';
import { color, floor, mix, mx_fractal_noise_float, positionLocal, positionWorld, sin, vec3 } from 'three/tsl';
import { MeshStandardNodeMaterial, type Node } from 'three/webgpu';

/**
 * Ink on a path: depth-tested, so the sphere hides what passes behind it,
 * and dimmed with distance from the camera plane. `depthWrite` stays off —
 * a glyph quad is transparent outside its ink. The shadow pass runs the
 * same vertex placement (the material's default `positionNode`, left
 * untouched) but knows nothing about the glyph's ink, so a quad would cast
 * its rectangle; three's `maskShadowNode` discards shadow fragments where
 * the mask is false, and Slug's coverage is analytic per pixel, so the
 * shadow is the glyph's outline, crisp at any size.
 */
export const ringInk = defineTextMaterial((context) => {
  const material = context.createDefaultMaterial();
  if (context.kind !== 'glyph') return material;
  material.depthTest = true;
  const shader = context.shader;
  if ('coverage' in shader) material.maskShadowNode = shader.coverage.greaterThan(0.5);
  else if ('fillCoverage' in shader) material.maskShadowNode = shader.fillCoverage.greaterThan(0.5);
  const near = positionWorld.z.add(3).div(6).clamp(0.45, 1);
  material.colorNode = shader.color.mul(near);
  material.opacityNode = shader.opacity;
  return material;
});

/** How many flat steps the banding is quantised to. */
const BANDS = 16;

/**
 * The body's markings, as a value in 0..1, from a point in body-local space.
 *
 * Belts, the way a gas giant has them. The band structure is fractal noise sampled along
 * latitude *alone* — a line through the noise field rather than a volume of it — so every point
 * at the same height reads the same value and the pattern comes out as horizontal belts of
 * uneven width, rather than the blotches a 3D sample would give.
 *
 * What keeps those belts from being dead-straight rings is the latitude they are read at being
 * bent first: two sine waves running around the body, plus a slow noise, all small. The belts
 * stay belts and simply undulate, the way the real banding does where it shears.
 *
 * The result is quantised to `BANDS` flat steps, so the gradient terraces instead of blending.
 *
 * Sampled on the local position rather than a uv, so there is no chart to seam: the field is
 * continuous through the sphere, and the poles are no different from anywhere else on it.
 *
 * A plain function, not an `Fn`: it is called while the graph is being built, so it just inlines
 * its nodes where it was asked for.
 */
function markings(at: Node<'vec3'>): Node<'float'> {
  const undulation = sin(at.x.mul(3.1))
    .mul(0.08)
    .add(sin(at.z.mul(2.3).add(1.7)).mul(0.07))
    .add(mx_fractal_noise_float(at.mul(0.9), 3, 2, 0.5, 1).mul(0.1));
  const latitude = at.y.add(undulation);
  const belts = mx_fractal_noise_float(vec3(0, latitude.mul(3.4), 0), 4, 2, 0.6, 1);
  return floor(belts.mul(0.5).add(0.5).mul(BANDS)).div(BANDS);
}

/**
 * A matte body that takes the shadows: banded greyscale markings, and nothing else. The surface
 * is left geometrically smooth on purpose — a bump or perturbed normal puts noise in exactly the
 * shading the letter shadows have to read against, and the crisp Slug outlines get lost in it.
 * The pattern lives in the albedo alone, so the light still falls across a clean sphere.
 */
export function sphereMaterial(): MeshStandardNodeMaterial {
  const material = new MeshStandardNodeMaterial();
  material.roughness = 0.92;
  material.metalness = 0;
  // A real spread of greys, not a tint either side of one: the belts have to read as markings
  // through the shading. The light end stops well short of white — the key is bright enough that
  // a near-white albedo clips the lit face flat and takes the belts with it.
  material.colorNode = mix(color('#59626f'), color('#c6cedb'), markings(positionLocal));
  return material;
}
