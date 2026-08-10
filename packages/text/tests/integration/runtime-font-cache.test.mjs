import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { createCache } from '../../dist/internal/runtime-font-cache.js';

test('runtime GLB cache keys include source, normalized ranges, and exact raster plans', async () => {
  const storage = new MemoryCacheStorage();
  const cache = createCache(storage, 'https://assets.test', () => 1_000);
  const source = new Uint8Array([1, 2, 3]);
  const request = runtimeRequest();
  const key = await cache.key(source, request);

  assert.equal(await cache.key(source, runtimeRequest()), key);
  assert.notEqual(await cache.key(new Uint8Array([1, 2, 4]), request), key);
  assert.notEqual(
    await cache.key(source, { ...request, unicodeRanges: [{ start: 0x20, end: 0x7f }] }),
    key,
  );
  assert.notEqual(await cache.key(source, { ...request, rasters: [] }), key);
});

test('runtime GLB cache returns exact bytes, expires entries, and prunes oldest entries', async () => {
  const storage = new MemoryCacheStorage();
  let now = 1_000;
  const cache = createCache(storage, 'https://assets.test', () => now);
  const artifact = {
    id: 'font-fixture',
    bytes: new Uint8Array([4, 5, 6]),
    sha256: sha256(new Uint8Array([4, 5, 6])),
  };
  await cache.put('fixture', artifact);
  assert.deepEqual(await cache.match('fixture'), artifact);

  now += 31 * 24 * 60 * 60 * 1_000;
  assert.equal(await cache.match('fixture'), undefined);

  for (let index = 0; index < 25; index += 1) {
    now += 1;
    await cache.put(`entry-${index}`, {
      id: `font-${index}`,
      bytes: new Uint8Array([index]),
      sha256: sha256(new Uint8Array([index])),
    });
  }
  assert.equal(storage.cache.responses.size, 24);
  assert.equal(await cache.match('entry-0'), undefined);
  assert.ok(await cache.match('entry-24'));
});

test('runtime GLB cache failure remains a transparent miss', async () => {
  const cache = createCache(new ThrowingCacheStorage(), 'https://assets.test', () => 1_000);
  assert.equal(await cache.match('fixture'), undefined);
  await assert.doesNotReject(
    cache.put('fixture', { id: 'font-fixture', bytes: new Uint8Array([1]), sha256: 'b'.repeat(64) }),
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
        rasterKey: 'c'.repeat(64),
        descriptor: { generatorVersion: '0.0.0', strikes: [16] },
      },
    ],
  };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
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
