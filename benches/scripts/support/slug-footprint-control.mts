import type { Plugin } from 'vite';
import { SLUG_RECTANGLE, SLUG_NONLINEAR_QUADRATIC } from '../../src/slug-nonlinear-fixture.ts';

/** Deliberately keep warped roots/bands while measuring the pre-warp coordinate's actual derivative. */
export function slugOriginalFootprintControl(): Plugin {
  const { left, right } = SLUG_RECTANGLE;
  const width = right - left;
  const quadratic = SLUG_NONLINEAR_QUADRATIC;
  return {
    name: 'slug-original-footprint-negative-control',
    enforce: 'pre',
    transform: {
      order: 'pre',
      handler(code, id) {
        let needle: string;
        let replacement: string;
        if (id.endsWith('/shaders/tsl/slug/slug-render.ts')) {
          needle = 'vec2Fwidth(renderCoordinate)';
          replacement = `vec2Fwidth(slugControlVec2(float(${left}).add(slugControlSqrt(max(float(1).add(renderCoordinate.x.sub(${left}).div(${width}).mul(${4 * quadratic})), 0)).sub(1).mul(${width / (2 * quadratic)})), renderCoordinate.y))`;
          if (code.includes('slugControlVec2') || code.includes('slugControlSqrt'))
            throw new Error('original-footprint control import collision');
          code = `import { vec2 as slugControlVec2, sqrt as slugControlSqrt } from 'three/tsl';\n${code}`;
        } else if (id.endsWith('/shaders/typegpu/slug/core/band.ts')) {
          needle = 'std.fwidth(renderCoordinate)';
          replacement = `std.fwidth(d.vec2f(${left} + (std.sqrt(std.max(1 + (renderCoordinate.x - ${left}) / ${width} * ${4 * quadratic}, 0)) - 1) * ${width / (2 * quadratic)}, renderCoordinate.y))`;
        } else return;
        if (code.split(needle).length !== 2) throw new Error(`original-footprint control could not identify ${id}`);
        // This analytically inverts s+a*s² to the original fragment-derived field, not an arbitrarily scaled footprint.
        // Its x derivative is the original renderCoordinate's 1/fontSize in this axis-aligned, x-scale-one fixture.
        // The clamp keeps unrelated specimens finite; the rectangle probe lies strictly in its unclamped domain.
        process.stdout.write(`[three-proof] original-footprint control patched ${id}\n`);
        return code.replace(needle, replacement);
      },
    },
  };
}
