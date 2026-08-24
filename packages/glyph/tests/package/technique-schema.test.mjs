import assert from 'node:assert/strict';
import test from 'node:test';

import {
  defineTechniqueSchema,
  floatBuffers,
  schemaPolicyBuffers,
  textShaperAbi,
  u32Buffers,
} from '../../dist/core.js';
import { bitmapSchema } from '@pmndrs/glyph/raster/bitmap';
import { msdfSchema } from '@pmndrs/glyph/raster/msdf';
import { slugSchema } from '@pmndrs/glyph/raster/slug';

function declaration() {
  return {
    technique: 'test.technique',
    scope: 'glyph',
    binding: { f32: ['a', 'b'], u32: ['c'] },
    buffers: {
      origin: { id: 1, scalar: 'f32', lanes: ['x', 'y'] },
      flags: { id: 2, scalar: 'u32', lanes: ['flags'] },
    },
    resources: { atlas: { kind: 'texture' } },
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
    buffers: { origin: { id: 1, scalar: 'f32', lanes: ['x', 'y'] } },
  };
  assert.throws(() => defineTechniqueSchema(input), TypeError);
  assert.equal(Object.isFrozen(input.buffers), false);
  assert.equal(Object.isFrozen(input.buffers.origin), false);
  assert.equal(Object.isFrozen(input.buffers.origin.lanes), false);
});

test('schemas own their data: caller accessors cannot change validated widths', () => {
  let reads = 0;
  const accessorInput = {
    technique: 'test.accessor',
    scope: 'glyph',
    binding: { f32: ['a'] },
    buffers: {
      sneaky: {
        id: 1,
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
  buffers.origin = { id: 1, scalar: 'f32', lanes: ['x', 'y'] };
  assert.throws(
    () => defineTechniqueSchema({ ...declaration(), buffers, glyphOrigin: { buffer: '__proto__' } }),
    (error) => error instanceof TypeError && error.message.includes('undeclared buffer'),
  );

  const resources = Object.create(null);
  resources.atlas = { kind: 'texture' };
  assert.throws(
    () =>
      defineTechniqueSchema({
        ...declaration(),
        resources,
        render: { geometry: { kind: 'quad', resource: '__proto__', coordinates: 'unit-square' } },
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
        buffers: { thin: { id: 1, scalar: 'f32', lanes: ['x'] } },
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

test('schemaPolicyBuffers derives exactly the hand-rolled wire buffer list', () => {
  assert.deepEqual(schemaPolicyBuffers(bitmapSchema), [...floatBuffers([2, 2, 2, 2, 4]), ...u32Buffers([1], 6)]);
  assert.deepEqual(schemaPolicyBuffers(msdfSchema), floatBuffers([4, 4, 4, 4, 4, 4, 4]));
  assert.deepEqual(schemaPolicyBuffers(slugSchema), [...floatBuffers([4, 4, 4, 4, 4]), ...u32Buffers([4, 4], 6)]);
  const derived = schemaPolicyBuffers(defineTechniqueSchema(declaration()));
  assert.deepEqual(derived, [
    { id: 1, scalar: textShaperAbi.policy.scalarTypes.f32, vectorWidth: 2 },
    { id: 2, scalar: textShaperAbi.policy.scalarTypes.u32, vectorWidth: 1 },
  ]);
});

function suppliedGeometryDeclaration(kind = 'quad') {
  return {
    ...declaration(),
    resources: {
      ...declaration().resources,
      mesh: { kind: 'geometry' },
    },
    render: { geometry: { kind, resource: 'mesh', coordinates: 'unit-square' } },
  };
}

test('the portable render contract freezes and accepts synthetic-quad and supplied geometry', () => {
  const implicit = defineTechniqueSchema({
    ...declaration(),
    render: { geometry: { kind: 'synthetic-quad' } },
  });
  assert.ok(Object.isFrozen(implicit.render), 'render');
  assert.ok(Object.isFrozen(implicit.render.geometry), 'geometry');
  assert.deepEqual(implicit.render.geometry, { kind: 'synthetic-quad' });

  const quad = defineTechniqueSchema(suppliedGeometryDeclaration());
  assert.deepEqual(quad.render.geometry, { kind: 'quad', resource: 'mesh', coordinates: 'unit-square' });
  // Extensible supplied kinds such as hull follow the same declared-resource rule.
  const hull = defineTechniqueSchema(suppliedGeometryDeclaration('hull'));
  assert.equal(hull.render.geometry.kind, 'hull');
});

test('synthetic-quad declares no resource and no coordinate convention', () => {
  assert.throws(
    () =>
      defineTechniqueSchema({
        ...declaration(),
        render: { geometry: { kind: 'synthetic-quad', resource: 'atlas' } },
      }),
    TypeError,
  );
  assert.throws(
    () =>
      defineTechniqueSchema({
        ...declaration(),
        render: { geometry: { kind: 'synthetic-quad', coordinates: 'unit-square' } },
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

test('supplied geometry must name a declared geometry resource and state its coordinate convention', () => {
  assert.throws(
    () =>
      defineTechniqueSchema({
        ...declaration(),
        resources: { mesh: { kind: 'geometry' } },
        render: { geometry: { kind: 'quad', coordinates: 'unit-square' } },
      }),
    (error) => error instanceof TypeError && error.message.includes('needs a declared geometry resource'),
  );
  assert.throws(
    () =>
      defineTechniqueSchema({
        ...declaration(),
        render: { geometry: { kind: 'quad', resource: 'missing', coordinates: 'unit-square' } },
      }),
    (error) => error instanceof TypeError && error.message.includes('undeclared resource "missing"'),
  );
  assert.throws(
    () =>
      defineTechniqueSchema({
        ...declaration(),
        render: { geometry: { kind: 'quad', resource: 'atlas', coordinates: 'unit-square' } },
      }),
    (error) => error instanceof TypeError && error.message.includes('needs the geometry resource kind'),
  );
  assert.throws(
    () =>
      defineTechniqueSchema({
        ...declaration(),
        resources: { mesh: { kind: 'geometry' } },
        render: { geometry: { kind: 'quad', resource: 'mesh' } },
      }),
    (error) => error instanceof TypeError && error.message.includes('unit-square or em coordinates'),
  );
  assert.throws(
    () =>
      defineTechniqueSchema({
        ...declaration(),
        resources: { mesh: { kind: 'geometry' } },
        render: { geometry: { kind: 'quad', resource: 'mesh', coordinates: 'screen-pixels' } },
      }),
    (error) => error instanceof TypeError && error.message.includes('unit-square or em coordinates'),
  );
  assert.doesNotThrow(() =>
    defineTechniqueSchema({
      ...declaration(),
      resources: { mesh: { kind: 'geometry' } },
      render: { geometry: { kind: 'quad', resource: 'mesh', coordinates: 'em' } },
    }),
  );
});

test('reserved resource kinds declare only their own fields; private kinds keep kind plus optional format', () => {
  assert.deepEqual(defineTechniqueSchema({ ...declaration(), resources: { raw: { kind: 'buffer' } } }).resources.raw, {
    kind: 'buffer',
  });
  assert.throws(
    () => defineTechniqueSchema({ ...declaration(), resources: { raw: { kind: 'buffer', format: 'r8unorm' } } }),
    (error) => error instanceof TypeError && error.message.includes('buffer resource "raw" declares only its kind'),
  );
  assert.throws(
    () => defineTechniqueSchema({ ...declaration(), resources: { mesh: { kind: 'geometry', format: 'vec2' } } }),
    (error) => error instanceof TypeError && error.message.includes('geometry resource "mesh" declares only its kind'),
  );
  assert.deepEqual(
    defineTechniqueSchema({ ...declaration(), resources: { atlas: { kind: 'texture', format: 'rgba8unorm' } } })
      .resources.atlas,
    { kind: 'texture', format: 'rgba8unorm' },
  );
  assert.deepEqual(
    defineTechniqueSchema({ ...declaration(), resources: { tint: { kind: 'example-tint', format: 'u8x4' } } }).resources
      .tint,
    { kind: 'example-tint', format: 'u8x4' },
  );
  assert.throws(
    () => defineTechniqueSchema({ ...declaration(), resources: { atlas: { kind: '' } } }),
    (error) => error instanceof TypeError && error.message.includes('nonempty resource kind'),
  );
  assert.throws(
    () =>
      defineTechniqueSchema({
        ...declaration(),
        resources: { atlas: { kind: 'texture', sampleFormat: 'rgba8unorm' } },
      }),
    (error) => error instanceof TypeError && error.message.includes('declares only kind and format'),
  );
  assert.throws(
    () => defineTechniqueSchema({ ...declaration(), resources: { atlas: { kind: 'texture', format: '' } } }),
    (error) => error instanceof TypeError && error.message.includes('needs a nonempty format'),
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
