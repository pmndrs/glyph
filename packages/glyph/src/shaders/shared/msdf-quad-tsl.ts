import * as TSL from 'three/tsl';
import type { Node, Texture } from 'three/webgpu';

import type { TslMsdfEffects, TslMsdfQuadTrim } from '../tsl/msdf-shader.js';

/** The instance fields that place and trim one MSDF quad. */
export interface MsdfQuadNodes {
  readonly origin: Node<'vec2'>;
  readonly size: Node<'vec2'>;
  readonly uvSize: Node<'vec2'>;
  readonly shadowOffset: Node<'vec2'>;
  readonly outlineWidth: Node<'float'>;
}

/** Screen pixels a trimmed quad keeps around the ink for antialiasing; the coverage ramp never reaches further. */
const TRIM_ANTIALIAS_PIXELS = 1;
/**
 * Atlas texels kept besides. The median of three filtered channels is not exactly the distance to the ink box, so a
 * faint edge (under 2% coverage) can sit slightly past the antialiasing margin.
 */
const TRIM_FIELD_TEXELS = 0.5;

/**
 * Evaluates a per-instance value in the vertex stage. All vertices of a quad carry the same value, so ordinary
 * interpolation reproduces it; flat interpolation is avoided because it measured slower on tile-based GPUs.
 */
export function perGlyph<Type>(node: Node<Type>): Node<Type> {
  return TSL.varying(node);
}

export function cellPosition(instance: MsdfQuadNodes, cell: Node<'vec2'>): Node<'vec3'> {
  return TSL.vec3(
    instance.origin.x.add(cell.x.mul(instance.size.x)),
    instance.origin.y.add(cell.y.mul(instance.size.y)).negate(),
    0,
  );
}

/**
 * The unit-quad corner moved inward from the cell edge, in cell-normalized coordinates.
 *
 * The baker pads every ink box by half the distance range (rounded up) on each side. Coverage can be nonzero outside
 * the ink box only as far as the antialiasing ramp (under one screen pixel), the outline half-width, and the shadow
 * displacement on the side the shadow falls toward. Each side keeps exactly that much padding and never grows past
 * the cell, so a trimmed quad discards only fragments whose coverage was already zero. When text is minified until
 * the ramp spans the whole range, or a quad is edge-on, the margin exceeds the padding and the quad is the full cell.
 */
export function trimmedCell(
  instance: MsdfQuadNodes,
  effects: TslMsdfEffects,
  atlasSize: Node<'vec2'>,
  fieldRange: Node<'float'>,
  trim: TslMsdfQuadTrim,
): Node<'vec2'> {
  const corner = TSL.uv();
  const padding = TSL.ceil(fieldRange.mul(0.5));
  const cellTexels = TSL.max(instance.uvSize.mul(atlasSize), 1e-6);

  // The projection is affine in the cell coordinate before the perspective divide: clip(u, v) = a + u b + v c.
  const a = trim.project(cellPosition(instance, TSL.vec2(0, 0)));
  const b = trim.project(cellPosition(instance, TSL.vec2(1, 0))).sub(a);
  const c = trim.project(cellPosition(instance, TSL.vec2(0, 1))).sub(a);
  const clip = a.add(b.mul(corner.x)).add(c.mul(corner.y));
  // Screen-pixel Jacobian of the cell coordinate at this corner, scaled by w squared to avoid the divide.
  const halfViewport = TSL.viewportSize.mul(0.5);
  const alongU = b.xy.mul(clip.w).sub(clip.xy.mul(b.w)).mul(halfViewport);
  const alongV = c.xy.mul(clip.w).sub(clip.xy.mul(c.w)).mul(halfViewport);
  const area = TSL.abs(alongU.x.mul(alongV.y).sub(alongU.y.mul(alongV.x)));
  // Cell-coordinate distance that moves an edge one screen pixel along its normal.
  const pixel = TSL.vec2(TSL.length(alongV), TSL.length(alongU)).mul(clip.w.mul(clip.w)).div(TSL.max(area, 1e-30));

  const antialias = pixel.mul(cellTexels).mul(TRIM_ANTIALIAS_PIXELS).add(TRIM_FIELD_TEXELS);
  // An effect the graph does not compose draws nothing, so it claims no room.
  const outline = effects.outline ? TSL.max(instance.outlineWidth, 0).mul(fieldRange) : TSL.float(0);
  const shadow = effects.shadow ? instance.shadowOffset.mul(atlasSize) : TSL.vec2(0);
  const low = antialias.add(TSL.max(TSL.vec2(outline), shadow.negate()));
  const high = antialias.add(TSL.max(TSL.vec2(outline), shadow));
  const insetLow = TSL.clamp(TSL.vec2(padding).sub(low), 0, padding).div(cellTexels);
  const insetHigh = TSL.clamp(TSL.vec2(padding).sub(high), 0, padding).div(cellTexels);
  return insetLow.add(TSL.vec2(1).sub(insetHigh).sub(insetLow).mul(corner));
}

export function scalar(value: number | Node<'float'>): Node<'float'> {
  return typeof value === 'number' ? TSL.float(value) : value;
}

/**
 * The displaced atlas sample a shadow needs, taken only for instances that have one. Most text has no shadow and its
 * fragments skip the second sample; they read zero, which is zero coverage. The explicit level keeps the sample legal
 * inside a branch; the atlas has a single level, so it is the sample an unconditional path would take.
 */
export function conditionalShadowSample(
  shadowAlpha: Node<'float'>,
  atlas: Texture,
  coordinate: Node<'vec2'>,
  layer: Node<'int'>,
): Node<'vec4'> {
  const sample: Node<'vec4'> = TSL.Fn(() => {
    const value = TSL.vec4(0).toVar();
    TSL.If(shadowAlpha.greaterThan(0), () => {
      value.assign(TSL.texture(atlas, coordinate).depth(layer).level(TSL.float(0)));
    });
    return value;
  })();
  return sample;
}
