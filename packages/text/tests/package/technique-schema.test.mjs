import assert from 'node:assert/strict';
import test from 'node:test';

import { defineTechniqueSchema, floatBuffers, schemaPolicyBuffers, textShaperAbi, u32Buffers } from '@pmndrs/text/core';
import { bitmapSchema } from '@pmndrs/text/raster/bitmap';
import { msdfSchema } from '@pmndrs/text/raster/msdf';
import { slugSchema } from '@pmndrs/text/raster/slug';

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
