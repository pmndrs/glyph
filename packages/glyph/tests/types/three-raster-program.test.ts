import type { PortableResource } from '../../src/index.js';
import { id } from '../../src/config/codec.js';
import { registerRasterCodec } from '../../src/config/raster.js';
import { defineRasterFormat } from '../../src/config/raster-format.js';
import { defineTechniqueSchema } from '../../src/config/schema.js';
import {
  registerThreeRasterProgram,
  type ThreeRasterMaterialContext,
  type ThreeRasterProgram,
  type ThreeRasterVariant,
} from '../../src/three.js';

declare const materialContext: ThreeRasterMaterialContext;
const namedResource: PortableResource | undefined = materialContext.namedResources.get('atlas');
void namedResource;

const technique = defineRasterFormat({
  id: 'probe.three-exact-schema',
  kind: 'probe',
  extension: 'PROBE_three_exact_schema',
  version: 0,
  textEffects: [],
  descriptor: () => ({}),
  async decode() {
    return {};
  },
  dispose() {},
});

const schema = defineTechniqueSchema({
  technique: technique.id,
  scope: 'glyph',
  binding: {},
  buffers: {
    rect: { id: id.buffer('probe.three-exact-schema/rect'), scalar: 'f32', lanes: ['x', 'y', 'width', 'height'] },
    flags: { id: id.buffer('probe.three-exact-schema/flags'), scalar: 'u32', lanes: ['value'] },
  },
  resources: {
    atlas: { kind: 'texture', format: 'rgba8unorm' },
    meta: { kind: 'buffer' },
    mesh: {
      kind: 'geometry',
      attributes: [{ semantic: 'position', componentType: 'f32', components: 3 }],
    },
  },
  render: { resource: 'atlas', geometry: { kind: 'quad', resource: 'mesh', coordinates: 'em' } },
});

type Variant = ThreeRasterVariant<typeof schema>;

const variant = {
  id: 'tsl',
  language: 'tsl',
  buffers: {
    rect: { scalar: 'f32', vectorWidth: 4 },
    flags: { scalar: 'u32', vectorWidth: 1 },
  },
  resources: {
    atlas: { kind: 'texture', format: 'rgba8unorm' },
    meta: { kind: 'buffer' },
    mesh: { kind: 'geometry' },
  },
  outputs: { position: 'vec3' },
  geometry: { kind: 'quad', resource: 'mesh', coordinates: 'em' },
  createMaterial() {
    throw new Error('type fixture');
  },
} as const satisfies Variant;

const codec = registerRasterCodec({
  raster: technique,
  schema,
  codecBody() {
    throw new Error('type fixture');
  },
  compileFont() {
    throw new Error('type fixture');
  },
});

registerThreeRasterProgram({ codec, variant });

const wrongScalar: Variant = {
  ...variant,
  buffers: {
    ...variant.buffers,
    // @ts-expect-error The schema fixes rect as f32x4.
    rect: { scalar: 'u32', vectorWidth: 4 },
  },
};
void wrongScalar;

const wrongWidth: Variant = {
  ...variant,
  buffers: {
    ...variant.buffers,
    // @ts-expect-error The schema fixes rect as f32x4.
    rect: { scalar: 'f32', vectorWidth: 2 },
  },
};
void wrongWidth;

const missingBuffer: Variant = {
  ...variant,
  // @ts-expect-error Every schema buffer is required exactly once.
  buffers: { rect: variant.buffers.rect },
};
void missingBuffer;

const unknownBuffer: Variant = {
  ...variant,
  buffers: {
    ...variant.buffers,
    // @ts-expect-error Renderer variants cannot invent codec buffers.
    ghost: { scalar: 'f32', vectorWidth: 1 },
  },
};
void unknownBuffer;

const missingResource: Variant = {
  ...variant,
  // @ts-expect-error Every schema resource is required exactly once.
  resources: { atlas: variant.resources.atlas, meta: variant.resources.meta },
};
void missingResource;

const wrongResourceKind: Variant = {
  ...variant,
  resources: {
    ...variant.resources,
    // @ts-expect-error The schema fixes atlas as a texture.
    atlas: { kind: 'buffer' },
  },
};
void wrongResourceKind;

const wrongFormat: Variant = {
  ...variant,
  resources: {
    ...variant.resources,
    // @ts-expect-error The schema fixes the texture sample format.
    atlas: { kind: 'texture', format: 'r8unorm' },
  },
};
void wrongFormat;

const phantomFormat: Variant = {
  ...variant,
  resources: {
    ...variant.resources,
    // @ts-expect-error Buffers do not carry texture formats.
    meta: { kind: 'buffer', format: 'rgba8unorm' },
  },
};
void phantomFormat;

const wrongGeometryKind: Variant = {
  ...variant,
  // @ts-expect-error The exact schema declares a quad, not a hull.
  geometry: { kind: 'hull', resource: 'mesh', coordinates: 'em' },
};
void wrongGeometryKind;

const wrongGeometryCoordinates: Variant = {
  ...variant,
  // @ts-expect-error The exact schema declares em-space geometry.
  geometry: { kind: 'quad', resource: 'mesh', coordinates: 'unit-square' },
};
void wrongGeometryCoordinates;

const otherSchema = defineTechniqueSchema({
  technique: 'probe.three-exact-schema.other',
  scope: 'glyph',
  binding: {},
  buffers: {},
});
const mismatched: ThreeRasterProgram<typeof technique, typeof otherSchema> = {
  // @ts-expect-error The registered Codec preserves its exact schema association.
  codec,
  variant: {
    id: 'other',
    language: 'tsl',
    buffers: {},
    resources: {},
    outputs: {},
    geometry: { kind: 'synthetic-quad' },
    createMaterial() {
      throw new Error('type fixture');
    },
  },
};
void mismatched;

// @ts-expect-error Dynamic registration needs the registered Codec witness.
registerThreeRasterProgram({ variant });
