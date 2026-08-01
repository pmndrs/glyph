import assert from 'node:assert/strict';
import test from 'node:test';

import { Text, lazyRaster, useFont } from '@pmndrs/text/react';

test('the React subpath exposes its React 19 runtime through native ESM', async () => {
  assert.equal(typeof Text, 'function');
  assert.equal(typeof useFont, 'function');
  assert.equal(typeof useFont.preload, 'function');
  assert.equal(typeof useFont.clear, 'function');
  assert.equal(typeof lazyRaster, 'function');

  let publish;
  const imported = new Promise((resolve) => {
    publish = resolve;
  });
  const deferred = lazyRaster(() => imported);
  let suspended;
  try {
    void deferred.kind;
  } catch (error) {
    suspended = error;
  }
  assert.ok(suspended instanceof Promise);

  publish({
    kind: 'test',
    extension: 'PMNDRS_test',
    version: 0,
    descriptor: () => null,
    decode: async () => null,
    prepare: async () => undefined,
    stageBatch: () => {
      throw new Error('not used');
    },
    dispose: () => undefined,
  });
  await suspended;
  assert.equal(deferred.kind, 'test');
});
