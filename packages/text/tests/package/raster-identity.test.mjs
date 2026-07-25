import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import { canonicalJson, deriveRasterKey } from '../../dist/internal/raster-identity.js'

test('canonicalizes JSON according to RFC 8785 member and number rules', () => {
  const value = {
    z: -0,
    a: [1e30, 4.5, true, null, '\u20ac$\u000f\nA\'B\"\\\"/'],
    nested: { b: 2, a: 1 },
  }

  assert.equal(
    canonicalJson(value),
    '{"a":[1e+30,4.5,true,null,"€$\\u000f\\nA\'B\\\"\\\\\\\"/"],"nested":{"a":1,"b":2},"z":0}',
  )
})

test('rejects inputs outside the I-JSON domain before hashing', () => {
  assert.throws(() => canonicalJson({ value: Number.NaN }), /finite numbers/)
  assert.throws(() => canonicalJson({ value: Number.POSITIVE_INFINITY }), /finite numbers/)
  assert.throws(() => canonicalJson({ value: '\ud800' }), /unpaired high surrogate/)
  assert.throws(() => canonicalJson({ value: undefined }), /not a JSON value/)
})

test('derives the raster key from the exact canonical contract object', async () => {
  const contract = {
    descriptor: { generatorVersion: '0.0.0', strikes: [16, 32] },
    extension: 'PMNDRS_font_bitmap',
    kind: 'bitmap',
    version: 0,
  }
  const expected = createHash('sha256').update(canonicalJson(contract)).digest('hex')

  assert.equal(await deriveRasterKey(contract), expected)
  assert.match(expected, /^[0-9a-f]{64}$/)
})
