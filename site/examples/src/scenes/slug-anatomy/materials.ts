import { defineTextMaterial } from '@pmndrs/glyph/three';
import { abs, color, float, floor, fract, max, mix, step, uniform, uv, vec3 } from 'three/tsl';

import { BANDS } from './config';

/** The band the sweep is on, along each axis; set per frame. */
export const sweep = uniform(0);

/**
 * Slug, shown working. `coverage` is the analytic fill the technique
 * integrates from the glyph's curves; the quad's UV is the glyph's box, which
 * Slug cuts into sixteen bands each way. The grid draws those bands, the
 * sweep lights the horizontal and vertical band a pixel would walk, and the
 * antialiased edge — where coverage is neither 0 nor 1 — glows.
 */
export const anatomyInk = defineTextMaterial((context) => {
  const material = context.createDefaultMaterial();
  if (context.kind !== 'glyph' || context.format !== 'pmndrs.slug') return material;
  const coverage = context.shader.coverage;
  const cell = uv().mul(BANDS);
  const band = floor(cell);
  const within = fract(cell);
  const line = max(step(within.x, 0.035), step(within.y, 0.035));
  const onSweep = max(step(abs(band.x.sub(sweep)), 0.5), step(abs(band.y.sub(sweep)), 0.5));
  const edge = coverage.mul(float(1).sub(coverage)).mul(4);

  const ground = mix(color('#131826'), color('#1f2740'), onSweep);
  const grid = mix(ground, color('#3a4560'), line);
  const ink = mix(color('#e7ecf6'), color('#ffd166'), onSweep.mul(0.35));
  material.colorNode = mix(mix(grid, ink, coverage), color('#ffd166'), edge);
  material.opacityNode = max(coverage, max(line.mul(0.9), onSweep.mul(0.55)).add(0.35)).mul(
    context.shader.opacity.add(float(1).sub(coverage)),
  );
  return material;
});

/** The caption's quiet ink. */
export const CAPTION = '#97a1b4';
export { vec3 };
