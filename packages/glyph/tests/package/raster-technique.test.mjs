import assert from 'node:assert/strict';
import test from 'node:test';

import { defineRasterResourceId, defineRasterTechnique } from '@pmndrs/glyph';

function technique(id) {
  return defineRasterTechnique({
    id,
    kind: 'test',
    extension: 'TEST_raster',
    version: 0,
    textEffects: [],
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
  assert.equal(Object.isFrozen(value), true);
});

test('defined techniques own a frozen snapshot of their associated callbacks', () => {
  const source = {
    id: 'test.snapshot',
    kind: 'test',
    extension: 'TEST_raster',
    version: 0,
    textEffects: ['outline'],
    descriptor: () => ({ version: 1 }),
    async decode() {
      return {};
    },
    dispose() {},
  };
  const value = defineRasterTechnique(source);
  source.textEffects.push('shadow');
  source.descriptor = () => ({ version: 2 });
  assert.deepEqual(value.descriptor(), { version: 1 });
  assert.deepEqual(value.textEffects, ['outline']);
  assert.equal(Object.isFrozen(value.textEffects), true);
});

test('portable raster identities reject empty strings at their definition boundary', () => {
  assert.throws(() => technique(''), /raster technique ID must not be empty/);
  assert.throws(() => defineRasterResourceId(''), /raster resource ID must not be empty/);
});

test('portable raster techniques reject unknown or duplicate text effects', () => {
  const source = {
    id: 'test.effects',
    kind: 'test',
    extension: 'TEST_raster',
    version: 0,
    descriptor: () => ({}),
    async decode() {
      return {};
    },
    dispose() {},
  };
  assert.throws(() => defineRasterTechnique({ ...source, textEffects: ['glow'] }), /not supported/);
  assert.throws(
    () => defineRasterTechnique({ ...source, textEffects: ['outline', 'outline'] }),
    /must not contain duplicates/,
  );
});
