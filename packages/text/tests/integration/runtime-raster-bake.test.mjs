import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import bitmapBaker from '@pmndrs/text/bakers/bitmap';
import msdfBaker from '@pmndrs/text/bakers/msdf';
import { bitmap, bitmapDescriptor, bitmapRasterKey } from '@pmndrs/text/raster/bitmap';
import { mtsdf, mtsdfDescriptor, mtsdfRasterKey } from '@pmndrs/text/raster/mtsdf';
import { normalizeBitmapOptions } from '../../dist/internal/bitmap-contract.js';
import { normalizeMsdfOptions } from '../../dist/internal/msdf-contract.js';
import { startRasterBakeWorker } from '../../dist/internal/raster-bake-worker-entry.js';

const shapingHash = '1'.repeat(64);
const rasterKey = '2'.repeat(64);
const interShapingHash = '6a96d9c6f9e59fd6aeb51848413bd4dd8711730a5479a7d004979d80f3b3cd09';
const interUrl = new URL('../../../../apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf', import.meta.url);

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
  const bitmapModule = bitmap;
  const runtimeBitmapBaker = await bitmapModule.runtimeBaker();
  const bitmapResult = await runtimeBitmapBaker.default.bake({
    source,
    font,
    fontFaceIndex: 0,
    rasterKey,
    options: { strikes: [16], coverage: { glyphIds: [3, 1] } },
  });
  const runtimeMsdfBaker = await mtsdf.runtimeBaker();
  const msdfResult = await runtimeMsdfBaker.default.bake({
    source,
    font,
    fontFaceIndex: 0,
    rasterKey,
  });
  const configuredMsdfResult = await runtimeMsdfBaker.default.bake({
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
    [{ strikes: [16], coverage: { glyphIds: [3, 1] } }, undefined, { emSize: 32, pixelRange: 6 }],
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

test('bounded runtime cancellation replaces the active Worker and recovers the serial queue', async (t) => {
  const originalWorker = globalThis.Worker;
  const workers = [];
  let terminations = 0;

  class RecoveryWorker {
    listeners = new Map();

    constructor() {
      workers.push(this);
    }

    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }

    postMessage(value) {
      this.request = structuredClone(value);
      if (workers.length !== 2) return;
      queueMicrotask(() => {
        const bytes = Uint8Array.of(1, 2, 3, 4).buffer;
        this.listeners.get('message')?.({
          data: {
            type: 'bake-raster-result-v0',
            id: value.id,
            ok: true,
            rasterKey: value.rasterKey,
            kind: 'bitmap',
            extension: 'PMNDRS_font_bitmap',
            version: 0,
            artifacts: [{ role: 'raster', id: 'bounded.glb', bytes, sha256: '3'.repeat(64) }],
            report: {
              metadataBytes: 20,
              serializedBytes: 4,
              gpuBytes: 4,
              pages: [
                {
                  width: 1,
                  height: 1,
                  format: 'r8unorm',
                  gpuBytes: 4,
                  source: 'embedded',
                  encodedBytes: 4,
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

  globalThis.Worker = RecoveryWorker;
  t.after(() => {
    globalThis.Worker = originalWorker;
  });

  const source = Uint8Array.of(9, 8, 7);
  const font = { glyphCount: 7, shapingHash };
  const options = { strikes: [16], coverage: { glyphIds: [1, 3] } };
  const baker = (await bitmap.runtimeBaker()).default;
  const controller = new AbortController();
  const cancelled = baker.bake({ source, font, fontFaceIndex: 0, rasterKey, options, signal: controller.signal });
  const recovered = baker.bake({ source, font, fontFaceIndex: 0, rasterKey, options });
  controller.abort(new Error('cancel bounded raster'));

  await assert.rejects(cancelled, /cancel bounded raster/);
  assert.deepEqual((await recovered).artifacts[0].bytes, Uint8Array.of(1, 2, 3, 4));
  assert.equal(workers.length, 2);
  assert.equal(terminations, 2);
  assert.deepEqual(
    workers.map((worker) => worker.request.options),
    [options, options],
  );
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

test('Node and serial Worker entry produce identical bounded Bitmap and MTSDF artifacts', async (t) => {
  const source = new Uint8Array(await readFile(interUrl));
  const font = { source, fontFaceIndex: 0, glyphCount: 2937, shapingHash: interShapingHash };
  for (const fixture of [
    {
      baker: bitmapBaker,
      normalize: normalizeBitmapOptions,
      options: { strikes: [16], coverage: { glyphIds: [43, 44] } },
      descriptor: bitmapDescriptor({ strikes: [16], coverage: { glyphIds: [43, 44] } }),
      rasterKey: await bitmapRasterKey({ strikes: [16], coverage: { glyphIds: [43, 44] } }),
    },
    {
      baker: msdfBaker,
      normalize: normalizeMsdfOptions,
      options: { coverage: { glyphIds: [43, 44] } },
      descriptor: mtsdfDescriptor({ coverage: { glyphIds: [43, 44] } }),
      rasterKey: await mtsdfRasterKey({ coverage: { glyphIds: [43, 44] } }),
    },
  ]) {
    const direct = await fixture.baker.bake({
      font,
      rasterKey: fixture.rasterKey,
      packaging: { artifact: 'embedded', pages: 'embedded' },
      descriptor: fixture.descriptor,
    });
    const worker = await bakeThroughWorker(t, fixture, source);
    assert.equal(worker.ok, true);
    assert.equal(worker.rasterKey, direct.rasterKey);
    assert.deepEqual(worker.report, direct.report);
    assert.deepEqual(
      worker.artifacts.map(({ role, id, bytes, sha256 }) => ({
        role,
        id,
        bytes: new Uint8Array(bytes),
        sha256,
      })),
      direct.artifacts,
    );
  }
});

async function bakeThroughWorker(t, fixture, source) {
  const originalAddEventListener = globalThis.addEventListener;
  const originalPostMessage = globalThis.postMessage;
  let listener;
  const response = Promise.withResolvers();
  globalThis.addEventListener = (type, value) => {
    if (type === 'message') listener = value;
  };
  globalThis.postMessage = (value) => {
    if (value.type === 'bake-raster-result-v0') response.resolve(value);
  };
  t.after(() => {
    restoreGlobal('addEventListener', originalAddEventListener);
    restoreGlobal('postMessage', originalPostMessage);
  });
  startRasterBakeWorker(fixture.baker, fixture.normalize);
  listener({
    data: {
      type: 'bake-raster-v0',
      id: 1,
      source: source.slice().buffer,
      fontFaceIndex: 0,
      glyphCount: 2937,
      shapingHash: interShapingHash,
      rasterKey: fixture.rasterKey,
      options: fixture.options,
    },
  });
  return response.promise;
}

function restoreGlobal(name, value) {
  if (value === undefined) delete globalThis[name];
  else globalThis[name] = value;
}
