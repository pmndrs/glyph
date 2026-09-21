import { defineTextMaterial } from '@pmndrs/glyph/three';
import {
  abs,
  atan,
  color,
  exp,
  float,
  fract,
  fwidth,
  hash,
  length,
  max,
  min,
  mix,
  positionWorld,
  smoothstep,
  step,
  uniform,
  uv,
  vec2,
  vec4,
} from 'three/tsl';
import { AdditiveBlending, DoubleSide, MeshBasicNodeMaterial, type Node } from 'three/webgpu';
import { BUTTON_HEIGHT, BUTTON_RADIUS, BUTTON_WIDTH, FRAME_MARGIN, LABEL_SIZE } from './content';

/** 0..1: how far the button has drawn in. */
export const uPlayReveal = uniform(0);
/** 0..1: the pointer resting on the button, smoothed. */
export const uPlayHover = uniform(0);
/** Playback seconds, for the light that sweeps the label. */
export const uPlayTime = uniform(0);

/** Ember pastels: warm at the left, rose at the right, across the sheet. */
function tint(x: Node<'float'>): Node<'vec3'> {
  return mix(color('#fff0ac'), color('#ffd0dc'), smoothstep(-BUTTON_WIDTH / 2, BUTTON_WIDTH / 2, x));
}

/** A light that crosses the button every few seconds. */
function sweep(x: Node<'float'>): Node<'float'> {
  const at = fract(uPlayTime.mul(0.28))
    .mul(BUTTON_WIDTH * 1.8)
    .sub(BUTTON_WIDTH * 0.9);

  return exp(x.sub(at).pow(2).mul(-60));
}

/**
 * The label materializes cell by cell on the pixel font's own grid, in a fixed random order, then glows under
 * the sweep and brightens under the pointer. The cells are laid on the sheet so they line up across glyphs.
 */
export const labelMaterial = defineTextMaterial((context) => {
  if (context.kind !== 'glyph' || context.format !== 'pmndrs.slug') return context.createDefaultMaterial();

  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
  material.name = 'play-label';
  material.positionNode = context.position;
  const cell = positionWorld.xy.div(LABEL_SIZE / 7).floor();
  const order = hash(cell.x.add(cell.y.mul(131)));
  // The frame draws first; the letters fill in as it closes.
  const shown = step(order, smoothstep(0.3, 1, uPlayReveal));
  const glow = float(1.1).add(sweep(positionWorld.x).mul(0.9)).add(uPlayHover.mul(0.6));
  material.colorNode = tint(positionWorld.x).mul(glow);
  material.opacityNode = context.shader.coverage.mul(shown);
  material.toneMapped = false;

  return material;
});

/**
 * A rounded frame drawn as a signed distance on its plane. It draws itself from the top, round both sides, as the
 * reveal grows, carries a soft halo, and fills faintly under the pointer.
 */
export function createFrameMaterial(): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: AdditiveBlending,
  });
  material.name = 'play-frame';
  const point = uv()
    .sub(0.5)
    .mul(vec2(BUTTON_WIDTH + 2 * FRAME_MARGIN, BUTTON_HEIGHT + 2 * FRAME_MARGIN));
  const corner = abs(point).sub(vec2(BUTTON_WIDTH / 2 - BUTTON_RADIUS, BUTTON_HEIGHT / 2 - BUTTON_RADIUS));
  const distance = length(max(corner, 0))
    .add(min(max(corner.x, corner.y), 0))
    .sub(BUTTON_RADIUS);
  const width = fwidth(distance);
  const stroke = smoothstep(float(0.0045).add(width), float(0.0045).sub(width), abs(distance));
  // A soft glow inside the frame, and a tight one outside that is gone before the plane's edge.
  const halo = exp(distance.mul(28))
    .mul(0.28)
    .mul(step(distance, 0))
    .add(exp(distance.mul(-70)).mul(step(0, distance)).mul(0.22));
  const fill = smoothstep(0, -0.12, distance).mul(uPlayHover).mul(0.16);
  // Angle from straight up, either way round, as a share of the way to the bottom.
  const around = abs(atan(point.x, point.y)).div(Math.PI);
  const drawn = step(around, smoothstep(0, 0.75, uPlayReveal).mul(1.02));
  material.colorNode = tint(point.x).mul(float(1).add(uPlayHover.mul(0.5)));
  material.opacityNode = stroke.add(halo).add(fill).add(sweep(point.x).mul(stroke).mul(0.6)).mul(drawn);
  material.toneMapped = false;

  return material;
}

/** Lay the button's sheet over the finished frame. Its sheet is black where the button is not drawn. */
export function composePlayButton(finished: Node<'vec4'>, sheet: Node<'vec4'>): Node<'vec4'> {
  return vec4(finished.rgb.add(sheet.rgb), 1);
}
