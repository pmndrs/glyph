/** Adapted from three-flatland Slug at 2935a89f (MIT); texture addressing matches PMNDRS_font_slug V0's R32UI header grid and R16UI glyph-local reference grid. */
import type { Node } from 'three/webgpu';
import { add, div, float, max, mul, sub } from 'three/tsl';
import { calcCoverage } from './calc-coverage.js';
import { evaluateBand, type SlugShaderGlyph } from './slug-band.js';
import type { SlugShaderPage } from './slug-texture.js';
import { vec2Fwidth } from './tsl-compat.js';

export { MAX_SAFE_SLUG_BAND_CURVES, type SlugShaderPage } from './slug-texture.js';
export type { SlugShaderGlyph } from './slug-band.js';

export interface SlugRenderOptions {
  readonly evenOdd: Node<'bool'>;
  readonly weightBoost: Node<'bool'>;
  readonly stemDarken?: Node<'float'>;
  readonly thicken?: Node<'float'>;
}

function namedFloat(node: Node<'float'>, name: string): Node<'float'> {
  return node.toVar(name);
}

function namedVec2(node: Node<'vec2'>, name: string): Node<'vec2'> {
  return node.toVar(name);
}

/** Evaluate analytic Slug fill coverage for one fragment. */
export function slugRender(
  page: SlugShaderPage,
  glyph: SlugShaderGlyph,
  renderCoordinate: Node<'vec2'>,
  options: SlugRenderOptions,
): Node<'float'> {
  // These derivatives and reciprocal footprints are loop-invariant. Explicit
  // variables prevent TSL from re-emitting them once per candidate curve.
  const emsPerPixel: Node<'vec2'> = namedVec2(vec2Fwidth(renderCoordinate), 'slugEmsPerPixel');
  const minimumFootprintX: Node<'float'> = max(emsPerPixel.x, 1 / 65_536);
  const minimumFootprintY: Node<'float'> = max(emsPerPixel.y, 1 / 65_536);
  const pixelsPerEmX: Node<'float'> = namedFloat(div(1, minimumFootprintX), 'slugPixelsPerEmX');
  const pixelsPerEmY: Node<'float'> = namedFloat(div(1, minimumFootprintY), 'slugPixelsPerEmY');
  const pixelsPerEmSum: Node<'float'> = add(pixelsPerEmX, pixelsPerEmY);
  const pixelsPerEm: Node<'float'> = namedFloat(mul(pixelsPerEmSum, 0.5), 'slugPixelsPerEm');
  const thickenFactor: Node<'float'> =
    options.thicken === undefined
      ? float(1)
      : namedFloat(add(1, mul(options.thicken, max(0, sub(1, div(pixelsPerEm, 24))))), 'slugThickenFactor');

  const horizontal = evaluateBand(page, glyph, renderCoordinate, 'horizontal', pixelsPerEmX, thickenFactor);
  const vertical = evaluateBand(page, glyph, renderCoordinate, 'vertical', pixelsPerEmY, thickenFactor);

  return calcCoverage(
    horizontal.coverage,
    horizontal.weight,
    vertical.coverage,
    vertical.weight,
    options.evenOdd,
    options.weightBoost,
    options.stemDarken,
    pixelsPerEm,
  );
}
