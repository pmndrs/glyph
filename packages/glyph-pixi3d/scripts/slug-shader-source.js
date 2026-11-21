import tgpu, { d } from 'typegpu';

import {
  SlugShaderGlyph,
  slugBandCurveTexelSlot,
  slugBandCurveWidthAccessor,
  slugDilateMatrix,
  slugHeaderTexelSlot,
  slugHeaderWidthAccessor,
  slugRenderWithOptions,
} from '@pmndrs/glyph/shaders/typegpu';
import { SLUG_RESIDENT_BAND_CURVE_WIDTH } from '@pmndrs/glyph/core';

/** Replaced in the resolved source by the per-page header width constant the bit declares. */
export const slugHeaderWidthMarker = 4_293_918_709;

// Pixi3D material textures are float-sampled, so the bit supplies the u32 words from byte-exact rgba8unorm texels.
const headerTexel = tgpu['~unstable'].rawCodeSnippet('glyphSlugLoadHeader(_coords)', d.vec4u, 'runtime', false);
const bandCurveTexel = tgpu['~unstable'].rawCodeSnippet('glyphSlugLoadBandCurve(_coords)', d.vec4u, 'runtime', false);

function loadHeader(_coords) {
  'use gpu';
  return d.vec4u(headerTexel.$);
}

function loadBandCurve(_coords) {
  'use gpu';
  return d.vec4u(bandCurveTexel.$);
}

const specializedSlugRender = tgpu
  .fn(slugRenderWithOptions)
  .with(slugHeaderWidthAccessor, d.u32(slugHeaderWidthMarker))
  .with(slugBandCurveWidthAccessor, d.u32(SLUG_RESIDENT_BAND_CURVE_WIDTH))
  .with(slugHeaderTexelSlot, loadHeader)
  .with(slugBandCurveTexelSlot, loadBandCurve);

/** Nonzero-winding coverage of one Slug glyph from its table row: starts, band counts, band transform. */
function renderSlug(starts, counts, bandTransform, renderCoordinate) {
  'use gpu';
  const glyph = SlugShaderGlyph({
    curveBaseTexel: starts.x,
    horizontalHeaderBase: starts.y,
    verticalHeaderBase: starts.z,
    referenceBase: starts.w,
    horizontalBandCount: counts.x,
    verticalBandCount: counts.y,
    bandTransform,
  });
  return specializedSlugRender(glyph, renderCoordinate, false, false, d.f32(0), d.f32(0));
}

const glyphSlugRender = tgpu.fn([d.vec4u, d.vec2u, d.vec4f, d.vec2f], d.f32)(renderSlug).$name('glyphSlugRender');

const glyphSlugDilate = tgpu
  .fn(
    [d.vec2f, d.vec2f, d.vec2f, d.f32, d.mat4x4f, d.vec2f],
    d.vec4f,
  )(slugDilateMatrix)
  .$name('glyphSlugDilate');

export const slugFunctions = [glyphSlugRender, glyphSlugDilate];
