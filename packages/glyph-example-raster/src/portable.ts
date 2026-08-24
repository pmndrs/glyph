import {
  addF32,
  constantF32,
  defineTechniqueSchema,
  multiplyF32,
  registerRasterPlanProgram,
  subtractF32,
  techniqueProgram,
  type RasterPlanProgram,
  type TechniqueSchema,
} from '@pmndrs/glyph/core';

import { glyphExample, type GlyphExampleData } from './raster.js';

export const glyphExampleSchema: TechniqueSchema<
  {
    readonly origin: { readonly id: 1; readonly scalar: 'f32'; readonly lanes: readonly ['left', 'top'] };
    readonly size: { readonly id: 2; readonly scalar: 'f32'; readonly lanes: readonly ['widthX', 'heightY'] };
    readonly color: {
      readonly id: 3;
      readonly scalar: 'f32';
      readonly lanes: readonly ['red', 'green', 'blue', 'alpha'];
    };
  },
  {
    readonly f32: readonly ['inset', 'red', 'green', 'blue', 'alpha'];
  }
> = defineTechniqueSchema({
  technique: glyphExample.id,
  scope: 'glyph',
  binding: { f32: ['inset', 'red', 'green', 'blue', 'alpha'] },
  buffers: {
    origin: { id: 1, scalar: 'f32', lanes: ['left', 'top'] },
    size: { id: 2, scalar: 'f32', lanes: ['widthX', 'heightY'] },
    color: { id: 3, scalar: 'f32', lanes: ['red', 'green', 'blue', 'alpha'] },
  },
  resources: { glyphColors: { kind: 'glyph-example-colors' } },
  glyphOrigin: { buffer: 'origin' },
});

export const glyphExamplePlanProgram: RasterPlanProgram<typeof glyphExample, GlyphExampleData> = {
  technique: glyphExample,
  schema: glyphExampleSchema,
  policyBody(system, _capabilities) {
    const p = techniqueProgram(glyphExampleSchema);
    const { inlineOrigin, blockOrigin, fontSize, color, transformIndex } = p.semantics;
    const { inset, red, green, blue, alpha } = p.binding;
    const two = constantF32(2);
    const width = subtractF32(multiplyF32(fontSize, constantF32(0.65)), multiplyF32(multiplyF32(inset, fontSize), two));
    const height = subtractF32(fontSize, multiplyF32(multiplyF32(inset, fontSize), two));
    p.store(glyphExampleSchema.buffers.origin, [
      addF32(inlineOrigin, multiplyF32(inset, fontSize)),
      subtractF32(blockOrigin, multiplyF32(inset, fontSize)),
    ]);
    p.store(glyphExampleSchema.buffers.size, [width, height]);
    p.store(glyphExampleSchema.buffers.color, [
      multiplyF32(color.red, red),
      multiplyF32(color.green, green),
      multiplyF32(color.blue, blue),
      multiplyF32(color.alpha, alpha),
    ]);
    p.store({ id: system.stableGlyphId.id, scalar: 'u32', lanes: system.stableGlyphId.lanes }, [
      p.semantics.stableGlyphId,
    ]);
    if (system.transformIndex !== undefined) p.store(system.transformIndex, [transformIndex]);
    return p.compile();
  },
  compileFont(compiler) {
    const data = compiler.font.data;
    const { resources } = compiler.resources([data.resource]);
    compiler.retain(data.resource, data);
    compiler.compile({
      techniqueId: compiler.techniqueId,
      programVariant: 0,
      glyphCount: compiler.font.font.glyphCount,
      strikes: [0],
      resources,
      resourceIndex: () => 0,
      glyphF32: {
        rows: data.glyphCount,
        fields: [
          () => data.inset,
          (row) => data.colors[row * 4]! / 255,
          (row) => data.colors[row * 4 + 1]! / 255,
          (row) => data.colors[row * 4 + 2]! / 255,
          (row) => data.colors[row * 4 + 3]! / 255,
        ],
      },
      glyphU32: compiler.emptyTable(data.glyphCount),
      strikeF32: compiler.emptyTable(data.glyphCount),
      strikeU32: compiler.emptyTable(data.glyphCount),
      resourceF32: compiler.emptyTable(resources.length),
      resourceU32: compiler.emptyTable(resources.length),
    });
  },
};

registerRasterPlanProgram(glyphExamplePlanProgram);
