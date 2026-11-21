import * as TSL from 'three/tsl';
import type { Node, Texture } from 'three/webgpu';

import {
  cellPosition,
  conditionalShadowSample,
  distanceField,
  perGlyph,
  scalar,
  trimmedCell,
} from '../shared/msdf-quad-tsl.js';
import { unpackSrgbRgba } from './packed-color.js';

/** One glyph instance's canonical MSDF fields, resolved to nodes; the technique schema owns lane meaning/packing, the target owns GPU storage. */
export interface TslMsdfInstanceNodes {
  /** Paragraph-local glyph origin, with y measured downward. */
  readonly origin: Node<'vec2'>;
  /** Glyph quad extent in paragraph-local units. */
  readonly size: Node<'vec2'>;
  /** Upper-left atlas coordinate of the glyph's distance rectangle. */
  readonly uvOrigin: Node<'vec2'>;
  /** Atlas extent of the glyph's distance rectangle. */
  readonly uvSize: Node<'vec2'>;
  /** Sampling clamp for the glyph's atlas cell as `(minimumU, minimumV, maximumU, maximumV)`. */
  readonly uvBounds: Node<'vec4'>;
  readonly fillColor: Node<'vec4'>;
  /** Packed little-endian sRGB outline and shadow colors from the technique's `effectColor` buffer. */
  readonly effectColor: Node<'uvec2'>;
  /** Shadow displacement in atlas units, subtracted from the sampled coordinate. */
  readonly shadowOffset: Node<'vec2'>;
  /** Outline half-width in signed-distance units. */
  readonly outlineWidth: Node<'float'>;
  /** Atlas layer holding this glyph, carried as a float and narrowed to an integer layer index. */
  readonly pageIndex: Node<'float'>;
}

/** The GPU resources one MSDF glyph batch binds, plus the baked constants its distance field was generated with. */
export interface TslMsdfShaderResources {
  /** Layered atlas whose RGB channels carry the multi-channel field and whose alpha carries the true distance. */
  readonly atlas: Texture;
  /** Atlas extent in texels. A node keeps the generated program independent of the font. */
  readonly atlasWidth: number | Node<'float'>;
  readonly atlasHeight: number | Node<'float'>;
  /** Distance-field range, in atlas texels, the baker generated the field with. */
  readonly pixelRange: number | Node<'float'>;
  /**
   * Shrinks each quad from its baked atlas cell to the glyph's ink box grown by what the instance can draw outside
   * it: one screen pixel of antialiasing, the outline width and the shadow displacement. Omitted, the quad covers
   * the whole cell.
   */
  readonly trim?: TslMsdfQuadTrim;
  /**
   * Which effects the instances this graph draws can have. An effect left out is neither read nor interpolated, so
   * its output is zero whatever the instance says; omitted, both are composed.
   */
  readonly effects?: TslMsdfEffects;
  /**
   * The atlas holds only the true distance, in its red channel. The fill is then reconstructed from that distance,
   * which rounds corners the multi-channel field keeps sharp, for a quarter of the atlas memory.
   */
  readonly singleChannel?: boolean;
}

/** The effects one MSDF graph composes over the fill. */
export interface TslMsdfEffects {
  readonly outline: boolean;
  readonly shadow: boolean;
}

/** What the vertex stage needs to size the antialiasing margin of a trimmed quad in screen pixels. */
export interface TslMsdfQuadTrim {
  /**
   * Maps a position in the space of the shader's `position` output to clip space. It must be affine in the
   * position; a material that displaces glyphs nonlinearly afterwards should render untrimmed.
   */
  project(position: Node<'vec3'>): Node<'vec4'>;
}

/** Unlike Bitmap, publishes no `clipPosition`: a distance field reconstructs its edge from the screen-space gradient, so it must keep the default projection rather than snap to the pixel grid. */
export interface TslMsdfShaderOutput {
  readonly position: Node<'vec3'>;
  /** Unclamped atlas coordinate the glyph cell is sampled at. */
  readonly atlasUv: Node<'vec2'>;
  /** Corner-preserving RGB-median distance in normalized atlas units; negative outside, zero on the edge. */
  readonly fillDistance: Node<'float'>;
  /** Smooth alpha-channel distance in the same units, for glows and bevels; limited by the baked field range. */
  readonly trueDistance: Node<'float'>;
  /** Screen pixels per normalized distance unit. Multiply either distance by this value for signed screen pixels. */
  readonly pixelRange: Node<'float'>;
  readonly fillCoverage: Node<'float'>;
  /** Outline ring coverage with the fill already subtracted, so the two never double-count a fragment. */
  readonly outlineCoverage: Node<'float'>;
  /** Coverage of the displaced fill; zero for an instance whose shadow color is fully transparent. */
  readonly shadowCoverage: Node<'float'>;
  /** Unpremultiplied composite of fill, outline, and shadow. */
  readonly color: Node<'vec3'>;
  readonly opacity: Node<'float'>;
}

/**
 * Builds the canonical MSDF graph the executor renders; composing over it inherits median decode, screen-space range,
 * and layer compositing. Reads `uv()` from a `[0, 1]` unit quad, origin at upper-left.
 *
 * What is constant across one glyph is resolved in the vertex stage, so a fragment decodes no packed color and reads
 * instance storage only for the fill color.
 */
export function msdfShader(instance: TslMsdfInstanceNodes, resources: TslMsdfShaderResources): TslMsdfShaderOutput {
  const effects = resources.effects ?? { outline: true, shadow: true };
  // The fill color is the one per-glyph value read in the fragment stage: a single storage load measured faster
  // than four more interpolated floats, it is exact, and it keeps the vertex stage within eight storage buffers
  // when a detached branch adds its per-glyph transform table.
  const fillColor = instance.fillColor;
  // An integer varying would force flat interpolation; the layer travels as a float and is rounded back.
  const layer = TSL.int(perGlyph(TSL.float(TSL.int(instance.pageIndex))).add(0.5));
  const atlasSize = TSL.vec2(scalar(resources.atlasWidth), scalar(resources.atlasHeight));
  const fieldRange = scalar(resources.pixelRange);
  const halfTexel = TSL.vec2(0.5).div(atlasSize);
  const minimum = perGlyph(instance.uvBounds.xy.add(halfTexel));
  const maximum = perGlyph(instance.uvBounds.zw.sub(halfTexel));

  const cell =
    resources.trim === undefined ? TSL.uv() : trimmedCell(instance, effects, atlasSize, fieldRange, resources.trim);
  const atlas = TSL.varying(instance.uvOrigin.add(cell.mul(instance.uvSize)));
  const singleChannel = resources.singleChannel === true;
  const baseSample = distanceField(
    TSL.texture(resources.atlas, TSL.clamp(atlas, minimum, maximum)).depth(layer),
    singleChannel,
  );
  const fillDistance = median3(baseSample.rgb).sub(0.5);
  const trueDistance = baseSample.a.sub(0.5);
  const pixelRange = screenPixelRange(atlas.x, atlas.y, atlasSize, fieldRange);
  // The quad never leaves its cell, so the base sample needs no inside test; only the displaced shadow does.
  const fillCoverage = distanceCoverage(fillDistance, pixelRange);
  const fillAlpha = fillColor.a.mul(fillCoverage);
  const position = cellPosition(instance, cell);
  const shared = { position, atlasUv: atlas, fillDistance, trueDistance, pixelRange, fillCoverage };
  if (!effects.outline && !effects.shadow) {
    return {
      ...shared,
      outlineCoverage: TSL.float(0),
      shadowCoverage: TSL.float(0),
      color: fillColor.rgb,
      opacity: fillAlpha,
    };
  }

  const outlineColor = effects.outline ? perGlyph(unpackSrgbRgba(instance.effectColor.x)) : TSL.vec4(0);
  const outlineOnly = effects.outline
    ? TSL.max(distanceCoverage(trueDistance.add(perGlyph(instance.outlineWidth)), pixelRange).sub(fillCoverage), 0)
    : TSL.float(0);
  const shadowColor = effects.shadow ? perGlyph(unpackSrgbRgba(instance.effectColor.y)) : TSL.vec4(0);
  const shadowCoverage = effects.shadow
    ? shadowFill(instance, resources.atlas, atlas, shadowColor.a, {
        minimum,
        maximum,
        halfTexel,
        layer,
        pixelRange,
        singleChannel,
      })
    : TSL.float(0);
  const outlineAlpha = outlineColor.a.mul(outlineOnly);
  const glyphAlpha = fillAlpha.add(outlineAlpha);
  const shadowAlpha = shadowColor.a.mul(shadowCoverage).mul(TSL.float(1).sub(glyphAlpha));
  const outputAlpha = glyphAlpha.add(shadowAlpha);
  const outputRgb = fillColor.rgb
    .mul(fillAlpha)
    .add(outlineColor.rgb.mul(outlineAlpha))
    .add(shadowColor.rgb.mul(shadowAlpha))
    .div(TSL.max(outputAlpha, 1e-6));
  return { ...shared, outlineCoverage: outlineOnly, shadowCoverage, color: outputRgb, opacity: outputAlpha };
}

/** Coverage of the fill displaced by the instance's shadow offset, limited to the glyph's own atlas cell. */
function shadowFill(
  instance: TslMsdfInstanceNodes,
  atlasTexture: Texture,
  atlas: Node<'vec2'>,
  shadowAlpha: Node<'float'>,
  cell: {
    readonly minimum: Node<'vec2'>;
    readonly maximum: Node<'vec2'>;
    readonly halfTexel: Node<'vec2'>;
    readonly layer: Node<'int'>;
    readonly pixelRange: Node<'float'>;
    readonly singleChannel: boolean;
  },
): Node<'float'> {
  const shadowUv = atlas.sub(perGlyph(instance.shadowOffset));
  const sample = conditionalShadowSample(
    shadowAlpha,
    atlasTexture,
    TSL.clamp(shadowUv, cell.minimum, cell.maximum),
    cell.layer,
    cell.singleChannel,
  );
  const low = cell.minimum.sub(cell.halfTexel);
  const high = cell.maximum.add(cell.halfTexel);
  const inside = TSL.step(low, shadowUv).mul(TSL.step(shadowUv, high));
  return distanceCoverage(sample.a.sub(0.5), cell.pixelRange).mul(inside.x).mul(inside.y);
}

function median3(value: Node<'vec3'>): Node<'float'> {
  return TSL.max(TSL.min(value.r, value.g), TSL.min(TSL.max(value.r, value.g), value.b));
}

function screenPixelRange(
  atlasU: Node<'float'>,
  atlasV: Node<'float'>,
  atlasSize: Node<'vec2'>,
  fieldRange: Node<'float'>,
): Node<'float'> {
  const screenTexelsU = TSL.inverseSqrt(TSL.max(TSL.dFdx(atlasU).pow2().add(TSL.dFdy(atlasU).pow2()), 1e-12));
  const screenTexelsV = TSL.inverseSqrt(TSL.max(TSL.dFdx(atlasV).pow2().add(TSL.dFdy(atlasV).pow2()), 1e-12));
  const unit = TSL.vec2(fieldRange).div(atlasSize);
  return TSL.max(TSL.float(0.5).mul(unit.x.mul(screenTexelsU).add(unit.y.mul(screenTexelsV))), 1);
}

function distanceCoverage(distance: Node<'float'>, pixelRange: Node<'float'>): Node<'float'> {
  return TSL.clamp(distance.mul(pixelRange).add(0.5), 0, 1);
}
