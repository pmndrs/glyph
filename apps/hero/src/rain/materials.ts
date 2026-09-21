import { defineTextMaterial } from '@pmndrs/glyph/three';
import { color, cross, dFdx, dFdy, dot, float, mix, normalize, output, positionView, uv, vec3, vec4 } from 'three/tsl';
import { Color, DoubleSide, MeshStandardNodeMaterial, MultiplyBlending } from 'three/webgpu';
import { THEME_TINTS } from '../letters/content';

/**
 * A pane of tinted glass that composes as stained glass does: it multiplies whatever is beneath it, so two panes
 * overlapping go dark where they cross, and a pane over paper tints the paper. The title's true refraction cannot
 * see other glass, since the renderer's transmission pass holds only the opaque scene, so the rain composes this way
 * instead. Lit by the environment, its highlights brighten what shows through, like gloss on the pane.
 */
function createPane(name: string, tint: string) {
  return defineTextMaterial((context) => {
    if (context.kind !== 'glyph' || context.format !== 'pmndrs.slug') return context.createDefaultMaterial();

    const material = new MeshStandardNodeMaterial({
      side: DoubleSide,
      transparent: true,
      depthWrite: false,
      blending: MultiplyBlending,
      // WebGPU multiplies only premultiplied output: with alpha one, the blend is exactly what is beneath times the pane.
      premultipliedAlpha: true,
      roughness: 0.06,
      metalness: 0,
      color: new Color(tint).lerp(new Color('#ffffff'), 0.1),
    });
    material.name = name;
    material.positionNode = context.position;
    // The quad's facing from screen derivatives, bulged into a lens by the glyph's own UVs, for highlights.
    const face = normalize(cross(dFdx(positionView), dFdy(positionView)));
    const facing = face.mul(dot(face, normalize(positionView.negate())).sign());
    const lens = uv().sub(0.5).mul(2);
    const falloff = float(1).sub(lens.length().mul(lens.length())).max(0).mul(0.45);
    material.normalNode = normalize(facing.add(vec3(lens.x.mul(falloff), lens.y.negate().mul(falloff), 0)));
    // Outside the ink the pane is clear: multiplying by one leaves the paper as it was.
    material.outputNode = vec4(mix(vec3(1), output.rgb, context.shader.coverage), 1);
    material.emissiveNode = color(tint).mul(0.05);

    return material;
  });
}

/** One pane a theme tint, shared by every glyph of that tint. */
export const rainGlass = THEME_TINTS.map((tint, index) => createPane(`rain-pane-${index}`, tint));
