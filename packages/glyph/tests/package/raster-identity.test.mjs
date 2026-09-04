import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalJson, deriveRasterKey } from '../../dist/internal/raster-identity.js';
import { fingerprint128, fingerprintDomain } from '../../dist/internal/fingerprint.js';

test('canonicalizes JSON according to RFC 8785 member and number rules', () => {
  const value = {
    z: -0,
    a: [1e30, 4.5, true, null, '\u20ac$\u000f\nA\'B"\\\"/'],
    nested: { b: 2, a: 1 },
  };

  assert.equal(
    canonicalJson(value),
    '{"a":[1e+30,4.5,true,null,"€$\\u000f\\nA\'B\\\"\\\\\\\"/"],"nested":{"a":1,"b":2},"z":0}',
  );
  assert.equal(canonicalJson({ '\ue000': 2, '😀': 1 }), '{"😀":1,"":2}');
});

test('rejects inputs outside the I-JSON domain before hashing', () => {
  assert.throws(() => canonicalJson({ value: Number.NaN }), /finite numbers/);
  assert.throws(() => canonicalJson({ value: Number.POSITIVE_INFINITY }), /finite numbers/);
  assert.throws(() => canonicalJson({ value: '\ud800' }), /unpaired high surrogate/);
  assert.throws(() => canonicalJson({ '\ud800': true }), /unpaired high surrogate/);
  assert.throws(() => canonicalJson({ value: undefined }), /not a JSON value/);
  assert.throws(() => canonicalJson(new Date(0)), /plain JSON objects/);
  assert.throws(() => canonicalJson(new Map()), /plain JSON objects/);

  const cycle = {};
  cycle.self = cycle;
  assert.throws(() => canonicalJson(cycle), /must not contain a cycle/);

  let nested = null;
  for (let depth = 0; depth <= 256; depth += 1) nested = [nested];
  assert.throws(() => canonicalJson(nested), /maximum JSON nesting depth/);
});

test('allows repeated non-cyclic references while canonicalizing their values independently', () => {
  const shared = { value: 1 };
  assert.equal(canonicalJson({ left: shared, right: shared }), '{"left":{"value":1},"right":{"value":1}}');
});

test('derives the raster key from the exact canonical contract object', async () => {
  const contract = {
    descriptor: { generatorVersion: '0.0.0', strikes: [16, 32] },
    extension: 'PMNDRS_font_bitmap',
    kind: 'bitmap',
    version: 0,
  };
  const expected = fingerprint128(new TextEncoder().encode(canonicalJson(contract)), fingerprintDomain.descriptor);

  assert.equal(await deriveRasterKey(contract), expected);
  assert.match(expected, /^[0-9a-f]{32}$/);
});
