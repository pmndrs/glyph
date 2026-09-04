/**
 * Renderer-neutral TypeGPU entry point for the analytic Slug fill.
 *
 * This module only wires TSL nodes into the host-agnostic core: the fragment scale,
 * the thickening factor, and the final weighted blend are all portable core calls.
 */
import { d } from 'typegpu';
import { slugPixelsPerEm, slugThickenFactor } from './core/band.js';
import { calcCoverage } from './core/coverage.js';
import { evaluateBand, type SlugShaderGlyph } from './slug-band.js';

export { MAX_SAFE_SLUG_BAND_CURVES } from './core/band.js';
export type { SlugShaderPage } from './slug-texture.js';
export { SlugShaderGlyph } from './slug-band.js';

/**
 * Evaluate analytic Slug fill coverage for one fragment.
 * @note Uses the resource slots and accessors exported by `slug-texture`.
 */
export function slugRender(glyph: SlugShaderGlyph, renderCoordinate: d.v2f): /* f32 */ number {
  'use gpu';
  return slugRenderWithOptions(glyph, renderCoordinate, false, false, d.f32(0), d.f32(0));
}

/** Evaluate analytic Slug fill coverage with renderer-supplied fill controls. */
export function slugRenderWithOptions(
  glyph: SlugShaderGlyph,
  renderCoordinate: d.v2f,
  evenOdd: boolean,
  weightBoost: boolean,
  stemDarken: /* f32 */ number,
  thicken: /* f32 */ number,
): /* f32 */ number {
  'use gpu';

  // The screen-space scale and the thickening it feeds are loop-invariant, and every
  // core boundary already materializes into its own variable, so neither is re-emitted
  // per candidate curve.
  const pixelsPerEm = slugPixelsPerEm(renderCoordinate);
  // Absent thickening and stem darkening are exactly their identity values, so the
  // core keeps one shader signature instead of an optional parameter per effect.
  const thickenFactor /* f32 */ = slugThickenFactor(thicken, pixelsPerEm.z);

  const horizontal = evaluateBand('horizontal')(glyph, renderCoordinate, pixelsPerEm.x, thickenFactor);
  const vertical = evaluateBand('vertical')(glyph, renderCoordinate, pixelsPerEm.y, thickenFactor);

  return calcCoverage(
    horizontal.coverage,
    horizontal.weight,
    vertical.coverage,
    vertical.weight,
    evenOdd,
    weightBoost,
    stemDarken,
    pixelsPerEm.z,
  );
}
