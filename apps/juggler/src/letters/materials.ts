import { defineTextMaterial, type ThreeTextMaterial } from '@pmndrs/glyph/three';
import type { TextStyle } from '@pmndrs/glyph';
import {
  abs,
  exp,
  float,
  fract,
  instancedBufferAttribute,
  max,
  mix,
  mx_fractal_noise_float,
  mx_noise_float,
  smoothstep,
  time,
  uv,
  vec3,
} from 'three/tsl';
import {
  AdditiveBlending,
  Color,
  DoubleSide,
  InstancedBufferAttribute,
  MeshBasicNodeMaterial,
  type Node,
} from 'three/webgpu';
import { FONT_SIZE } from '../juggler/utils';
import { DEBRIS_CAPACITY } from './traits';

/** Cooled metal: the colour a letter settles on. */
export const STEEL = '#c9d2de';
export const FLAME_CAPACITY = 256;

/**
 * Every letter shares this one material, so typing never compiles a shader. A letter's state rides in its style
 * colour: red is heat, green is how far it has taken on its own colour, blue is that colour's hue. The outline
 * carries the same values so they can be read outside the ink, where the halo is drawn.
 */
export function encodeLetterStyle(heat: number, blend: number, index: number): TextStyle {
  const encoded = [heat, blend, ((index % 7) + 0.5) / 7, 1] as const;

  return {
    color: encoded,
    fontSize: FONT_SIZE,
    lineHeight: 1,
    outline: { color: encoded, width: 0.5 },
  };
}

export const emberMaterial: ThreeTextMaterial = defineTextMaterial((context) => {
  if (context.kind !== 'glyph' || context.format !== 'pmndrs.msdf') return context.createDefaultMaterial();

  const { shader } = context;
  // The glyph quad's Y is flipped by the position node, so it draws double-sided like the default material.
  const glyph = new MeshBasicNodeMaterial({ transparent: true, depthTest: false, depthWrite: false, side: DoubleSide });
  glyph.positionNode = context.position;

  const heat = shader.color.r;
  const blend = shader.color.g;
  const tint = hue(shader.color.b);
  const cell = uv();
  const salt = shader.color.b.mul(37);
  // Slow grain that drifts upward: the embers crawling over the hot metal.
  const grain = mx_fractal_noise_float(vec3(cell.x.mul(9).add(salt), cell.y.mul(7).sub(time.mul(0.9)), salt), 3);
  const flicker = mx_noise_float(vec3(cell.x.mul(4).add(salt), cell.y.mul(4).sub(time.mul(3)), time.mul(0.7)))
    .mul(0.5)
    .add(0.5);
  // Embers glow brightest while the metal is red, not while it is white-hot or cold.
  const emberBand = heat.mul(float(1).sub(heat)).mul(4);
  const embers = smoothstep(0.45, 0.95, grain.mul(0.5).add(0.5).add(flicker.mul(0.25))).mul(emberBand);
  const fill = mix(forge(heat).add(rgb('#ff9a4a').mul(embers.mul(0.9))), tint, blend);

  // Screen pixels outside the edge, from the distance field: a halo that breathes with the flicker. The field
  // saturates at its baked range, so the halo fades out before that or it would fill the glyph cell.
  const outside = max(shader.trueDistance.negate().mul(shader.pixelRange), 0);
  const reach = smoothstep(-0.5, -0.28, shader.trueDistance);
  const glow = exp(outside.mul(-0.4)).mul(reach).mul(heat).mul(flicker.mul(0.6).add(0.4));
  const coverage = shader.fillCoverage;
  const total = coverage.add(glow.mul(float(1).sub(coverage)).mul(0.85));
  glyph.colorNode = mix(forge(heat.mul(0.75)), fill, coverage.div(max(total, 1e-4)));
  glyph.opacityNode = total;

  return glyph;
});

/** Per-instance shard state: hue, life. */
export const debrisData = new InstancedBufferAttribute(new Float32Array(DEBRIS_CAPACITY * 2), 2);

export const debrisMaterial = new MeshBasicNodeMaterial({
  transparent: true,
  depthTest: false,
  depthWrite: false,
  side: DoubleSide,
});

{
  const state = instancedBufferAttribute<'vec2'>(debrisData, 'vec2');
  // Shards flash white-hot as they burst, then show the letter's colour and fade.
  const flash = smoothstep(0.7, 1, state.y);
  debrisMaterial.colorNode = mix(hue(state.x), vec3(1, 1, 1), flash);
  debrisMaterial.opacityNode = smoothstep(0, 0.35, state.y);
}

/** Per-instance flame state: heat, fade, seed, unused. */
export const flameData = new InstancedBufferAttribute(new Float32Array(FLAME_CAPACITY * 4), 4);

export const flameMaterial = new MeshBasicNodeMaterial({
  transparent: true,
  depthTest: false,
  depthWrite: false,
  blending: AdditiveBlending,
  side: DoubleSide,
});

{
  const state = instancedBufferAttribute<'vec4'>(flameData, 'vec4');
  const heat = state.x;
  const fade = state.y;
  const salt = state.z;
  const p = uv();
  const rise = mx_fractal_noise_float(
    vec3(p.x.mul(3.2).add(salt), p.y.mul(2.4).sub(time.mul(2.4)), salt.mul(0.31).add(time.mul(0.4))),
    3,
  )
    .mul(0.5)
    .add(0.5);
  const column = float(1)
    .sub(abs(p.x.mul(2).sub(1)))
    .pow(0.8);
  const body = smoothstep(0, 0.1, p.y).mul(float(1).sub(smoothstep(0.25, 0.95, p.y)));
  const density = rise.mul(0.8).add(0.2).mul(column).mul(body);
  const tongue = smoothstep(0.16, 0.5, density);
  // Flames burn hardest right after the strike and are gone well before the red fades.
  const burn = smoothstep(0.55, 0.95, heat).mul(fade);
  flameMaterial.colorNode = forge(tongue.mul(0.85).add(0.1)).mul(tongue).mul(burn);
  flameMaterial.opacityNode = tongue.mul(burn);
}

/** Black-body colour of cooling steel: white-hot through yellow, orange, and red down to dull cherry and steel. */
function forge(heat: Node<'float'>): Node<'vec3'> {
  const cherry = mix(rgb(STEEL), rgb('#4a120a'), smoothstep(0, 0.14, heat));
  const red = mix(cherry, rgb('#e0301a'), smoothstep(0.14, 0.4, heat));
  const orange = mix(red, rgb('#ff8a1f'), smoothstep(0.4, 0.66, heat));
  const yellow = mix(orange, rgb('#ffd873'), smoothstep(0.66, 0.86, heat));

  return mix(yellow, rgb('#fff6e4'), smoothstep(0.86, 1, heat));
}

/** A saturated colour around the wheel, so each letter's tint survives any tone mapping of the encoded channel. */
function hue(h: Node<'float'>): Node<'vec3'> {
  const r = abs(fract(h).mul(6).sub(3)).sub(1);
  const g = float(2).sub(abs(fract(h).mul(6).sub(2)));
  const b = float(2).sub(abs(fract(h).mul(6).sub(4)));
  const pure = vec3(r, g, b).clamp(0, 1);

  return mix(vec3(1, 1, 1), pure, 0.85);
}

/** A constant linear-space colour as a vec3 node. */
function rgb(hex: string): Node<'vec3'> {
  const linear = new Color(hex);

  return vec3(linear.r, linear.g, linear.b);
}
