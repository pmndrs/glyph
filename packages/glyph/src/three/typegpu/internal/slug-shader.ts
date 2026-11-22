import * as TSL from 'three/tsl';
import type { Node } from 'three/webgpu';
import * as t3 from '@typegpu/three';
import tgpu, { d, std } from 'typegpu';

import {
  SlugShaderGlyph,
  slugRenderWithOptions,
  type SlugShaderPage,
} from '../../../shaders/typegpu/slug/slug-render.js';
import {
  slugBandCurveTexelSlot,
  slugBandCurveWidthAccessor,
  slugHeaderTexelSlot,
  slugHeaderWidthAccessor,
} from '../../../shaders/typegpu/slug/slug-texture.js';
import type {
  TslSlugFillRule,
  TslSlugInstanceNodes,
  TslSlugPageResources,
  TslSlugShaderOutput,
  TslSlugShaderResources,
} from '../../../shaders/tsl/slug/shader.js';
import { slugVertexPosition } from '../../../shaders/shared/slug-vertex-tsl.js';
import { slugDilate, slugDilateMatrix } from './slug/slug-dilate.js';

/**
 * Builds the canonical Slug node graph. This is the exact graph the command-buffer executor renders, so a program that composes
 * over the returned nodes inherits the technique's band walk, quadratic solve, and antialiasing footprint.
 *
 * `position` and `coverage` are two halves of one graph: the vertex half writes the varying the fragment half
 * integrates over. A program that uses `coverage` must also drive its material position from `position`.
 *
 * The graph reads `positionLocal` from the technique's unit quad, which must span `[0, 1]` with the origin at the
 * glyph's upper-left corner. A program supplying different geometry owns that correspondence.
 */
export function slugShader(instance: TslSlugInstanceNodes, resources: TslSlugShaderResources): TslSlugShaderOutput {
  const renderCoordinate = TSL.varyingProperty('vec2', 'pmndrsSlugRenderCoordinate');
  const position = TSL.Fn(() =>
    slugVertexPosition(instance, resources, renderCoordinate, { slugDilate, slugDilateMatrix }),
  )();
  const page = shaderPage(resources.page);
  const specializedSlugRender = tgpu
    .fn(slugRenderWithOptions)
    .with(slugHeaderWidthAccessor, d.u32(page.headerWidth))
    .with(slugBandCurveWidthAccessor, d.u32(page.bandCurveWidth))
    .with(slugHeaderTexelSlot, page.loadHeader)
    .with(slugBandCurveTexelSlot, page.loadBandCurve);
  const rule = renderOptions(resources.fillRule);
  const coverageAt = (coordinate: Node<'vec2'>): Node<'float'> =>
    t3.toTSL(() => {
      'use gpu';
      return specializedSlugRender(
        SlugShaderGlyph({
          curveBaseTexel: t3.fromTSL(instance.curveBaseTexel, d.u32).$,
          horizontalHeaderBase: t3.fromTSL(instance.horizontalHeaderBase, d.u32).$,
          verticalHeaderBase: t3.fromTSL(instance.verticalHeaderBase, d.u32).$,
          referenceBase: t3.fromTSL(instance.referenceBase, d.u32).$,
          horizontalBandCount: t3.fromTSL(instance.horizontalBandCount, d.u32).$,
          verticalBandCount: t3.fromTSL(instance.verticalBandCount, d.u32).$,
          bandTransform: t3.fromTSL(instance.bandTransform, d.vec4f).$,
        }),
        t3.fromTSL(coordinate, d.vec2f).$,
        t3.fromTSL(rule.evenOdd, d.bool).$,
        t3.fromTSL(rule.weightBoost, d.bool).$,
        t3.fromTSL(rule.stemDarken, d.f32).$,
        t3.fromTSL(rule.thicken, d.f32).$,
      );
    }) as Node<'float'>;
  const coverage = coverageAt(renderCoordinate);

  return {
    position,
    renderCoordinate,
    coverage,
    coverageAt,
    color: instance.color.rgb,
    opacity: instance.color.a.mul(coverage),
  };
}

function renderOptions(rule: TslSlugFillRule | undefined): Required<TslSlugFillRule> {
  return {
    evenOdd: rule?.evenOdd ?? TSL.bool(false),
    weightBoost: rule?.weightBoost ?? TSL.bool(false),
    stemDarken: rule?.stemDarken ?? TSL.float(0),
    thicken: rule?.thicken ?? TSL.float(0),
  };
}

function shaderPage(resources: TslSlugPageResources): SlugShaderPage {
  const headerTexture = t3.fromTSL(resources.headerTexture, d.texture2d(d.u32));
  const bandCurveTexture = t3.fromTSL(resources.bandCurveTexture, d.texture2d(d.u32));
  return {
    headerWidth: resources.headerWidth,
    bandCurveWidth: resources.bandCurveWidth,
    loadHeader: (coords: d.v2i) => {
      'use gpu';
      return std.textureLoad(headerTexture.$, coords, 0);
    },
    loadBandCurve: (coords: d.v2i) => {
      'use gpu';
      return std.textureLoad(bandCurveTexture.$, coords, 0);
    },
  };
}
