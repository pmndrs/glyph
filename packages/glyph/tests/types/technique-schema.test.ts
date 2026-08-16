import {
  definePolicyBuffers,
  defineTechniqueSchema,
  multiplyF32,
  schemaFieldTable,
  schemaPolicyBuffers,
  techniqueProgram,
  type FontBindingFieldTable,
  type PolicyBuffer,
  type PolicyF32Value,
} from '@pmndrs/glyph/core';
import { bitmapSchema } from '@pmndrs/glyph/raster/bitmap';

// A technique schema is the single authority: buffer ids, scalar kinds, and lane
// meanings are declared once and every consumer derives from the declaration.
const schema = defineTechniqueSchema({
  technique: 'example.technique',
  scope: 'glyph',
  binding: { f32: ['bearingX', 'size'] as const, u32: ['page'] as const },
  buffers: {
    rect: { id: 1, scalar: 'f32', lanes: ['left', 'top', 'width', 'height'] },
    page: { id: 2, scalar: 'u32', lanes: ['page'] },
  } as const,
});

const p = techniqueProgram(schema);
const { fontSize } = p.semantics;
const { bearingX, size, page } = p.binding;
const scaled: PolicyF32Value = multiplyF32(size, fontSize);
p.store(schema.buffers.rect, [multiplyF32(bearingX, fontSize), scaled, scaled, scaled]);
p.store(schema.buffers.page, [page]);
void p.compile();

// The id is data, not convention: consumers read it from the declaration.
const rectId: number = schema.buffers.rect.id;
void rectId;

// System buffers use the same construct without a technique wrapper.
const system = definePolicyBuffers({
  stableGlyphId: { id: 14, scalar: 'u32', lanes: ['stableGlyphId'] },
} as const);
p.store(system.stableGlyphId, [p.semantics.stableGlyphId]);

// The first-party bitmap technique publishes its schema from its own subpath.
const bitmapColorId: number = bitmapSchema.buffers.color.id;
void bitmapColorId;

// Wire buffer lists and binding tables derive from the same declaration.
const wire: PolicyBuffer[] = schemaPolicyBuffers(schema);
void wire;
const table: FontBindingFieldTable = schemaFieldTable(['bearingX', 'size'] as const, 4, {
  bearingX: (row) => row,
  size: (row) => row * 2,
});
void table;

// @ts-expect-error An f32 value cannot be stored into a u32 buffer.
p.store(schema.buffers.page, [scaled]);
// @ts-expect-error Undeclared buffers do not exist on the schema.
void schema.buffers.atlas;
// @ts-expect-error Undeclared binding fields do not exist.
void p.binding.kerning;
// @ts-expect-error A field table must provide a reader for every declared name.
schemaFieldTable(['bearingX', 'size'] as const, 4, { bearingX: (row: number) => row });
// @ts-expect-error A misspelled reader name is a compile error, not a shifted column.
schemaFieldTable(['bearingX'] as const, 4, { bearingsX: (row: number) => row });
// @ts-expect-error glyphOrigin must name a declared buffer at runtime; the property is read-only here.
schema.glyphOrigin = { buffer: 'rect' };
