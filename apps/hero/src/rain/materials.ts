import { defineTextMaterial } from '@pmndrs/glyph/three';
import { color, cross, dFdx, dFdy, dot, float, mix, normalize, output, positionView, uv, vec3, vec4 } from 'three/tsl';
import { Color, DoubleSide, MeshPhysicalNodeMaterial, MultiplyBlending } from 'three/webgpu';
import { holeWarp } from '../black-hole/materials';
import { lensShift, registerGlass } from '../glass/materials';
import { THEME_TINTS } from '../letters/content';

/**
 * A pane of tinted glass that composes as stained glass does: it multiplies whatever is beneath it, so two panes
 * overlapping go dark where they cross, and a pane over paper tints the paper. The title's true refraction cannot
 * see other glass, since the renderer's transmission pass holds only the opaque scene, so the rain composes this way
 * instead. Lit by the environment, its highlights brighten what shows through, like gloss on the pane. It carries
 * the title glass's attenuation, thickness, and index, and its name, so the glass projection captures it like a
 * letter and casts its shadow and caustic. Like the title and the icon field, its ink is bent round the black
 * hole, so a pane near the hole shows a warped letter rather than a warped quad with a straight one inside.
 */
function createPane(name: string, tint: string) {
  return defineTextMaterial((context) => {
    if (context.kind !== 'glyph' || context.format !== 'pmndrs.slug') return context.createDefaultMaterial();

    const material = new MeshPhysicalNodeMaterial({
      side: DoubleSide,
      transparent: true,
      depthWrite: false,
      blending: MultiplyBlending,
      // WebGPU multiplies only premultiplied output: with alpha one, the blend is exactly what is beneath times the pane.
      premultipliedAlpha: true,
      roughness: 0.06,
      metalness: 0,
      color: new Color(tint).lerp(new Color('#ffffff'), 0.1),
      attenuationColor: new Color(tint),
      attenuationDistance: 4,
      thickness: 2.6,
      ior: 1.54,
      dispersion: 0.7,
    });
    material.name = name;
    material.positionNode = context.position;
    // The quad's facing from screen derivatives, bulged into a lens by the glyph's own UVs, for highlights.
    const face = normalize(cross(dFdx(positionView), dFdy(positionView)));
    const facing = face.mul(dot(face, normalize(positionView.negate())).sign());
    const lens = uv().sub(0.5).mul(2);
    const falloff = float(1).sub(lens.length().mul(lens.length())).max(0).mul(0.45);
    material.normalNode = normalize(facing.add(vec3(lens.x.mul(falloff), lens.y.negate().mul(falloff), 0)));
    // Outside the ink the pane is clear: multiplying by one leaves the paper as it was. The captures read the
    // coverage without the lens, since they draw what the lens reads.
    const plain = holeWarp(context);
    const warp = holeWarp(context, lensShift());
    material.outputNode = vec4(mix(vec3(1), output.rgb, warp.coverage.mul(warp.survive)), 1);
    registerGlass(material, plain.coverage.mul(plain.survive));
    material.emissiveNode = color(tint).mul(0.05);

    return material;
  });
}

/** One pane a theme tint, shared by every glyph of that tint. */
export const rainGlass = THEME_TINTS.map((tint, index) => createPane(`stained-glass-rain-${index}`, tint));
