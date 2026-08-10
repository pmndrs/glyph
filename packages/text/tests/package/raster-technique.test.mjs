import assert from 'node:assert/strict';
import test from 'node:test';

import { defineRasterResourceId, defineRasterTechnique } from '@pmndrs/text';

function technique(id) {
  return defineRasterTechnique({
    id,
    kind: 'test',
    extension: 'TEST_raster',
    version: 0,
    descriptor() {
      return {};
    },
    async decode() {
      return {};
    },
    dispose() {},
  });
}

test('portable raster technique definitions retain their public identity', () => {
  const value = technique('test.technique');
  assert.equal(value.id, 'test.technique');
  assert.equal(value.kind, 'test');
});

test('portable raster identities reject empty strings at their definition boundary', () => {
  assert.throws(() => technique(''), /raster technique ID must not be empty/);
  assert.throws(() => defineRasterResourceId(''), /raster resource ID must not be empty/);
});
