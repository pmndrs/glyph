import * as TSL from 'three/tsl';
import type { Node, Texture } from 'three/webgpu';

/**
 * One glyph instance's canonical MSDF fields, already resolved to nodes. Core owns what each field means; the target
 * owns their physical buffer packing.
 */
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
  readonly outlineColor: Node<'vec4'>;
  readonly shadowColor: Node<'vec4'>;
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
  readonly atlasWidth: number;
  readonly atlasHeight: number;
  /** Distance-field range, in atlas texels, the baker generated the field with. */
  readonly pixelRange: number;
}

/**
 * Everything the canonical MSDF graph produces, so a program can consume a stage or compose over its final output.
 *
 * Unlike Bitmap this output publishes no `clipPosition`: a distance field reconstructs its edge from the screen-space
 * gradient, so it is correct at any subpixel placement and must keep the default projection rather than snap to the
 * physical pixel grid.
 */
export interface TslMsdfShaderOutput {
  readonly position: Node<'vec3'>;
  /** Unclamped atlas coordinate the glyph cell is sampled at. */
  readonly atlasUv: Node<'vec2'>;
  readonly fillCoverage: Node<'float'>;
  /** Outline ring coverage with the fill already subtracted, so the two never double-count a fragment. */
  readonly outlineCoverage: Node<'float'>;
  readonly shadowCoverage: Node<'float'>;
  /** Unpremultiplied composite of fill, outline, and shadow. */
  readonly color: Node<'vec3'>;
  readonly opacity: Node<'float'>;
}

/**
 * Builds the canonical MSDF node graph. This is the exact graph the command-buffer executor renders, so a program that composes
 * over the returned nodes inherits the technique's median distance decode, screen-space range, and layer compositing.
 *
 * The graph reads `positionLocal` and `uv()` from the technique's unit quad: both must span `[0, 1]` with the origin at
 * the glyph's upper-left corner. A program supplying different geometry owns that correspondence.
 */
export function msdfShader(instance: TslMsdfInstanceNodes, resources: TslMsdfShaderResources): TslMsdfShaderOutput {
  const atlasU = instance.uvOrigin.x.add(TSL.uv().x.mul(instance.uvSize.x));
  const atlasV = instance.uvOrigin.y.add(TSL.uv().y.mul(instance.uvSize.y));
  const minimumU = instance.uvBounds.x.add(0.5 / resources.atlasWidth);
  const minimumV = instance.uvBounds.y.add(0.5 / resources.atlasHeight);
  const maximumU = instance.uvBounds.z.sub(0.5 / resources.atlasWidth);
  const maximumV = instance.uvBounds.w.sub(0.5 / resources.atlasHeight);
  const baseInside = insideRectangle(atlasU, atlasV, instance.uvBounds);
  const layer = TSL.int(instance.pageIndex);
  const baseSample = TSL.texture(
    resources.atlas,
    TSL.vec2(TSL.clamp(atlasU, minimumU, maximumU), TSL.clamp(atlasV, minimumV, maximumV)),
  ).depth(layer);
  const fillDistance = median3(baseSample.rgb).sub(0.5);
  const trueDistance = baseSample.a.sub(0.5);
  const pixelRange = screenPixelRange(atlasU, atlasV, resources);
  const fillCoverage = distanceCoverage(fillDistance, pixelRange).mul(baseInside);
  const outlineCoverage = distanceCoverage(trueDistance.add(instance.outlineWidth), pixelRange).mul(baseInside);
  const outlineOnly = TSL.max(outlineCoverage.sub(fillCoverage), 0);
  const shadowU = atlasU.sub(instance.shadowOffset.x);
  const shadowV = atlasV.sub(instance.shadowOffset.y);
  const shadowInside = insideRectangle(shadowU, shadowV, instance.uvBounds);
  const shadowSample = TSL.texture(
    resources.atlas,
    TSL.vec2(TSL.clamp(shadowU, minimumU, maximumU), TSL.clamp(shadowV, minimumV, maximumV)),
  ).depth(layer);
  const shadowCoverage = distanceCoverage(shadowSample.a.sub(0.5), pixelRange).mul(shadowInside);
  const fillAlpha = instance.fillColor.a.mul(fillCoverage);
  const outlineAlpha = instance.outlineColor.a.mul(outlineOnly);
  const glyphAlpha = fillAlpha.add(outlineAlpha);
  const shadowAlpha = instance.shadowColor.a.mul(shadowCoverage).mul(TSL.float(1).sub(glyphAlpha));
  const outputAlpha = glyphAlpha.add(shadowAlpha);
  const outputRgb = instance.fillColor.rgb
    .mul(fillAlpha)
    .add(instance.outlineColor.rgb.mul(outlineAlpha))
    .add(instance.shadowColor.rgb.mul(shadowAlpha))
    .div(TSL.max(outputAlpha, 1e-6));

  return {
    position: TSL.vec3(
      instance.origin.x.add(TSL.positionLocal.x.mul(instance.size.x)),
      instance.origin.y.add(TSL.positionLocal.y.mul(instance.size.y)).negate(),
      0,
    ),
    atlasUv: TSL.vec2(atlasU, atlasV),
    fillCoverage,
    outlineCoverage: outlineOnly,
    shadowCoverage,
    color: outputRgb,
    opacity: outputAlpha,
  };
}

function median3(value: Node<'vec3'>): Node<'float'> {
  return TSL.max(TSL.min(value.r, value.g), TSL.min(TSL.max(value.r, value.g), value.b));
}

function screenPixelRange(
  atlasU: Node<'float'>,
  atlasV: Node<'float'>,
  resources: TslMsdfShaderResources,
): Node<'float'> {
  const screenTexelsU = TSL.inverseSqrt(TSL.max(TSL.dFdx(atlasU).pow2().add(TSL.dFdy(atlasU).pow2()), 1e-12));
  const screenTexelsV = TSL.inverseSqrt(TSL.max(TSL.dFdx(atlasV).pow2().add(TSL.dFdy(atlasV).pow2()), 1e-12));
  return TSL.max(
    TSL.float(0.5).mul(
      TSL.float(resources.pixelRange / resources.atlasWidth)
        .mul(screenTexelsU)
        .add(TSL.float(resources.pixelRange / resources.atlasHeight).mul(screenTexelsV)),
    ),
    1,
  );
}

function distanceCoverage(distance: Node<'float'>, pixelRange: Node<'float'>): Node<'float'> {
  return TSL.clamp(distance.mul(pixelRange).add(0.5), 0, 1);
}

function insideRectangle(u: Node<'float'>, v: Node<'float'>, bounds: Node<'vec4'>): Node<'float'> {
  return TSL.step(bounds.x, u).mul(TSL.step(u, bounds.z)).mul(TSL.step(bounds.y, v)).mul(TSL.step(v, bounds.w));
}
