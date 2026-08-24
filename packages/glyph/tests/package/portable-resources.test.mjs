import assert from 'node:assert/strict';
import test from 'node:test';

import { assertPortableResource, portableResourceKinds, portableTopologies } from '../../dist/core.js';
import { normalizePortableResource } from '../../dist/core/portable-resources.js';
import { indexedQuadGeometry, instancedQuadGeometry } from '../support/portable-geometry.mjs';

function mutate(geometry, patch) {
  const next = structuredClone(geometry);
  patch(next);
  return next;
}

test('the reserved portable kinds and topologies are the frozen closed sets', () => {
  assert.deepEqual([...portableResourceKinds], ['buffer', 'texture', 'texture-array', 'geometry']);
  assert.deepEqual([...portableTopologies], ['triangle-list', 'triangle-strip']);
});

test('valid buffer, texture, and geometry payloads pass their reserved declared kind', () => {
  assertPortableResource('buffer', 'table', { kind: 'buffer', bytes: new Uint8Array(6), stride: 2 });
  assertPortableResource('buffer', 'table', { kind: 'buffer', bytes: new Uint8Array(0) });
  assertPortableResource('texture', 'page', {
    kind: 'texture',
    format: 'r8unorm',
    width: 4,
    height: 4,
    bytes: new Uint8Array(16),
  });
  assertPortableResource('texture-array', 'pages', {
    kind: 'texture-array',
    format: 'r8unorm',
    width: 4,
    height: 4,
    layers: 2,
    bytes: new Uint8Array(32),
  });
  assertPortableResource('geometry', 'mesh', indexedQuadGeometry());
  assertPortableResource('geometry', 'mesh', instancedQuadGeometry());
  // Technique-private kinds keep an opaque payload contract.
  assertPortableResource('glyph-example-colors', 'tint', { anything: ['goes', true] });
});

test('buffer payloads need byte arrays and whole record strides', () => {
  const name = 'table';
  assert.throws(
    () => assertPortableResource('buffer', name, { kind: 'buffer', bytes: [1, 2, 3] }),
    (error) => error instanceof TypeError && error.message.includes(`"${name}"`),
  );
  assert.throws(
    () => assertPortableResource('buffer', name, { kind: 'buffer', bytes: new Uint8Array(7), stride: 0 }),
    (error) => error instanceof RangeError && error.message.includes('positive record stride'),
  );
  assert.throws(
    () => assertPortableResource('buffer', name, { kind: 'buffer', bytes: new Uint8Array(7), stride: 2 }),
    (error) => error instanceof RangeError && error.message.includes('not whole 2-byte records'),
  );
});

test('texture payloads need a format and positive dimensions', () => {
  const base = () => ({ kind: 'texture', format: 'rgba8unorm', width: 2, height: 2, bytes: new Uint8Array(16) });
  assert.throws(
    () => assertPortableResource('texture', 'page', { ...base(), format: '' }),
    (error) => error instanceof TypeError && error.message.includes('nonempty sample format'),
  );
  assert.throws(
    () =>
      assertPortableResource('texture-array', 'pages', {
        kind: 'texture-array',
        format: 'r8unorm',
        width: 2,
        height: 2,
        layers: 0,
        bytes: new Uint8Array(4),
      }),
    (error) => error instanceof RangeError && error.message.includes('positive integer layer count'),
  );
  for (const dimension of ['width', 'height']) {
    assert.throws(
      () => assertPortableResource('texture', 'page', { ...base(), [dimension]: 0 }),
      (error) => error instanceof RangeError && error.message.includes(`positive integer ${dimension}`),
    );
  }
  assert.throws(
    () => assertPortableResource('texture', 'page', { ...base(), bytes: undefined }),
    (error) => error instanceof TypeError && error.message.includes('Uint8Array bytes'),
  );
  assert.throws(
    () => assertPortableResource('texture', 'page', base(), 'r16float'),
    (error) => error instanceof TypeError && error.message.includes('does not match declared format'),
  );
});

test('retained payloads must declare the reserved payload kind of their resource', () => {
  assert.throws(
    () => assertPortableResource('texture', 'page', indexedQuadGeometry()),
    (error) => error instanceof TypeError && error.message.includes('wrong payload kind'),
  );
  assert.throws(
    () => assertPortableResource('geometry', 'mesh', null),
    (error) => error instanceof TypeError && error.message.includes('needs a payload object'),
  );
  assert.throws(
    () => assertPortableResource('geometry', 'mesh', []),
    (error) => error instanceof TypeError && error.message.includes('needs a payload object'),
  );
});

test('geometry views and accessors must stay inside the immutable bytes', () => {
  const quad = indexedQuadGeometry();
  assert.throws(
    () =>
      assertPortableResource(
        'geometry',
        'mesh',
        mutate(quad, (g) => g.views.splice(0, g.views.length)),
      ),
    (error) => error instanceof TypeError && error.message.includes('at least one buffer view'),
  );
  assert.throws(
    () =>
      assertPortableResource(
        'geometry',
        'mesh',
        mutate(quad, (g) => (g.accessors[1].offset = 2)),
      ),
    (error) => error instanceof RangeError && error.message.includes('is not aligned to 4 bytes'),
  );
  assert.throws(
    () =>
      assertPortableResource(
        'geometry',
        'mesh',
        mutate(quad, (g) => (g.views[1].length = 13)),
      ),
    (error) => error instanceof RangeError && error.message.includes('buffer view 1 exceeds its 76 bytes'),
  );
  assert.throws(
    () =>
      assertPortableResource(
        'geometry',
        'mesh',
        mutate(instancedQuadGeometry(), (g) => (g.instances = { source: 'fixed', count: 6 })),
      ),
    (error) => error instanceof RangeError && error.message.includes('exceeds 5 instance elements'),
  );
  assert.throws(
    () =>
      assertPortableResource(
        'geometry',
        'mesh',
        mutate(quad, (g) => g.accessors.splice(0, g.accessors.length)),
      ),
    (error) => error instanceof TypeError && error.message.includes('at least one accessor'),
  );
  assert.throws(
    () =>
      assertPortableResource(
        'geometry',
        'mesh',
        mutate(quad, (g) => (g.accessors[0].componentType = 'i64')),
      ),
    (error) => error instanceof TypeError && error.message.includes('accessor 0 needs an f32'),
  );
  assert.throws(
    () =>
      assertPortableResource(
        'geometry',
        'mesh',
        mutate(quad, (g) => (g.accessors[0].components = 5)),
      ),
    (error) => error instanceof RangeError && error.message.includes('accessor 0 needs one to four components'),
  );
  assert.throws(
    () =>
      assertPortableResource(
        'geometry',
        'mesh',
        mutate(quad, (g) => (g.accessors[0].view = 9)),
      ),
    (error) => error instanceof RangeError && error.message.includes('accessor 0 names a buffer view outside'),
  );
  assert.throws(
    () =>
      assertPortableResource(
        'geometry',
        'mesh',
        mutate(quad, (g) => (g.accessors[0].count = 9)),
      ),
    (error) => error instanceof RangeError && error.message.includes('reads past its buffer view'),
  );
  assert.throws(
    () =>
      assertPortableResource(
        'geometry',
        'mesh',
        mutate(quad, (g) => (g.accessors[1].offset = -4)),
      ),
    (error) => error instanceof RangeError && error.message.includes('accessor 1 needs a nonnegative byte offset'),
  );
  assert.doesNotThrow(() =>
    assertPortableResource(
      'geometry',
      'mesh',
      mutate(quad, (g) => delete g.accessors[1].offset),
    ),
  );
});

test('geometry attributes need a position and consistent counts per rate', () => {
  const quad = indexedQuadGeometry();
  assert.throws(
    () =>
      assertPortableResource(
        'geometry',
        'mesh',
        mutate(quad, (g) => (g.attributes[1].semantic = 'position')),
      ),
    (error) => error instanceof TypeError && error.message.includes('repeats semantic "position"'),
  );
  assert.throws(
    () =>
      assertPortableResource(
        'geometry',
        'mesh',
        mutate(quad, (g) => (g.attributes = [{ semantic: '', accessor: 0 }])),
      ),
    (error) => error instanceof TypeError && error.message.includes('attribute 0 needs a nonempty semantic'),
  );
  assert.throws(
    () =>
      assertPortableResource(
        'geometry',
        'mesh',
        mutate(quad, (g) => (g.attributes = [{ semantic: 'uv', accessor: 1 }])),
      ),
    (error) => error instanceof TypeError && error.message.includes('needs a position attribute'),
  );
  assert.throws(
    () =>
      assertPortableResource(
        'geometry',
        'mesh',
        mutate(quad, (g) => (g.attributes[1] = { semantic: 'uv', accessor: 9 })),
      ),
    (error) => error instanceof RangeError && error.message.includes('attribute 1 names an accessor outside'),
  );
  assert.throws(
    () =>
      assertPortableResource(
        'geometry',
        'mesh',
        mutate(quad, (g) => (g.attributes[1].rate = 'per-glyph')),
      ),
    (error) => error instanceof TypeError && error.message.includes('attribute 1 needs a vertex or instance rate'),
  );
  assert.throws(
    () =>
      assertPortableResource(
        'geometry',
        'mesh',
        mutate(quad, (g) => (g.attributes[0].rate = 'instance')),
      ),
    (error) => error instanceof TypeError && error.message.includes('position cannot use the instance rate'),
  );
  assert.throws(
    () =>
      assertPortableResource(
        'geometry',
        'mesh',
        mutate(quad, (g) => (g.accessors[1].count = 3)),
      ),
    (error) =>
      error instanceof RangeError && error.message.includes('disagrees with the other vertex-rate accessor counts (4)'),
  );
  const instanced = instancedQuadGeometry();
  assert.throws(
    () =>
      assertPortableResource(
        'geometry',
        'mesh',
        mutate(instanced, (g) => {
          g.accessors.push({ componentType: 'u8', components: 1, view: 0, offset: 0, count: 7 });
          g.attributes.push({ semantic: 'shade', accessor: 4, rate: 'instance' });
        }),
      ),
    (error) =>
      error instanceof RangeError &&
      error.message.includes('disagrees with the other instance-rate accessor counts (5)'),
  );
});

test('indices must be scalar integers and draw ranges must fit the addressed stream', () => {
  const quad = indexedQuadGeometry();
  // Shrink each mutated index accessor to three elements so only the checked
  // invariant — integer component type, then scalar layout — can fire.
  assert.throws(
    () =>
      assertPortableResource(
        'geometry',
        'mesh',
        mutate(quad, (g) => (g.accessors[2] = { ...g.accessors[2], componentType: 'f32', count: 3 })),
      ),
    (error) => error instanceof TypeError && error.message.includes('indices need a u16 or u32 integer component type'),
  );
  for (const componentType of ['i16', 'u8']) {
    assert.throws(
      () =>
        assertPortableResource(
          'geometry',
          'mesh',
          mutate(quad, (g) => (g.accessors[2] = { ...g.accessors[2], componentType })),
        ),
      (error) =>
        error instanceof TypeError && error.message.includes('indices need a u16 or u32 integer component type'),
    );
  }
  assert.throws(
    () =>
      assertPortableResource(
        'geometry',
        'mesh',
        mutate(quad, (g) => (g.accessors[2] = { ...g.accessors[2], components: 2, count: 3 })),
      ),
    (error) => error instanceof RangeError && error.message.includes('indices need scalar indices'),
  );
  assert.throws(
    () =>
      assertPortableResource(
        'geometry',
        'mesh',
        mutate(quad, (g) => (g.indices = { accessor: 9 })),
      ),
    (error) => error instanceof RangeError && error.message.includes('indices name an accessor outside'),
  );
  assert.throws(
    () =>
      assertPortableResource(
        'geometry',
        'mesh',
        mutate(quad, (g) => {
          const indexBytes = new Uint16Array(g.bytes.buffer, g.bytes.byteOffset + 64, 6);
          indexBytes[0] = 4;
        }),
      ),
    (error) => error instanceof RangeError && error.message.includes('outside 4 vertices'),
  );

  const openQuad = mutate(quad, (g) => delete g.indices);
  openQuad.topology = 'triangle-strip';
  assert.throws(
    () =>
      assertPortableResource(
        'geometry',
        'mesh',
        mutate(openQuad, (g) => (g.drawRange = { start: 0, count: 5 })),
      ),
    (error) =>
      error instanceof RangeError && error.message.includes('vertex draw range exceeds the 4 available vertices'),
  );
  assert.throws(
    () =>
      assertPortableResource(
        'geometry',
        'mesh',
        mutate(quad, (g) => (g.drawRange = { start: 2, count: 5 })),
      ),
    (error) =>
      error instanceof RangeError && error.message.includes('index draw range exceeds the 6 available indices'),
  );
  assert.throws(
    () =>
      assertPortableResource(
        'geometry',
        'mesh',
        mutate(quad, (g) => (g.drawRange = { start: 0, count: 0 })),
      ),
    (error) => error instanceof RangeError && error.message.includes('cannot be empty'),
  );
  assert.throws(
    () =>
      assertPortableResource(
        'geometry',
        'mesh',
        mutate(quad, (g) => (g.drawRange = { start: 1, count: 5 })),
      ),
    (error) => error instanceof RangeError && error.message.includes('complete triangle-list primitives'),
  );
  assert.throws(
    () =>
      assertPortableResource(
        'geometry',
        'mesh',
        mutate(openQuad, (g) => (g.drawRange = { start: 2, count: 2 })),
      ),
    (error) => error instanceof RangeError && error.message.includes('complete triangle-strip primitives'),
  );
  assert.doesNotThrow(() =>
    assertPortableResource(
      'geometry',
      'mesh',
      mutate(quad, (g) => (g.drawRange = { start: 0, count: 6 })),
    ),
  );
  assert.doesNotThrow(() =>
    assertPortableResource(
      'geometry',
      'mesh',
      mutate(openQuad, (g) => (g.drawRange = { start: 0, count: 4 })),
    ),
  );
});

test('normalizing a retained payload owns bytes and structural metadata', () => {
  const source = indexedQuadGeometry();
  source.views[0].foreign = { mutable: true };
  const normalized = normalizePortableResource('geometry', 'mesh', source);
  source.bytes[0] = 255;
  source.accessors[0].count = 1;
  assert.notEqual(normalized.bytes, source.bytes);
  assert.equal(normalized.bytes[0], 0);
  assert.equal(normalized.accessors[0].count, 4);
  assert.equal(normalized.views[0].foreign, undefined);
  assert(Object.isFrozen(normalized));
  assert(Object.isFrozen(normalized.accessors));
});

test('instance addressing accepts record-driven counts or a positive fixed count', () => {
  const quad = indexedQuadGeometry();
  assert.throws(
    () =>
      assertPortableResource(
        'geometry',
        'mesh',
        mutate(quad, (g) => (g.instances = { source: 'fixed', count: 0 })),
      ),
    (error) => error instanceof RangeError && error.message.includes('positive fixed instance count'),
  );
  assert.throws(
    () =>
      assertPortableResource(
        'geometry',
        'mesh',
        mutate(quad, (g) => (g.instances = { source: 'records-plus' })),
      ),
    (error) => error instanceof TypeError && error.message.includes('records or fixed source'),
  );
  assert.doesNotThrow(() =>
    assertPortableResource(
      'geometry',
      'mesh',
      mutate(quad, (g) => (g.instances = { source: 'records' })),
    ),
  );
  assert.doesNotThrow(() =>
    assertPortableResource(
      'geometry',
      'mesh',
      mutate(quad, (g) => (g.instances = { source: 'fixed', count: 1 })),
    ),
  );
  assert.doesNotThrow(() =>
    assertPortableResource(
      'geometry',
      'mesh',
      mutate(instancedQuadGeometry(), (g) => (g.instances = { source: 'fixed', count: 5 })),
    ),
  );
});
