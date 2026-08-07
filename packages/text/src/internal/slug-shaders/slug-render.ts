/**
 * Three.js/TSL entry point for the analytic Slug fill.
 *
 * This module only wires TSL nodes into the host-agnostic core: the fragment scale,
 * the thickening factor, and the final weighted blend are all portable core calls.
 */
import type { Node } from 'three/webgpu';
import { float } from 'three/tsl';
import { d } from 'typegpu';
import * as t3 from '@typegpu/three';
import { coreValue } from './core-boundary.js';
import { slugPixelsPerEm, slugThickenFactor } from './core/band.js';
import { calcCoverage } from './core/coverage.js';
import { evaluateBand, type SlugShaderGlyph } from './slug-band.js';
import type { SlugShaderPage } from './slug-texture.js';

export { MAX_SAFE_SLUG_BAND_CURVES } from './core/band.js';
export type { SlugShaderPage } from './slug-texture.js';
export type { SlugShaderGlyph } from './slug-band.js';

export interface SlugRenderOptions {
  readonly evenOdd: Node<'bool'>;
  readonly weightBoost: Node<'bool'>;
  readonly stemDarken?: Node<'float'>;
  readonly thicken?: Node<'float'>;
}

/** Evaluate analytic Slug fill coverage for one fragment. */
export function slugRender(
  page: SlugShaderPage,
  glyph: SlugShaderGlyph,
  renderCoordinate: Node<'vec2'>,
  options: SlugRenderOptions,
): Node<'float'> {
  // The screen-space scale and the thickening it feeds are loop-invariant, and every
  // core boundary already materializes into its own variable, so neither is re-emitted
  // per candidate curve.
  const pixelsPerEm: Node<'vec3'> = coreValue('vec3', 'slugFragmentScale', () => {
    'use gpu';
    return slugPixelsPerEm(t3.fromTSL(renderCoordinate, d.vec2f).$);
  });
  // Absent thickening and stem darkening are exactly their identity values, so the
  // core keeps one shader signature instead of an optional parameter per effect.
  const thicken: Node<'float'> = options.thicken ?? float(0);
  const stemDarken: Node<'float'> = options.stemDarken ?? float(0);
  const thickenFactor: Node<'float'> = coreValue('float', 'slugCoverageThicken', () => {
    'use gpu';
    return slugThickenFactor(t3.fromTSL(thicken, d.f32).$, t3.fromTSL(pixelsPerEm.z, d.f32).$);
  });

  const horizontal = evaluateBand(page, glyph, renderCoordinate, 'horizontal', pixelsPerEm.x, thickenFactor);
  const vertical = evaluateBand(page, glyph, renderCoordinate, 'vertical', pixelsPerEm.y, thickenFactor);

  return coreValue('float', 'slugFillCoverage', () => {
    'use gpu';
    return calcCoverage(
      t3.fromTSL(horizontal.coverage, d.f32).$,
      t3.fromTSL(horizontal.weight, d.f32).$,
      t3.fromTSL(vertical.coverage, d.f32).$,
      t3.fromTSL(vertical.weight, d.f32).$,
      t3.fromTSL(options.evenOdd, d.bool).$,
      t3.fromTSL(options.weightBoost, d.bool).$,
      t3.fromTSL(stemDarken, d.f32).$,
      t3.fromTSL(pixelsPerEm.z, d.f32).$,
    );
  });
}
