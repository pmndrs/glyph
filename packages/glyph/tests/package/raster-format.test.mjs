import assert from 'node:assert/strict';
import test from 'node:test';

import { defineRasterResourceId, defineRasterFormat } from '@pmndrs/glyph';

function format(id) {
  return defineRasterFormat({
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

test('portable raster format definitions retain their public identity', () => {
  const value = format('test.format');
  assert.equal(value.id, 'test.format');
  assert.equal(value.kind, 'test');
  assert.equal(Object.isFrozen(value), true);
});

test('defined formats own a frozen snapshot of their associated callbacks', () => {
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
  const value = defineRasterFormat(source);
  source.textEffects.push('shadow');
  source.descriptor = () => ({ version: 2 });
  assert.deepEqual(value.descriptor(), { version: 1 });
  assert.deepEqual(value.textEffects, ['outline']);
  assert.equal(Object.isFrozen(value.textEffects), true);
});

test('portable raster identities reject empty strings at their definition boundary', () => {
  assert.throws(() => format(''), /raster format ID must not be empty/);
  assert.throws(() => defineRasterResourceId(''), /raster resource ID must not be empty/);
});

test('portable raster formats reject unknown or duplicate text effects', () => {
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
  assert.throws(() => defineRasterFormat({ ...source, textEffects: ['glow'] }), /not supported/);
  assert.throws(
    () => defineRasterFormat({ ...source, textEffects: ['outline', 'outline'] }),
    /must not contain duplicates/,
  );
});
