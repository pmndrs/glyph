import { defineTextMaterial } from '@pmndrs/glyph/three';
import { abs, color, cross, dFdx, dFdy, dot, float, normalize, positionView, pow, uv, vec3 } from 'three/tsl';
import { Color, DoubleSide, MeshPhysicalNodeMaterial } from 'three/webgpu';
import { holeWarp } from '../black-hole/materials';
import { lensShift, registerGlass } from '../glass/materials';
import { THEME_TINTS } from './content';

/** Separate inline materials preserve one shaped word while giving each pane its own tint and finish. */
export const stainedGlassLetters = [
  { letter: 'G', tint: THEME_TINTS[0], thickness: 2.8, roughness: 0.035, ior: 1.52 },
  { letter: 'l', tint: THEME_TINTS[1], thickness: 2.4, roughness: 0.06, ior: 1.5 },
  { letter: 'y', tint: THEME_TINTS[2], thickness: 3, roughness: 0.045, ior: 1.54 },
  { letter: 'p', tint: THEME_TINTS[3], thickness: 2.6, roughness: 0.025, ior: 1.56 },
  { letter: 'h', tint: THEME_TINTS[4], thickness: 2.9, roughness: 0.05, ior: 1.53 },
].map((pane) => ({ letter: pane.letter, material: stainedGlass(pane) }));

/**
 * Physical transmission refracts the background through a pane, and smooth lens normals curve each glyph like
 * poured glass.
 */
function stainedGlass(pane: { letter: string; tint: string; thickness: number; roughness: number; ior: number }) {
  return defineTextMaterial((context) => {
    if (context.kind !== 'glyph' || context.format !== 'pmndrs.slug') return context.createDefaultMaterial();

    const material = new MeshPhysicalNodeMaterial({
      name: `stained-glass-${pane.letter}`,
      side: DoubleSide,
      // A letter is a flat pane, not a closed solid: the renderer's back-face pass for double-sided transmission
      // buys it nothing and costs it nearly everything, so it is drawn once from whichever side faces the camera.
      forceSinglePass: true,
      color: new Color(pane.tint).lerp(new Color('#ffffff'), 0.38),
      roughness: pane.roughness,
      transmission: 1,
      thickness: pane.thickness,
      ior: pane.ior,
      dispersion: 0.7,
      attenuationColor: new Color(pane.tint),
      attenuationDistance: 4,
      clearcoat: 1,
      clearcoatRoughness: 0.03,
    });
    material.positionNode = context.position;
    // The black hole bends the letterform itself, and glass over it bends it again: coverage is integrated where
    // each fragment's ink came from. Not `shader.opacity`: that carries its own integral, and the hero's Slug paint
    // is opaque anyway. The captures read the coverage without the lens, since they draw what the lens reads.
    const plain = holeWarp(context);
    const warp = holeWarp(context, lensShift());
    material.opacityNode = warp.coverage.mul(warp.survive);
    registerGlass(material, plain.coverage.mul(plain.survive));
    material.alphaToCoverage = true;

    // Screen derivatives recover each transformed glyph's face normal, turned to the camera. Per-glyph UVs then curve
    // it outward to form a lens, falling to nothing at the quad border so neighbouring quads show no seams.
    const toCamera = normalize(positionView.negate());
    const face = normalize(cross(dFdx(positionView), dFdy(positionView)));
    const lens = uv().sub(0.5).mul(2);
    const falloff = float(1).sub(lens.length().mul(lens.length())).max(0).mul(0.45);
    const normal = normalize(
      face.mul(dot(face, toCamera).sign()).add(vec3(lens.x.mul(falloff), lens.y.negate().mul(falloff), 0)),
    );
    material.normalNode = normal;
    // A cool rim where the pane turns edge-on.
    material.emissiveNode = color('#7cc8ff').mul(pow(float(1).sub(abs(dot(normal, toCamera))), 2.5).mul(0.35));

    return material;
  });
}
