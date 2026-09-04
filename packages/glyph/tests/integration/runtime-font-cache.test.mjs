import assert from 'node:assert/strict';
import test from 'node:test';

import { createCache } from '../../dist/internal/runtime-font-cache.js';

test('runtime GLB cache keys include source, normalized ranges, and exact raster plans', async () => {
  const storage = new MemoryCacheStorage();
  const cache = createCache(storage, 'https://assets.test', () => 1_000);
  const source = '1'.repeat(32);
  const request = runtimeRequest();
  const key = await cache.key(source, request);

  assert.equal(await cache.key(source, runtimeRequest()), key);
  assert.notEqual(await cache.key('2'.repeat(32), request), key);
  assert.notEqual(await cache.key(source, { ...request, unicodeRanges: [{ start: 0x20, end: 0x7f }] }), key);
  assert.notEqual(await cache.key(source, { ...request, rasters: [] }), key);
});

test('runtime GLB cache returns exact bytes and honors the source response expiration', async () => {
  const storage = new MemoryCacheStorage();
  let now = 1_000;
  const cache = createCache(storage, 'https://assets.test', () => now);
  const artifact = {
    id: 'font-fixture',
    bytes: new Uint8Array([4, 5, 6]),
    fingerprint: '3'.repeat(32),
  };
  await cache.put('fixture', artifact, 2_000);
  assert.deepEqual(await cache.match('fixture'), artifact);

  now = 2_000;
  assert.equal(await cache.match('fixture'), undefined);

  await cache.put('already-expired', artifact, now);
  assert.equal(await cache.match('already-expired'), undefined);
  assert.equal(storage.cache.responses.size, 0);
});

test('runtime GLB cache failure remains a transparent miss', async () => {
  const cache = createCache(new ThrowingCacheStorage(), 'https://assets.test', () => 1_000);
  assert.equal(await cache.match('fixture'), undefined);
  await assert.doesNotReject(
    cache.put('fixture', { id: 'font-fixture', bytes: new Uint8Array([1]), fingerprint: 'b'.repeat(32) }, 2_000),
  );
});

function runtimeRequest() {
  return {
    type: 'bake-font-v0',
    id: 1,
    source: new ArrayBuffer(0),
    font: { formatVersion: 0, fontFaceIndex: 0 },
    unicodeRanges: [{ start: 0x20, end: 0x7e }],
    rasters: [
      {
        kind: 'bitmap',
        extension: 'PMNDRS_font_bitmap',
        version: 0,
        rasterKey: 'c'.repeat(32),
        descriptor: { generatorVersion: '0.0.0', strikes: [16] },
      },
    ],
  };
}

class MemoryCacheStorage {
  cache = new MemoryCache();

  async open() {
    return this.cache;
  }
}

class ThrowingCacheStorage {
  async open() {
    throw new DOMException('quota', 'QuotaExceededError');
  }
}

class MemoryCache {
  responses = new Map();

  async match(request) {
    return this.responses.get(request.url)?.clone();
  }

  async put(request, response) {
    this.responses.set(request.url, response.clone());
  }

  async delete(request) {
    return this.responses.delete(request.url);
  }

  async keys() {
    return [...this.responses.keys()].map((url) => new Request(url));
  }
}
