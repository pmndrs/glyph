import { defineTextMaterial } from '@pmndrs/glyph/three';
import {
  cameraProjectionMatrix,
  cameraViewMatrix,
  color,
  cross,
  dFdx,
  dFdy,
  dot,
  float,
  mix,
  modelWorldMatrix,
  normalize,
  output,
  positionView,
  smoothstep,
  uv,
  varying,
  vec3,
  vec4,
} from 'three/tsl';
import {
  Color,
  DoubleSide,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  MultiplyBlending,
  NormalBlending,
} from 'three/webgpu';
import { SHADOW_LAMP, SHADOW_RECEIVER_Z, THEME_TINTS } from '../letters/content';

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

/**
 * A glyph's shadow and caustic in one draw, cheap enough for every drop: the pane's own quad is drawn again,
 * projected in the vertex stage from the title's lamp onto its receiving plane, so the shadow lies under the glyph
 * and spreads as it climbs, with no capture, march, or blur. Composed with a premultiplied blend over what is
 * already drawn, it takes paper away for the tinted shadow and adds light for the caustic, a pool gathered toward
 * the glyph's centre as a lens would; both are fainter the higher the glass.
 */
function createShade(name: string, tint: string) {
  return defineTextMaterial((context) => {
    if (context.kind !== 'glyph' || context.format !== 'pmndrs.slug') return context.createDefaultMaterial();

    const material = new MeshBasicNodeMaterial({
      side: DoubleSide,
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      premultipliedAlpha: true,
    });
    material.name = name;
    material.toneMapped = false;
    material.positionNode = context.position;
    const world = modelWorldMatrix.mul(vec4(context.position, 1)).xyz;
    const lamp = vec3(SHADOW_LAMP[0], SHADOW_LAMP[1], SHADOW_LAMP[2]);
    // Where the ray from the lamp through this vertex meets the receiver.
    const landing = mix(lamp, world, float(SHADOW_RECEIVER_Z - SHADOW_LAMP[2]).div(world.z.sub(SHADOW_LAMP[2])));
    material.vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(landing, 1));
    const height = varying(world.z.sub(SHADOW_RECEIVER_Z).max(0));
    const cover = context.shader.coverage.div(height.mul(0.18).add(1));
    const pool = smoothstep(1, 0.15, uv().sub(0.5).mul(2).length()).mul(cover);
    const shade = cover.mul(0.55);
    const glass = color(tint);
    material.fragmentNode = vec4(
      glass
        .mul(0.7)
        .mul(shade)
        .add(mix(glass, vec3(1), 0.25).mul(pool).mul(0.5)),
      shade,
    );

    return material;
  });
}

/** One shadow a theme tint, cast by every glyph of that tint. */
export const rainShade = THEME_TINTS.map((tint, index) => createShade(`rain-shade-${index}`, tint));
