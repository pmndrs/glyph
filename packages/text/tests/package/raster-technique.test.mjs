import assert from 'node:assert/strict';
import test from 'node:test';

import { defineRasterResourceId, defineRasterTechnique } from '@pmndrs/text';

function technique(id) {
  const resource = defineRasterResourceId('test/page/0');
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
    select() {
      return { resource, pipelineVariant: 0, binding: {} };
    },
    createStorage(capacity) {
      return { glyphs: new Uint16Array(capacity) };
    },
    writeStorage() {},
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
