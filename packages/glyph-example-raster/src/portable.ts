import {
  defineTechniqueSchema,
  f32,
  techniqueProgram,
  type RasterPlanProgram,
  type TechniqueSchema,
} from '@pmndrs/glyph/core';

import { glyphExample } from './raster.js';

const GLYPH_EXAMPLE_ORIGIN_BUFFER_ID = 1;
const GLYPH_EXAMPLE_SIZE_BUFFER_ID = 2;
const GLYPH_EXAMPLE_COLOR_BUFFER_ID = 3;

export const glyphExampleSchema: TechniqueSchema<
  {
    readonly origin: {
      readonly id: typeof GLYPH_EXAMPLE_ORIGIN_BUFFER_ID;
      readonly scalar: 'f32';
      readonly lanes: readonly ['left', 'top'];
    };
    readonly size: {
      readonly id: typeof GLYPH_EXAMPLE_SIZE_BUFFER_ID;
      readonly scalar: 'f32';
      readonly lanes: readonly ['widthX', 'heightY'];
    };
    readonly color: {
      readonly id: typeof GLYPH_EXAMPLE_COLOR_BUFFER_ID;
      readonly scalar: 'f32';
      readonly lanes: readonly ['red', 'green', 'blue', 'alpha'];
    };
  },
  {
    readonly f32: readonly ['inset', 'red', 'green', 'blue', 'alpha'];
  },
  { readonly glyphColors: { readonly kind: 'buffer' } },
  typeof glyphExample.id
> = defineTechniqueSchema({
  technique: glyphExample.id,
  scope: 'glyph',
  binding: { f32: ['inset', 'red', 'green', 'blue', 'alpha'] },
  buffers: {
    origin: { id: GLYPH_EXAMPLE_ORIGIN_BUFFER_ID, scalar: 'f32', lanes: ['left', 'top'] },
    size: { id: GLYPH_EXAMPLE_SIZE_BUFFER_ID, scalar: 'f32', lanes: ['widthX', 'heightY'] },
    color: { id: GLYPH_EXAMPLE_COLOR_BUFFER_ID, scalar: 'f32', lanes: ['red', 'green', 'blue', 'alpha'] },
  },
  resources: { glyphColors: { kind: 'buffer' } },
  render: { geometry: { kind: 'synthetic-quad' } },
  glyphOrigin: { buffer: 'origin' },
});

const GLYPH_EXAMPLE_PROGRAM_VARIANT = 0;

export const glyphExamplePlanProgramDefinition: RasterPlanProgram<typeof glyphExample, typeof glyphExampleSchema> = {
  technique: glyphExample,
  schema: glyphExampleSchema,
  programVariant: GLYPH_EXAMPLE_PROGRAM_VARIANT,
  policyBody(system, _capabilities) {
    const p = techniqueProgram(glyphExampleSchema, { system });
    const { inlineOrigin, blockOrigin, fontSize, color } = p.semantics;
    const { inset, red, green, blue, alpha } = p.binding;
    // The authored inset trims both edges, so width and height lose twice its pixel value.
    const two = f32.const(2);
    const insetPixels = f32.mul(inset, fontSize);
    const twiceInsetPixels = f32.mul(insetPixels, two);
    const width = f32.sub(f32.mul(fontSize, f32.const(0.65)), twiceInsetPixels);
    const height = f32.sub(fontSize, twiceInsetPixels);
    return p.compile({
      origin: [f32.add(inlineOrigin, insetPixels), f32.sub(blockOrigin, insetPixels)],
      size: [width, height],
      color: [
        f32.mul(color.red, red),
        f32.mul(color.green, green),
        f32.mul(color.blue, blue),
        f32.mul(color.alpha, alpha),
      ],
    });
  },
  compileFont(compiler) {
    const data = compiler.font.data;
    compiler.retain('glyphColors', data.resource, {
      kind: 'buffer',
      bytes: data.colors,
      stride: 4,
    });
    return compiler.compile({
      strikes: [0],
      resource: () => data.resource,
      f32: {
        inset: () => data.inset,
        red: (row) => data.colors[row * 4]! / 255,
        green: (row) => data.colors[row * 4 + 1]! / 255,
        blue: (row) => data.colors[row * 4 + 2]! / 255,
        alpha: (row) => data.colors[row * 4 + 3]! / 255,
      },
    });
  },
};
