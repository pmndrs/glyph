import { defineTextMaterial } from '@pmndrs/glyph/three';
import {
  abs,
  atan,
  color,
  exp,
  float,
  fract,
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
} from 'three/tsl';
import { AdditiveBlending, DoubleSide, MeshBasicNodeMaterial, type Node } from 'three/webgpu';
import { retained } from '../utils';
import { BUTTON_HEIGHT, BUTTON_RADIUS, BUTTON_WIDTH, FRAME_MARGIN, PIXEL } from './content';

/** Kept across a hot module replacement, since the mounted view writes these and the post pass reads them. */
export const { uPlayHover, uPlayReveal, uPlayTime } = retained('play-button', () => ({
  /** 0..1: how far the button has drawn in. */
  uPlayReveal: uniform(0),
  /** 0..1: the pointer resting on the button, smoothed. */
  uPlayHover: uniform(0),
  /** Playback seconds, for the light that sweeps the label. */
  uPlayTime: uniform(0),
}));

/** The reveal in twenty notches, so the button draws itself a step at a time. */
const reveal = uPlayReveal.mul(20).floor().div(20);

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

/** Snap a sheet point to the centre of its pixel. */
function snap(point: Node<'vec2'>): Node<'vec2'> {
  return point.div(PIXEL).floor().add(0.5).mul(PIXEL);
}

/** Hold a 0..1 value to a few levels, so light steps instead of fading. */
function posterize(value: Node<'float'>, levels: number): Node<'float'> {
  return value.mul(levels).floor().div(levels);
}

/**
 * The label quantized to the button's pixels: each block of two by two of the font's squares is ink when at least
 * half of it is, leaving the hair of a gap the font leaves between squares. The blocks materialize in a fixed
 * random order as the frame closes, then glow under the sweep and brighten under the pointer.
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
  // The font's squares start 4 thousandths of an em in and repeat every 38; a pixel is two of them each way.
  const block = 0.076;
  const local = context.shader.renderCoordinate.sub(0.004).div(block);
  const centre = local.floor().add(0.5).mul(block).add(0.004);
  // Each pixel takes the ink of its lower-left square, so a two-square stroke is one pixel wide at either phase.
  const ink = context.shader.coverageAt(centre.sub(block / 4));
  const within = fract(local);
  const gap = step(0.08, within.x).mul(step(within.x, 0.92)).mul(step(0.08, within.y)).mul(step(within.y, 0.92));
  const cell = positionWorld.xy.div(PIXEL * 2).floor();
  const order = hash(cell.x.add(cell.y.mul(131)));
  // The frame draws first; the blocks fill in as it closes.
  const shown = step(order, smoothstep(0.3, 1, reveal));
  const glow = float(1.1)
    .add(sweep(snap(positionWorld.xy).x).mul(0.9))
    .add(uPlayHover.mul(1));
  material.colorNode = tint(positionWorld.x).mul(glow);
  material.opacityNode = step(0.5, ink).mul(gap).mul(shown);
  material.toneMapped = false;

  return material;
});

/**
 * A rounded frame drawn as a signed distance on the button's pixel grid: a one-pixel outline that draws itself from
 * the top, round both sides, as the reveal grows, with a halo held to a few levels. Under the pointer it blooms
 * softly either side of the stroke.
 */
export function createFrameMaterial(): MeshBasicNodeMaterial {
  const material = new MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: AdditiveBlending,
  });
  material.name = 'play-frame';
  const plane = uv()
    .sub(0.5)
    .mul(vec2(BUTTON_WIDTH + 2 * FRAME_MARGIN, BUTTON_HEIGHT + 2 * FRAME_MARGIN));
  const roundedDistance = (at: Node<'vec2'>): Node<'float'> => {
    const corner = abs(at).sub(vec2(BUTTON_WIDTH / 2 - BUTTON_RADIUS, BUTTON_HEIGHT / 2 - BUTTON_RADIUS));

    return length(max(corner, 0))
      .add(min(max(corner.x, corner.y), 0))
      .sub(BUTTON_RADIUS);
  };
  const point = snap(plane);
  const distance = roundedDistance(point);
  const stroke = step(abs(distance), PIXEL / 2);
  // A soft glow inside the frame, and a tight one outside that is gone before the plane's edge.
  const halo = posterize(
    exp(distance.mul(28))
      .mul(0.28)
      .mul(step(distance, 0))
      .add(exp(distance.mul(-70)).mul(step(0, distance)).mul(0.22)),
    8,
  );
  // Under the pointer the frame blooms: a soft light falling off either side of the stroke, off the unsnapped
  // distance so it is the one light on the button that is not on its pixel grid.
  const smooth = roundedDistance(plane);
  const glow = exp(abs(smooth).mul(-28))
    .mul(smoothstep(FRAME_MARGIN, FRAME_MARGIN / 2, smooth))
    .mul(uPlayHover)
    .mul(0.175);
  // Angle from straight up, either way round, as a share of the way to the bottom.
  const around = abs(atan(point.x, point.y)).div(Math.PI);
  const drawn = step(around, smoothstep(0, 0.75, reveal).mul(1.02));
  const drawnFrame = stroke.add(halo).add(sweep(point.x).mul(stroke).mul(0.6));
  // The glow is tinted from where it truly is; the frame from its pixel.
  material.colorNode = tint(point.x)
    .mul(drawnFrame)
    .add(tint(plane.x).mul(glow))
    .mul(float(1).add(uPlayHover.mul(0.5)))
    .mul(drawn);
  material.opacityNode = float(1);
  material.toneMapped = false;

  return material;
}
