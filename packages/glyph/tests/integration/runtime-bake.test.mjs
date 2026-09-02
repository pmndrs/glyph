import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { loadFont } from '@pmndrs/glyph';
import { bakeFont } from '@pmndrs/glyph/bake';
import { bakeFontInWorker } from '@pmndrs/glyph/runtime-bake';
import { createFontBaker } from '@pmndrs/glyph/bake';
import { fontBakerWasmUrl } from '@pmndrs/glyph/bake';
import { bitmap } from '@pmndrs/glyph/raster/bitmap';
import { msdf } from '@pmndrs/glyph/raster/msdf';
import { slug } from '@pmndrs/glyph/raster/slug';
import bitmapBaker from '../../dist/bakers/bitmap.js';
import msdfBaker from '../../dist/bakers/msdf.js';
import slugBaker from '../../dist/bakers/slug.js';
import { resolveRasterBakePlan } from '../../dist/internal/raster-bake-plan.js';
import { immutableFontResources } from '../../dist/loaded-font.js';
import { FontLoader } from '../../dist/loader.js';

const fixtureDirectory = new URL('../../../../apps/benchmarks/fixtures/fonts/inter-v4.1/', import.meta.url);
const fixturePromise = Promise.all([
  readFile(new URL('Inter-Regular.ttf', fixtureDirectory)),
  readFile(new URL(fontBakerWasmUrl)),
]).then(async ([source, wasm]) => {
  const baker = await createFontBaker(wasm);
  const result = baker.bake({
    source,
    descriptor: { formatVersion: 0, fontFaceIndex: 0 },
  });
  return { source, artifact: result.artifacts[0].bytes };
});

test('the runtime host transfers source and accepts one authoritative font artifact', async (t) => {
  const { source, artifact } = await fixturePromise;
  const originalWorker = globalThis.Worker;
  const workers = [];
  let terminations = 0;
  let malformedArtifacts = false;
  let activePosts = 0;
  let maximumActivePosts = 0;

  class FixtureWorker {
    listeners = new Map();

    constructor(url, options) {
      workers.push({ url: String(url), options });
    }

    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }

    postMessage(value, transfer) {
      activePosts += 1;
      maximumActivePosts = Math.max(maximumActivePosts, activePosts);
      assert.deepEqual(transfer, [value.source]);
      const received = structuredClone(value, { transfer });
      assert.equal(value.source.byteLength, 0);
      assert.deepEqual(Buffer.from(received.source), Buffer.from(source));
      queueMicrotask(() => {
        activePosts -= 1;
        this.listeners.get('message')?.({
          data: {
            type: 'bake-font-result-v0',
            id: received.id,
            ok: true,
            artifacts: [
              {
                role: 'font',
                id: 'fixture-font',
                bytes: artifact.buffer.slice(artifact.byteOffset, artifact.byteOffset + artifact.byteLength),
                sha256: '0'.repeat(64),
              },
              ...(malformedArtifacts
                ? [
                    {
                      role: 'font',
                      id: 'duplicate-font',
                      bytes: new ArrayBuffer(0),
                      sha256: '0'.repeat(64),
                    },
                  ]
                : []),
            ],
            report: {},
            warnings: [],
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

  const sourceCopy = Uint8Array.from(source);
  const result = await bakeFontInWorker({
    source: sourceCopy,
    sourceUrl: 'https://assets.test/Inter-Regular.ttf',
  });

  assert.deepEqual(result, Uint8Array.from(artifact));
  assert.deepEqual(sourceCopy, Uint8Array.from(source));
  assert.equal(terminations, 1, 'a successful idle Worker terminates immediately');

  const concurrent = await Promise.all([
    bakeFontInWorker({
      source: sourceCopy,
      sourceUrl: 'https://assets.test/concurrent-a.ttf',
    }),
    bakeFontInWorker({
      source: sourceCopy,
      sourceUrl: 'https://assets.test/concurrent-b.ttf',
    }),
  ]);
  assert.deepEqual(concurrent, [Uint8Array.from(artifact), Uint8Array.from(artifact)]);
  assert.equal(workers.length, 2, 'concurrent requests share one active Worker');
  assert.equal(terminations, 2, 'the shared Worker terminates after its final result');
  assert.equal(maximumActivePosts, 1, 'the host dispatches at most one bake at a time');

  const queuedController = new AbortController();
  const before = bakeFontInWorker({ source: sourceCopy });
  const cancelledQueued = bakeFontInWorker({ source: sourceCopy, signal: queuedController.signal });
  const after = bakeFontInWorker({ source: sourceCopy });
  queuedController.abort(new Error('cancel queued bake'));
  await assert.rejects(cancelledQueued, /cancel queued bake/);
  assert.deepEqual(await Promise.all([before, after]), [Uint8Array.from(artifact), Uint8Array.from(artifact)]);
  assert.equal(workers.length, 3, 'queued cancellation does not replace the active Worker');
  assert.equal(terminations, 3);

  const requests = [];
  const font = await new FontLoader({
    baseUrl: 'https://assets.test/',
    development: false,
    fetch: async (input) => {
      requests.push(String(input));
      if (String(input).endsWith('.font.glb')) return new Response(null, { status: 404 });
      return new Response(source);
    },
  }).load('Inter-Regular.ttf');
  t.after(() => font.dispose());
  assert.equal(font.glyphCount, 2937);
  assert.equal(terminations, 4);
  assert.deepEqual(requests, ['https://assets.test/Inter-Regular.font.glb', 'https://assets.test/Inter-Regular.ttf']);
  const controller = new AbortController();
  const cancelled = bakeFontInWorker({
    source: sourceCopy,
    sourceUrl: 'https://assets.test/cancelled.ttf',
    signal: controller.signal,
  });
  controller.abort(new Error('cancel idle Worker'));
  await assert.rejects(cancelled, /cancel idle Worker/);
  assert.equal(terminations, 5);

  await bakeFontInWorker({
    source: sourceCopy,
    sourceUrl: 'https://assets.test/recovered.ttf',
  });
  assert.equal(workers.length, 6);
  assert.equal(terminations, 6);

  const activeController = new AbortController();
  const cancelledActive = bakeFontInWorker({ source: sourceCopy, signal: activeController.signal });
  const resumed = bakeFontInWorker({ source: sourceCopy });
  activeController.abort(new Error('cancel active bake'));
  await assert.rejects(cancelledActive, /cancel active bake/);
  assert.deepEqual(await resumed, Uint8Array.from(artifact));
  assert.equal(workers.length, 8, 'active cancellation resumes queued work in a fresh Worker');
  assert.equal(terminations, 8);

  malformedArtifacts = true;
  await assert.rejects(
    bakeFontInWorker({
      source: sourceCopy,
      sourceUrl: 'https://assets.test/malformed-result.ttf',
    }),
    /invalid protocol message/,
  );
  malformedArtifacts = false;
  assert.equal(workers.length, 9);
  assert.equal(terminations, 9);
  for (const worker of workers) {
    assert.deepEqual(worker, {
      url: new URL('../../dist/runtime-bake-worker.js', import.meta.url).href,
      options: { name: 'pmndrs-glyph-font-baker', type: 'module' },
    });
  }
});

test('the Worker entry runs the portable baker and transfers the exact canonical artifact', async (t) => {
  const { source, artifact: expected } = await fixturePromise;
  const outputRoot = await mkdtemp(join(tmpdir(), 'pmndrs-glyph-host-parity-'));
  const offlineOutput = join(outputRoot, 'Inter-Regular.font.glb');
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  await bakeFont({
    input: new URL('Inter-Regular.ttf', fixtureDirectory),
    output: offlineOutput,
    font: { fontFaceIndex: 0 },
  });
  assert.deepEqual(await readFile(offlineOutput), Buffer.from(expected));
  const originals = {
    addEventListener: globalThis.addEventListener,
    fetch: globalThis.fetch,
    postMessage: globalThis.postMessage,
  };
  let receive;
  const result = Promise.withResolvers();
  globalThis.addEventListener = (type, listener) => {
    if (type === 'message') receive = listener;
  };
  globalThis.fetch = async (input) => {
    assert.equal(String(input), fontBakerWasmUrl);
    return new Response(await readFile(new URL(fontBakerWasmUrl)));
  };
  globalThis.postMessage = (value, transfer) => {
    if (value.type === 'bake-font-result-v0') result.resolve({ value, transfer });
  };
  t.after(() => {
    restoreGlobal('addEventListener', originals.addEventListener);
    restoreGlobal('fetch', originals.fetch);
    restoreGlobal('postMessage', originals.postMessage);
  });

  await import(`../../dist/runtime-bake-worker.js?test=${Date.now()}`);
  assert.equal(typeof receive, 'function');
  receive({
    data: {
      type: 'bake-font-v0',
      id: 7,
      source: source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength),
      font: { formatVersion: 0, fontFaceIndex: 0 },
    },
  });
  const { value, transfer } = await result.promise;

  assert.equal(value.type, 'bake-font-result-v0');
  assert.equal(value.id, 7);
  assert.equal(value.ok, true);
  assert.equal(value.artifacts.length, 1);
  assert.deepEqual(Buffer.from(value.artifacts[0].bytes), Buffer.from(expected));
  assert.deepEqual(transfer, [value.artifacts[0].bytes]);
});

test('the Worker prepares once and matches the Node canonical GLB for every built-in raster', async (t) => {
  const { source } = await fixturePromise;
  const outputRoot = await mkdtemp(join(tmpdir(), 'pmndrs-glyph-runtime-subset-parity-'));
  const output = join(outputRoot, 'Inter-ascii.font.glb');
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  const unicodeRanges = [{ start: 0x20, end: 0x7e }];
  const plans = await Promise.all(
    [
      { baker: bitmapBaker, packaging: embeddedPackaging(), options: { strikes: [16] } },
      { baker: msdfBaker, packaging: embeddedPackaging(), options: undefined },
      { baker: slugBaker, packaging: embeddedPackaging(), options: undefined },
    ].map(resolveRasterBakePlan),
  );
  await bakeFont({
    input: new URL('Inter-Regular.ttf', fixtureDirectory),
    output,
    font: { fontFaceIndex: 0 },
    unicodeRanges,
    rasters: plans,
  });
  const expected = await readFile(output);

  const originals = {
    addEventListener: globalThis.addEventListener,
    fetch: globalThis.fetch,
    postMessage: globalThis.postMessage,
  };
  let receive;
  const result = Promise.withResolvers();
  globalThis.addEventListener = (type, listener) => {
    if (type === 'message') receive = listener;
  };
  globalThis.fetch = async (input) => new Response(await readFile(new URL(String(input))));
  globalThis.postMessage = (value, transfer) => {
    if (value.type === 'bake-font-result-v0') result.resolve({ value, transfer });
  };
  t.after(() => {
    restoreGlobal('addEventListener', originals.addEventListener);
    restoreGlobal('fetch', originals.fetch);
    restoreGlobal('postMessage', originals.postMessage);
  });

  await import(`../../dist/runtime-bake-worker.js?test=subset-raster-parity-${Date.now()}`);
  receive({
    data: {
      type: 'bake-font-v0',
      id: 23,
      source: source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength),
      font: { formatVersion: 0, fontFaceIndex: 0 },
      unicodeRanges,
      rasters: plans.map(({ baker, descriptor, rasterKey }) => ({
        kind: baker.kind,
        extension: baker.extension,
        version: baker.version,
        descriptor,
        rasterKey,
      })),
    },
  });
  const { value, transfer } = await result.promise;
  assert.equal(value.ok, true);
  assert.equal(value.artifacts.length, 1);
  assert.deepEqual(Buffer.from(value.artifacts[0].bytes), expected);
  assert.deepEqual(transfer, [value.artifacts[0].bytes]);
});

test('one portable source load sends its normalized ranges and complete raster tuple once', async (t) => {
  const { source } = await fixturePromise;
  const baked = await readFile(
    new URL('../../../../apps/r3f-hello-world/assets/inter-latin.font.glb', import.meta.url),
  );
  const requests = [];
  const runtimeBake = async (request) => {
    requests.push(request);
    return baked;
  };
  const [bitmapFont, msdfFont, slugFont] = await loadFont(
    {
      source: `data:font/ttf;base64,${Buffer.from(source).toString('base64')}`,
      runtimeBake,
      unicodeRanges: [
        { start: 0x41, end: 0x5a },
        { start: 0x20, end: 0x7e },
      ],
    },
    [{ raster: bitmap, options: { strikes: [32] } }, { raster: msdf }, { raster: slug }],
  );
  t.after(() => {
    slugFont.dispose();
    msdfFont.dispose();
    bitmapFont.dispose();
  });

  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].unicodeRanges, [{ start: 0x20, end: 0x7e }]);
  assert.deepEqual(
    requests[0].rasters.map(({ kind }) => kind),
    ['bitmap', 'msdf', 'slug'],
  );
  assert.equal(immutableFontResources(bitmapFont).font, immutableFontResources(msdfFont).font);
  assert.equal(immutableFontResources(msdfFont).font, immutableFontResources(slugFont).font);
});

test('external techniques bake through their own declared baker, never the Worker plan', async (t) => {
  // Self-contained routing proof: a minimal external technique whose declared
  // baker throws a sentinel. Reaching the sentinel proves the host-side route;
  // the strict stub proves the Worker plan never saw the external kind.
  const { source } = await fixturePromise;
  const outputRoot = await mkdtemp(join(tmpdir(), 'pmndrs-glyph-external-route-'));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  const stubOutput = join(outputRoot, 'Inter-Regular.font.glb');
  await bakeFont({
    input: new URL('Inter-Regular.ttf', fixtureDirectory),
    output: stubOutput,
    font: { fontFaceIndex: 0 },
    rasters: [
      {
        baker: bitmapBaker,
        packaging: { artifact: 'embedded', pages: 'embedded' },
        options: { strikes: [32] },
      },
    ],
  });
  const artifact = await readFile(stubOutput);
  const { defineRasterFormat } = await import('@pmndrs/glyph');
  const { workerRasterKinds } = await import('@pmndrs/glyph/runtime-bake');
  const external = defineRasterFormat({
    id: 'test.external-route',
    kind: 'testExternal',
    extension: 'TEST_external_route',
    version: 0,
    textEffects: [],
    runtimeBaker: () =>
      Promise.resolve({
        kind: 'testExternal',
        bake() {
          throw new Error('external-route-sentinel');
        },
      }),
    descriptor() {
      return {};
    },
    async decode() {
      return {};
    },
    dispose() {},
  });
  const requests = [];
  const runtimeBake = async (request) => {
    for (const raster of request.rasters ?? []) {
      if (!workerRasterKinds.includes(raster.kind)) {
        throw new Error(`runtime font baker does not support raster kind ${raster.kind}`);
      }
    }
    requests.push(request);
    return new Uint8Array(artifact.slice(0));
  };
  await assert.rejects(
    loadFont(
      {
        source: `data:font/ttf;base64,${Buffer.from(source).toString('base64')}`,
        runtimeBake,
      },
      [{ raster: bitmap, options: { strikes: [32] } }, { raster: external }],
    ),
    /external-route-sentinel/,
    'the external technique must reach its own declared baker',
  );
  assert.equal(requests.length, 1);
  assert.deepEqual(
    requests[0].rasters.map(({ kind }) => kind),
    ['bitmap'],
    'the Worker plan carries only kinds the Worker declares',
  );
});
test('the Worker retries a failed Wasm fetch and retains the recovered core', async (t) => {
  const { source } = await fixturePromise;
  const originals = {
    addEventListener: globalThis.addEventListener,
    fetch: globalThis.fetch,
    postMessage: globalThis.postMessage,
  };
  let receive;
  let fetches = 0;
  let response = Promise.withResolvers();
  globalThis.addEventListener = (type, listener) => {
    if (type === 'message') receive = listener;
  };
  globalThis.fetch = async (input) => {
    assert.equal(String(input), fontBakerWasmUrl);
    fetches += 1;
    if (fetches === 1) return new Response(null, { status: 503 });
    return new Response(await readFile(new URL(fontBakerWasmUrl)));
  };
  globalThis.postMessage = (value, transfer) => {
    if (value.type === 'bake-font-result-v0') response.resolve({ value, transfer });
  };
  t.after(() => {
    restoreGlobal('addEventListener', originals.addEventListener);
    restoreGlobal('fetch', originals.fetch);
    restoreGlobal('postMessage', originals.postMessage);
  });

  await import('../../dist/runtime-bake-worker.js?test=fetch-recovery');
  const message = (id) => ({
    data: {
      type: 'bake-font-v0',
      id,
      source: source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength),
      font: { formatVersion: 0, fontFaceIndex: 0 },
    },
  });

  receive(message(1));
  const first = await response.promise;
  assert.equal(first.value.ok, false);
  assert.match(first.value.error.message, /HTTP 503/);

  response = Promise.withResolvers();
  receive(message(2));
  const second = await response.promise;
  assert.equal(second.value.ok, true);
  assert.equal(fetches, 2);

  response = Promise.withResolvers();
  receive(message(3));
  const third = await response.promise;
  assert.equal(third.value.ok, true);
  assert.equal(fetches, 2, 'the recovered core is reused');
});

function restoreGlobal(key, value) {
  if (value === undefined) delete globalThis[key];
  else globalThis[key] = value;
}

function embeddedPackaging() {
  return { artifact: 'embedded', pages: 'embedded' };
}
