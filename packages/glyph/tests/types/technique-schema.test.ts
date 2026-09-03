import { type CodecBuffer, type CodecF32Value } from '../../dist/index.js';
import { f32, techniqueProgram } from '../../dist/config/codec-program.js';
import { id } from '../../dist/config/codec.js';
import {
  defineCodecBuffers,
  defineTechniqueGeometryKind,
  defineTechniqueSchema,
  schemaCodecBuffers,
} from '../../dist/config/schema.js';
import { schemaFieldTable, type FontBindingFieldTable } from '../../dist/internal/font-binding.js';
import { bitmapSchema } from '@pmndrs/glyph/raster/bitmap';

// A technique schema is the single authority: buffer ids, scalar kinds, and lane
// meanings are declared once and every consumer derives from the declaration.
const schema = defineTechniqueSchema({
  technique: 'example.technique',
  scope: 'glyph',
  binding: { f32: ['bearingX', 'size'] as const, u32: ['page'] as const },
  buffers: {
    rect: { id: id.buffer('type-schema/rect'), scalar: 'f32', lanes: ['left', 'top', 'width', 'height'] },
    page: { id: id.buffer('type-schema/page'), scalar: 'u32', lanes: ['page'] },
  } as const,
});

defineTechniqueSchema({
  ...schema,
  // @ts-expect-error Synthetic geometry cannot carry a renderer resource.
  render: { geometry: { kind: 'synthetic-quad', resource: 'mesh' } },
});

defineTechniqueSchema({
  technique: 'example.empty-resource',
  scope: 'glyph',
  binding: {},
  buffers: {},
  // @ts-expect-error Empty resource names cannot be retained and therefore cannot enter a schema.
  resources: { '': { kind: 'buffer' } },
});

defineTechniqueSchema({
  technique: 'example.invalid-supplied',
  scope: 'glyph',
  binding: {},
  buffers: {},
  // @ts-expect-error Supplied geometry requires a declared geometry resource and coordinates.
  render: { geometry: { kind: 'quad' } },
});

defineTechniqueSchema({
  technique: 'example.invalid-resource',
  scope: 'glyph',
  binding: {},
  buffers: {},
  // @ts-expect-error Reserved buffer resources cannot smuggle texture metadata through an open resource arm.
  resources: { table: { kind: 'buffer', format: 'r8unorm' } },
});

defineTechniqueSchema({
  technique: 'example.unbound-geometry',
  scope: 'glyph',
  binding: {},
  buffers: {},
  // @ts-expect-error Supplied geometry declares the exact vertex inputs its shader consumes.
  resources: { mesh: { kind: 'geometry' } },
});

const suppliedSchema = defineTechniqueSchema({
  technique: 'example.supplied-geometry',
  scope: 'glyph',
  binding: {},
  buffers: {},
  resources: {
    mesh: {
      kind: 'geometry',
      attributes: [
        { semantic: 'position', componentType: 'f32', components: 2 },
        { semantic: 'uv', componentType: 'f32', components: 2 },
      ],
    },
  },
  render: { resource: 'mesh', geometry: { kind: 'quad', resource: 'mesh', coordinates: 'unit-square' } },
});
const positionComponents: 2 = suppliedSchema.resources.mesh.attributes[0].components;
void positionComponents;

const meshlet = defineTechniqueGeometryKind('meshlet');
defineTechniqueSchema({
  technique: 'example.custom-geometry',
  scope: 'glyph',
  binding: {},
  buffers: {},
  resources: suppliedSchema.resources,
  render: { resource: 'mesh', geometry: { kind: 'custom', name: meshlet, resource: 'mesh', coordinates: 'em' } },
});

defineTechniqueSchema({
  technique: 'example.unbranded-custom-geometry',
  scope: 'glyph',
  binding: {},
  buffers: {},
  resources: suppliedSchema.resources,
  // @ts-expect-error Extension geometry names must pass through defineTechniqueGeometryKind.
  render: { resource: 'mesh', geometry: { kind: 'custom', name: 'meshlet', resource: 'mesh', coordinates: 'em' } },
});

defineTechniqueSchema({
  ...schema,
  // @ts-expect-error glyphOrigin must name a declared f32 buffer with at least two lanes.
  glyphOrigin: { buffer: 'page' },
});

const system = defineCodecBuffers({
  stableGlyphId: { id: id.buffer('type-schema/stable-glyph'), scalar: 'u32', lanes: ['stableGlyphId'] },
} as const);
const p = techniqueProgram(schema, { system });
const { fontSize } = p.semantics;
const { bearingX, size, page } = p.binding;
const scaled: CodecF32Value = f32.mul(size, fontSize);
void p.compile({ rect: [f32.mul(bearingX, fontSize), scaled, scaled, scaled], page: [page] });

// @ts-expect-error Every declared buffer is required by the exact compile map.
p.compile({ rect: [scaled, scaled, scaled, scaled] });

p.compile({
  // @ts-expect-error A declared four-lane buffer requires exactly four values.
  rect: [scaled],
  page: [page],
});

const foreignBuffers = defineCodecBuffers({
  rect: { id: id.buffer('type-schema/foreign-rect'), scalar: 'f32', lanes: ['left', 'top', 'width', 'height'] },
} as const);
void foreignBuffers;
// @ts-expect-error Codec buffer declarations reject arbitrary numeric IDs.
defineCodecBuffers({ raw: { id: 1, scalar: 'u32', lanes: ['value'] } });
p.compile({
  rect: [scaled, scaled, scaled, scaled],
  page: [page],
  // @ts-expect-error A Codec cannot compile an undeclared buffer.
  foreign: [scaled],
});

// The id is data, not convention: consumers read it from the declaration.
const rectId: number = schema.buffers.rect.id;
void rectId;

// System buffers use the same construct without entering the technique store map.
const stableGlyphBufferId: number = system.stableGlyphId.id;
void stableGlyphBufferId;

// The first-party bitmap technique publishes its schema from its own subpath.
const bitmapColorId: number = bitmapSchema.buffers.color.id;
void bitmapColorId;

// Wire buffer lists and binding tables derive from the same declaration.
const wire: CodecBuffer[] = schemaCodecBuffers(schema);
void wire;
const table: FontBindingFieldTable = schemaFieldTable(['bearingX', 'size'] as const, 4, {
  bearingX: (row) => row,
  size: (row) => row * 2,
});
void table;

p.compile({
  rect: [scaled, scaled, scaled, scaled],
  // @ts-expect-error An f32 value cannot be stored into a u32 buffer.
  page: [scaled],
});
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
