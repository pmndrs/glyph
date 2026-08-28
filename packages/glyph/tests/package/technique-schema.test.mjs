import assert from 'node:assert/strict';
import test from 'node:test';

import { defineTechniqueGeometryKind, defineTechniqueSchema, id, schemaPolicyBuffers } from '../../dist/core.js';
import { textShaperAbi } from '../../dist/generated/text-shaper-abi.js';
import { bitmapSchema } from '@pmndrs/glyph/raster/bitmap';
import { msdfSchema } from '@pmndrs/glyph/raster/msdf';
import { slugSchema } from '@pmndrs/glyph/raster/slug';

const ORIGIN_BUFFER_ID = id('buffer', 'test.technique/origin');
const FLAGS_BUFFER_ID = id('buffer', 'test.technique/flags');
const THIN_BUFFER_ID = id('buffer', 'test.technique/thin');

function declaration() {
  return {
    technique: 'test.technique',
    scope: 'glyph',
    binding: { f32: ['a', 'b'], u32: ['c'] },
    buffers: {
      origin: { id: ORIGIN_BUFFER_ID, scalar: 'f32', lanes: ['x', 'y'] },
      flags: { id: FLAGS_BUFFER_ID, scalar: 'u32', lanes: ['flags'] },
    },
    resources: { atlas: { kind: 'texture', format: 'rgba8unorm' } },
    render: { resource: 'atlas', geometry: { kind: 'synthetic-quad' } },
  };
}

test('defineTechniqueSchema freezes the whole declaration', () => {
  const schema = defineTechniqueSchema(declaration());
  assert.ok(Object.isFrozen(schema), 'schema');
  assert.ok(Object.isFrozen(schema.buffers), 'buffers');
  assert.ok(Object.isFrozen(schema.buffers.origin), 'buffer declaration');
  assert.ok(Object.isFrozen(schema.buffers.origin.lanes), 'lanes');
  assert.ok(Object.isFrozen(schema.binding), 'binding');
  assert.ok(Object.isFrozen(schema.binding.f32), 'binding names');
  assert.ok(Object.isFrozen(schema.resources), 'resources');
  assert.ok(Object.isFrozen(schema.resources.atlas), 'resource declaration');
  assert.throws(() => {
    schema.buffers.origin.id = 9;
  }, TypeError);
});

test('every first-party schema is frozen', () => {
  for (const schema of [bitmapSchema, msdfSchema, slugSchema]) {
    assert.ok(Object.isFrozen(schema), schema.technique);
    assert.ok(Object.isFrozen(schema.buffers), schema.technique);
    for (const buffer of Object.values(schema.buffers)) {
      assert.ok(Object.isFrozen(buffer) && Object.isFrozen(buffer.lanes), schema.technique);
    }
  }
});

test('rejected declarations leave caller-owned input untouched', () => {
  const input = {
    technique: 'test.rejected',
    scope: 'glyph',
    binding: { f32: ['duplicate'], u32: ['duplicate'] },
    buffers: { origin: { id: ORIGIN_BUFFER_ID, scalar: 'f32', lanes: ['x', 'y'] } },
  };
  assert.throws(() => defineTechniqueSchema(input), TypeError);
  assert.equal(Object.isFrozen(input.buffers), false);
  assert.equal(Object.isFrozen(input.buffers.origin), false);
  assert.equal(Object.isFrozen(input.buffers.origin.lanes), false);
});

test('malformed schema containers fail with named call-time diagnostics', () => {
  assert.throws(
    () => defineTechniqueSchema({ ...declaration(), binding: null }),
    (error) => error instanceof TypeError && error.message.includes('needs a binding object'),
  );
  assert.throws(
    () => defineTechniqueSchema({ ...declaration(), buffers: null }),
    (error) => error instanceof TypeError && error.message.includes('policy buffers need a declaration object'),
  );
  assert.throws(
    () => defineTechniqueSchema({ ...declaration(), resources: null }),
    (error) => error instanceof TypeError && error.message.includes('resources need a declaration object'),
  );
  assert.throws(
    () => defineTechniqueSchema({ ...declaration(), glyphOrigin: null }),
    (error) => error instanceof TypeError && error.message.includes('glyphOrigin needs a buffer name'),
  );
});

test('schema names are usable and lane metadata is unambiguous at construction', () => {
  assert.throws(
    () => defineTechniqueSchema({ ...declaration(), resources: { '': { kind: 'buffer' } } }),
    (error) => error instanceof TypeError && error.message.includes('resource names must not be empty'),
  );
  assert.throws(
    () =>
      defineTechniqueSchema({
        ...declaration(),
        buffers: { repeated: { id: ORIGIN_BUFFER_ID, scalar: 'f32', lanes: ['x', 'x'] } },
      }),
    (error) => error instanceof TypeError && error.message.includes('repeats a lane name'),
  );
});

test('schemas own their data: caller accessors cannot change validated widths', () => {
  let reads = 0;
  const accessorInput = {
    technique: 'test.accessor',
    scope: 'glyph',
    binding: { f32: ['a'] },
    buffers: {
      sneaky: {
        id: ORIGIN_BUFFER_ID,
        scalar: 'f32',
        get lanes() {
          reads += 1;
          return reads > 1 ? ['x', 'y', 'z'] : ['x'];
        },
      },
    },
  };
  const schema = defineTechniqueSchema(accessorInput);
  assert.deepEqual([...schema.buffers.sneaky.lanes], ['x']);
  assert.equal(schemaPolicyBuffers(schema)[0].vectorWidth, 1);
  assert.equal(schemaPolicyBuffers(schema)[0].vectorWidth, 1);
});

test('schema lookups do not accept inherited prototype names', () => {
  const buffers = Object.create(null);
  buffers.origin = { id: ORIGIN_BUFFER_ID, scalar: 'f32', lanes: ['x', 'y'] };
  assert.throws(
    () => defineTechniqueSchema({ ...declaration(), buffers, glyphOrigin: { buffer: '__proto__' } }),
    (error) => error instanceof TypeError && error.message.includes('undeclared buffer'),
  );

  const resources = Object.create(null);
  resources.atlas = { kind: 'texture', format: 'rgba8unorm' };
  assert.throws(
    () =>
      defineTechniqueSchema({
        ...declaration(),
        resources,
        render: { resource: 'atlas', geometry: { kind: 'quad', resource: '__proto__', coordinates: 'unit-square' } },
      }),
    (error) => error instanceof TypeError && error.message.includes('undeclared resource "__proto__"'),
  );
});

test('glyphOrigin metadata must name a declared f32 buffer with two origin lanes', () => {
  const valid = defineTechniqueSchema({ ...declaration(), glyphOrigin: { buffer: 'origin' } });
  assert.deepEqual(valid.glyphOrigin, { buffer: 'origin' });
  assert.throws(() => defineTechniqueSchema({ ...declaration(), glyphOrigin: { buffer: 'missing' } }), TypeError);
  assert.throws(() => defineTechniqueSchema({ ...declaration(), glyphOrigin: { buffer: 'flags' } }), TypeError);
  assert.throws(
    () =>
      defineTechniqueSchema({
        ...declaration(),
        buffers: { thin: { id: THIN_BUFFER_ID, scalar: 'f32', lanes: ['x'] } },
        glyphOrigin: { buffer: 'thin' },
      }),
    TypeError,
  );
});

test('first-party techniques declare where their glyph origin lives', () => {
  assert.equal(bitmapSchema.glyphOrigin?.buffer, 'origin');
  assert.equal(msdfSchema.glyphOrigin?.buffer, 'rect');
  assert.equal(slugSchema.glyphOrigin?.buffer, 'rect');
});

test('Slug table-start lanes name the table each value indexes', () => {
  assert.deepEqual(slugSchema.buffers.tableStarts.lanes, [
    'curveBase',
    'horizontalHeaderBase',
    'verticalHeaderBase',
    'referenceBase',
  ]);
});

test('schemaPolicyBuffers derives the wire buffer list from each authoritative schema', () => {
  for (const schema of [bitmapSchema, msdfSchema, slugSchema]) {
    assert.deepEqual(
      schemaPolicyBuffers(schema),
      Object.values(schema.buffers).map((buffer) => ({
        id: buffer.id,
        scalar: buffer.scalar,
        vectorWidth: buffer.lanes.length,
      })),
    );
  }
  const derived = schemaPolicyBuffers(defineTechniqueSchema(declaration()));
  assert.deepEqual(derived, [
    { id: ORIGIN_BUFFER_ID, scalar: 'f32', vectorWidth: 2 },
    { id: FLAGS_BUFFER_ID, scalar: 'u32', vectorWidth: 1 },
  ]);
});

function suppliedGeometryDeclaration(kind = 'quad') {
  return {
    ...declaration(),
    resources: {
      ...declaration().resources,
      mesh: { kind: 'geometry', attributes: vertexInputs() },
    },
    render: { resource: 'atlas', geometry: { kind, resource: 'mesh', coordinates: 'unit-square' } },
  };
}

function vertexInputs() {
  return [
    { semantic: 'position', componentType: 'f32', components: 2 },
    { semantic: 'uv', componentType: 'f32', components: 2 },
  ];
}

test('the portable render contract freezes and accepts synthetic-quad and supplied geometry', () => {
  const implicit = defineTechniqueSchema({
    ...declaration(),
    render: { resource: 'atlas', geometry: { kind: 'synthetic-quad' } },
  });
  assert.ok(Object.isFrozen(implicit.render), 'render');
  assert.ok(Object.isFrozen(implicit.render.geometry), 'geometry');
  assert.deepEqual(implicit.render.geometry, { kind: 'synthetic-quad' });

  const quad = defineTechniqueSchema(suppliedGeometryDeclaration());
  assert.deepEqual(quad.render.geometry, { kind: 'quad', resource: 'mesh', coordinates: 'unit-square' });
  assert.ok(Object.isFrozen(quad.resources.mesh.attributes), 'vertex inputs');
  assert.ok(Object.isFrozen(quad.resources.mesh.attributes[0]), 'vertex input');
  // Extensible supplied kinds such as hull follow the same declared-resource rule.
  const hull = defineTechniqueSchema(suppliedGeometryDeclaration('hull'));
  assert.equal(hull.render.geometry.kind, 'hull');

  const meshlet = defineTechniqueGeometryKind('meshlet');
  const custom = defineTechniqueSchema({
    ...suppliedGeometryDeclaration(),
    render: { resource: 'atlas', geometry: { kind: 'custom', name: meshlet, resource: 'mesh', coordinates: 'em' } },
  });
  assert.deepEqual(custom.render.geometry, { kind: 'custom', name: 'meshlet', resource: 'mesh', coordinates: 'em' });
});

test('synthetic-quad declares no resource and no coordinate convention', () => {
  assert.throws(
    () =>
      defineTechniqueSchema({
        ...declaration(),
        render: { resource: 'atlas', geometry: { kind: 'synthetic-quad', resource: 'atlas' } },
      }),
    TypeError,
  );
  assert.throws(
    () =>
      defineTechniqueSchema({
        ...declaration(),
        render: { resource: 'atlas', geometry: { kind: 'synthetic-quad', coordinates: 'unit-square' } },
      }),
    TypeError,
  );
});

test('raw null render declarations produce a contract error', () => {
  assert.throws(
    () => defineTechniqueSchema({ ...declaration(), render: null }),
    (error) => error instanceof TypeError && error.message.includes('render declaration needs an object'),
  );
});

test('resourceful schemas select one declared render resource at construction', () => {
  const withoutSelection = declaration();
  delete withoutSelection.render;
  assert.throws(
    () => defineTechniqueSchema(withoutSelection),
    (error) => error instanceof TypeError && error.message.includes('needs a declared render resource'),
  );
  assert.throws(
    () => defineTechniqueSchema({ ...declaration(), render: { geometry: { kind: 'synthetic-quad' } } }),
    (error) => error instanceof TypeError && error.message.includes('needs a declared render resource'),
  );
});

test('one selected repeated role keeps every draw resource bundle representable', () => {
  assert.throws(
    () =>
      defineTechniqueSchema({
        ...declaration(),
        resources: {
          pages: { kind: 'texture', format: 'r8unorm', cardinality: 'many' },
          effects: { kind: 'buffer', cardinality: 'many' },
        },
        render: { resource: 'pages', geometry: { kind: 'synthetic-quad' } },
      }),
    /only one repeated resource role/,
  );
  assert.throws(
    () =>
      defineTechniqueSchema({
        ...declaration(),
        resources: {
          pages: { kind: 'texture', format: 'r8unorm', cardinality: 'many' },
          metadata: { kind: 'buffer' },
        },
        render: { resource: 'metadata', geometry: { kind: 'synthetic-quad' } },
      }),
    /must select its repeated resource/,
  );
});

test('supplied geometry must name a declared geometry resource and state its coordinate convention', () => {
  assert.throws(
    () =>
      defineTechniqueSchema({
        ...declaration(),
        resources: { mesh: { kind: 'geometry', attributes: vertexInputs() } },
        render: { resource: 'mesh', geometry: { kind: 'quad', coordinates: 'unit-square' } },
      }),
    (error) => error instanceof TypeError && error.message.includes('needs a declared geometry resource'),
  );
  assert.throws(
    () =>
      defineTechniqueSchema({
        ...declaration(),
        render: { resource: 'atlas', geometry: { kind: 'quad', resource: 'missing', coordinates: 'unit-square' } },
      }),
    (error) => error instanceof TypeError && error.message.includes('undeclared resource "missing"'),
  );
  assert.throws(
    () =>
      defineTechniqueSchema({
        ...declaration(),
        render: { resource: 'atlas', geometry: { kind: 'quad', resource: 'atlas', coordinates: 'unit-square' } },
      }),
    (error) => error instanceof TypeError && error.message.includes('needs the geometry resource kind'),
  );
  assert.throws(
    () =>
      defineTechniqueSchema({
        ...declaration(),
        resources: { mesh: { kind: 'geometry', attributes: vertexInputs() } },
        render: { resource: 'mesh', geometry: { kind: 'quad', resource: 'mesh' } },
      }),
    (error) => error instanceof TypeError && error.message.includes('unit-square or em coordinates'),
  );
  assert.throws(
    () =>
      defineTechniqueSchema({
        ...declaration(),
        resources: { mesh: { kind: 'geometry', attributes: vertexInputs() } },
        render: { resource: 'mesh', geometry: { kind: 'quad', resource: 'mesh', coordinates: 'screen-pixels' } },
      }),
    (error) => error instanceof TypeError && error.message.includes('unit-square or em coordinates'),
  );
  assert.doesNotThrow(() =>
    defineTechniqueSchema({
      ...declaration(),
      resources: { mesh: { kind: 'geometry', attributes: vertexInputs() } },
      render: { resource: 'mesh', geometry: { kind: 'quad', resource: 'mesh', coordinates: 'em' } },
    }),
  );
});

test('portable resource declarations are closed and geometry owns its vertex-input contract', () => {
  assert.deepEqual(
    defineTechniqueSchema({
      ...declaration(),
      resources: { raw: { kind: 'buffer' } },
      render: { resource: 'raw', geometry: { kind: 'synthetic-quad' } },
    }).resources.raw,
    {
      kind: 'buffer',
    },
  );
  assert.throws(
    () => defineTechniqueSchema({ ...declaration(), resources: { raw: { kind: 'buffer', format: 'r8unorm' } } }),
    (error) => error instanceof TypeError && error.message.includes('declares kind and cardinality only'),
  );
  assert.throws(
    () =>
      defineTechniqueSchema({
        ...declaration(),
        resources: { mesh: { kind: 'geometry', attributes: vertexInputs(), format: 'vec2' } },
      }),
    (error) =>
      error instanceof TypeError &&
      error.message.includes('geometry resource "mesh" declares kind, attributes, and cardinality only'),
  );
  assert.deepEqual(
    defineTechniqueSchema({ ...declaration(), resources: { atlas: { kind: 'texture', format: 'rgba8unorm' } } })
      .resources.atlas,
    { kind: 'texture', format: 'rgba8unorm' },
  );
  assert.deepEqual(
    defineTechniqueSchema({
      ...declaration(),
      resources: { pages: { kind: 'texture-array', format: 'r8unorm' } },
      render: { resource: 'pages', geometry: { kind: 'synthetic-quad' } },
    }).resources.pages,
    { kind: 'texture-array', format: 'r8unorm' },
  );
  const group = defineTechniqueSchema({
    ...declaration(),
    resources: {
      page: {
        kind: 'group',
        cardinality: 'many',
        members: {
          curves: { kind: 'texture', format: 'rgba16float' },
          references: { kind: 'texture', format: 'r32uint' },
        },
      },
    },
    render: { resource: 'page', geometry: { kind: 'synthetic-quad' } },
  }).resources.page;
  assert.deepEqual(
    { ...group, members: { ...group.members } },
    {
      kind: 'group',
      cardinality: 'many',
      members: {
        curves: { kind: 'texture', format: 'rgba16float' },
        references: { kind: 'texture', format: 'r32uint' },
      },
    },
  );
  assert.throws(
    () =>
      defineTechniqueSchema({
        ...declaration(),
        resources: { page: { kind: 'group', members: { nested: { kind: 'group', members: {} } } } },
      }),
    /needs one leaf payload/,
  );
  assert.throws(
    () => defineTechniqueSchema({ ...declaration(), resources: { tint: { kind: 'example-tint', format: 'u8x4' } } }),
    /needs a portable resource kind/,
  );
  assert.throws(
    () => defineTechniqueSchema({ ...declaration(), resources: { atlas: { kind: '' } } }),
    (error) => error instanceof TypeError && error.message.includes('nonempty resource kind'),
  );
  assert.throws(
    () =>
      defineTechniqueSchema({
        ...declaration(),
        resources: { atlas: { kind: 'texture', format: 'rgba8unorm', sampleFormat: 'rgba8unorm' } },
      }),
    (error) => error instanceof TypeError && error.message.includes('declares kind, format, and cardinality only'),
  );
  assert.throws(
    () => defineTechniqueSchema({ ...declaration(), resources: { atlas: { kind: 'texture', format: '' } } }),
    (error) => error instanceof TypeError && error.message.includes('needs a supported texture format'),
  );
  assert.throws(
    () => defineTechniqueSchema({ ...declaration(), resources: { mesh: { kind: 'geometry', attributes: [] } } }),
    /needs vertex inputs/,
  );
  assert.throws(
    () =>
      defineTechniqueSchema({
        ...declaration(),
        resources: {
          mesh: {
            kind: 'geometry',
            attributes: [
              { semantic: 'position', componentType: 'f32', components: 2 },
              { semantic: 'position', componentType: 'f32', components: 2 },
            ],
          },
        },
      }),
    /repeats semantic "position"/,
  );
});

test('declaring a render contract leaves wire buffer derivation and the generated primitive enum untouched', () => {
  const withRender = defineTechniqueSchema(suppliedGeometryDeclaration());
  const withoutRender = defineTechniqueSchema(declaration());
  assert.deepEqual(schemaPolicyBuffers(withRender), schemaPolicyBuffers(withoutRender));
  assert.deepEqual(textShaperAbi.engine.primitiveKinds, {
    glyph: 1,
    decoration: 2,
    inlineObject: 3,
    clip: 4,
    policy: 5,
  });
});
