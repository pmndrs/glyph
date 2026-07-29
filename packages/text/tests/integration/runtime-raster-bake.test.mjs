import assert from 'node:assert/strict';
import test from 'node:test';

import { bitmap } from '@pmndrs/text/raster/bitmap';
import { msdf } from '@pmndrs/text/raster/msdf';
import { startRasterBakeWorker } from '../../dist/internal/raster-bake-worker-entry.js';

const shapingHash = '1'.repeat(64);
const rasterKey = '2'.repeat(64);

test('Bitmap and MSDF runtime bakers execute through lazy module Workers', async (t) => {
  const originalWorker = globalThis.Worker;
  const workers = [];
  const requests = [];
  let terminations = 0;

  class FixtureWorker {
    listeners = new Map();

    constructor(url, options) {
      workers.push({ url: String(url), options });
    }

    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }

    postMessage(value, transfer) {
      assert.deepEqual(transfer, [value.source]);
      const received = structuredClone(value, { transfer });
      requests.push(received);
      assert.equal(value.source.byteLength, 0);
      const bytes = Uint8Array.from([received.id, 2, 3, 4]).buffer;
      const bitmapRequest = Array.isArray(received.options?.strikes);
      queueMicrotask(() => {
        this.listeners.get('message')?.({
          data: {
            type: 'bake-raster-result-v0',
            id: received.id,
            ok: true,
            rasterKey: received.rasterKey,
            kind: bitmapRequest ? 'bitmap' : 'msdf',
            extension: bitmapRequest ? 'PMNDRS_font_bitmap' : 'PMNDRS_font_distance_field',
            version: 0,
            artifacts: [
              {
                role: 'raster',
                id: 'fixture.font.glb',
                bytes,
                sha256: '3'.repeat(64),
              },
            ],
            report: {
              metadataBytes: 20,
              serializedBytes: bytes.byteLength,
              gpuBytes: 4,
              pages: [
                {
                  width: 1,
                  height: 1,
                  format: bitmapRequest ? 'r8unorm' : 'rgba8unorm',
                  gpuBytes: 4,
                  source: 'embedded',
                  encodedBytes: bytes.byteLength,
                },
              ],
            },
          },
        });
      });
    }

    terminate() {
      terminations += 1;
    }
  }

  globalThis.Worker = FixtureWorker;
  t.after(() => {
    globalThis.Worker = originalWorker;
  });

  const font = { glyphCount: 7, shapingHash };
  const source = Uint8Array.from([9, 8, 7]);
  const bitmapModule = bitmap({ strikes: [16] }).module;
  const bitmapBaker = await bitmapModule.runtimeBaker();
  const bitmapResult = await bitmapBaker.default.bake({
    source,
    font,
    fontFaceIndex: 0,
    rasterKey,
    options: { strikes: [16] },
  });
  const msdfBaker = await msdf.runtimeBaker();
  const msdfResult = await msdfBaker.default.bake({
    source,
    font,
    fontFaceIndex: 0,
    rasterKey,
  });
  const configuredMsdfResult = await msdfBaker.default.bake({
    source,
    font,
    fontFaceIndex: 0,
    rasterKey,
    options: { emSize: 32, pixelRange: 6 },
  });

  assert.deepEqual(bitmapResult.artifacts[0].bytes, Uint8Array.from([1, 2, 3, 4]));
  assert.deepEqual(msdfResult.artifacts[0].bytes, Uint8Array.from([1, 2, 3, 4]));
  assert.deepEqual(configuredMsdfResult.artifacts[0].bytes, Uint8Array.from([2, 2, 3, 4]));
  assert.deepEqual(
    requests.map(({ options }) => options),
    [{ strikes: [16] }, undefined, { emSize: 32, pixelRange: 6 }],
  );
  assert.deepEqual(source, Uint8Array.from([9, 8, 7]));
  assert.equal(terminations, 3);
  assert.deepEqual(workers, [
    {
      url: new URL('../../dist/runtime-bakers/bitmap-worker.js', import.meta.url).href,
      options: { name: 'pmndrs-text-bitmap-baker', type: 'module' },
    },
    {
      url: new URL('../../dist/runtime-bakers/msdf-worker.js', import.meta.url).href,
      options: { name: 'pmndrs-text-mtsdf-baker', type: 'module' },
    },
    {
      url: new URL('../../dist/runtime-bakers/msdf-worker.js', import.meta.url).href,
      options: { name: 'pmndrs-text-mtsdf-baker', type: 'module' },
    },
  ]);
});

test('the raster Worker entry frees its baker result before transferring exact artifact buffers', async (t) => {
  const originalAddEventListener = globalThis.addEventListener;
  const originalPostMessage = globalThis.postMessage;
  let listener;
  let bakerBytes;
  const response = Promise.withResolvers();
  globalThis.addEventListener = (type, value) => {
    if (type === 'message') listener = value;
  };
  globalThis.postMessage = (value, transfer) => {
    if (value.type === 'bake-raster-result-v0') response.resolve({ value, transfer });
  };
  t.after(() => {
    restoreGlobal('addEventListener', originalAddEventListener);
    restoreGlobal('postMessage', originalPostMessage);
  });

  startRasterBakeWorker(
    {
      kind: 'fixture',
      extension: 'PMNDRS_fixture',
      version: 0,
      descriptor: () => ({}),
      async bake(request) {
        bakerBytes = Uint8Array.from([4, 3, 2, 1]);
        return {
          rasterKey: request.rasterKey,
          kind: 'fixture',
          extension: 'PMNDRS_fixture',
          version: 0,
          artifacts: [{ role: 'raster', id: 'fixture.glb', bytes: bakerBytes, sha256: '3'.repeat(64) }],
          report: {
            metadataBytes: 1,
            serializedBytes: 4,
            gpuBytes: 4,
            pages: [
              {
                width: 1,
                height: 1,
                format: 'rgba8unorm',
                gpuBytes: 4,
                source: 'embedded',
                encodedBytes: 4,
              },
            ],
          },
        };
      },
    },
    (options) => options,
  );
  listener({
    data: {
      type: 'bake-raster-v0',
      id: 1,
      source: Uint8Array.from([1]).buffer,
      fontFaceIndex: 0,
      glyphCount: 1,
      shapingHash,
      rasterKey,
      options: undefined,
    },
  });
  const posted = await response.promise;
  assert.equal(posted.value.ok, true);
  assert.equal(posted.value.artifacts[0].bytes, bakerBytes.buffer);
  assert.deepEqual(posted.transfer, [bakerBytes.buffer]);
});

function restoreGlobal(name, value) {
  if (value === undefined) delete globalThis[name];
  else globalThis[name] = value;
}
