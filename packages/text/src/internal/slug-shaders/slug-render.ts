/**
 * Three.js/TSL entry point for the analytic Slug fill.
 *
 * This module only wires TSL nodes into the host-agnostic core: the fragment scale,
 * the thickening factor, and the final weighted blend are all portable core calls.
 */
import tgpu, { d, type TgpuSlot } from 'typegpu';
import { slugPixelsPerEm, slugThickenFactor } from './core/band.js';
import { calcCoverage } from './core/coverage.js';
import { evaluateBand, type SlugShaderGlyph } from './slug-band.js';

export { MAX_SAFE_SLUG_BAND_CURVES } from './core/band.js';
export type { SlugShaderPage } from './slug-texture.js';
export { SlugShaderGlyph } from './slug-band.js';

export interface SlugRenderOptions {
  readonly evenOdd: boolean;
  readonly weightBoost: boolean;
  readonly stemDarken?: /* f32 */ number;
  readonly thicken?: /* f32 */ number;
}

export const slugRenderOptionsSlot: TgpuSlot<SlugRenderOptions> = tgpu.slot<SlugRenderOptions>({
  evenOdd: false,
  weightBoost: false,
});

/**
 * Evaluate analytic Slug fill coverage for one fragment.
 * @note Uses `pageSlot`
 */
export function slugRender(glyph: SlugShaderGlyph, renderCoordinate: d.v2f): /* f32 */ number {
  'use gpu';

  // The screen-space scale and the thickening it feeds are loop-invariant, and every
  // core boundary already materializes into its own variable, so neither is re-emitted
  // per candidate curve.
  const pixelsPerEm = slugPixelsPerEm(renderCoordinate);
  // Absent thickening and stem darkening are exactly their identity values, so the
  // core keeps one shader signature instead of an optional parameter per effect.
  const thicken /* f32 */ = d.f32(slugRenderOptionsSlot.$.thicken ?? 0);
  const stemDarken /* f32 */ = d.f32(slugRenderOptionsSlot.$.stemDarken ?? 0);
  const thickenFactor /* f32 */ = slugThickenFactor(thicken, pixelsPerEm.z);

  const horizontal = evaluateBand('horizontal')(glyph, renderCoordinate, pixelsPerEm.x, thickenFactor);
  const vertical = evaluateBand('vertical')(glyph, renderCoordinate, pixelsPerEm.y, thickenFactor);

  return calcCoverage(
    horizontal.coverage,
    horizontal.weight,
    vertical.coverage,
    vertical.weight,
    slugRenderOptionsSlot.$.evenOdd,
    slugRenderOptionsSlot.$.weightBoost,
    stemDarken,
    pixelsPerEm.z,
  );
}
