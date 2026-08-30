import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, before } from 'node:test';

import { FontLoader, FontLoadError, FontRegistry } from '../../dist/loader.js';
import { bakeFont } from '@pmndrs/glyph/bake';
import { bitmapBaker } from '@pmndrs/glyph/bakers/bitmap';
import { validateFontArtifact } from '@pmndrs/glyph/bake';

import { getRegisteredFontData } from '../../dist/internal/registered-font.js';

const fontUrl = new URL('../../../../apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf', import.meta.url);

let root;
let sourceBytes;
let embeddedBytes;
let incompatibleBytes;
let externalCoreBytes;
let externalRasterBytes;
let externalRasterId;

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'pmndrs-glyph-loader-'));
  sourceBytes = await readFile(fontUrl);
  const input = join(root, 'Inter-Regular.ttf');
  await writeFile(input, sourceBytes);

  const embeddedOutput = join(root, 'embedded', 'Inter-Regular.font.glb');
  const externalOutput = join(root, 'external', 'Inter-Regular.font.glb');
  await mkdir(join(root, 'embedded'), { recursive: true });
  await mkdir(join(root, 'external'), { recursive: true });
  await bakeFont({
    input,
    output: embeddedOutput,
    font: { fontFaceIndex: 0 },
    rasters: [
      {
        baker: bitmapBaker,
        packaging: { artifact: 'embedded', pages: 'embedded' },
        options: { strikes: [16] },
      },
    ],
  });
  const external = await bakeFont({
    input,
    output: externalOutput,
    font: { fontFaceIndex: 0 },
    rasters: [
      {
        baker: bitmapBaker,
        packaging: { artifact: 'external', pages: 'embedded' },
        options: { strikes: [16] },
      },
    ],
  });
  externalRasterId = external.execution.outputs.find(({ role }) => role === 'raster').file;
  [embeddedBytes, externalCoreBytes, externalRasterBytes] = await Promise.all([
    readFile(embeddedOutput),
    readFile(externalOutput),
    readFile(externalRasterId),
  ]);
  externalRasterId = externalRasterId.split('/').at(-1);
  incompatibleBytes = replaceAscii(embeddedBytes, '"bakerVersion":"0.0.0"', '"bakerVersion":"9.9.9"');
});

after(() => rm(root, { recursive: true, force: true }));

test('canonical source forms converge on one validated baked hit without source or baker access', async () => {
  const calls = [];
  const fetch = fixtureFetch(new Map([['https://assets.test/fonts/Inter.font.glb?v=4', embeddedBytes]]), calls);
  const registry = new FontRegistry();
  const loader = new FontLoader({
    registry,
    baseUrl: 'https://assets.test/app/',
    fetch,
    runtimeBake() {
      throw new Error('baked hit reached the runtime baker');
    },
  });

  const [first, second, third] = await Promise.all([
    loader.load('/fonts/Inter.TTF?v=4#first'),
    loader.load(new URL('https://assets.test/fonts/Inter.TTF?v=4#second')),
    loader.load({ source: '/fonts/Inter.TTF?v=4' }),
  ]);

  assert.equal(first, second);
  assert.equal(second, third);
  assert.deepEqual(calls, ['https://assets.test/fonts/Inter.font.glb?v=4']);
  assert.equal(first.glyphCount, 2937);
  assert.equal(first.glyphIdWidth, 16);
  assert.equal(first.metrics.unitsPerEm, 2048);
  assert.equal(first.metrics.underlinePosition, -348);
  assert.equal(first.metrics.underlineThickness, 140);
  assert.equal(first.metrics.strikeoutPosition, 671);
  assert.equal(first.metrics.strikeoutSize, 140);
  assert.equal(registry.get(first.key), first);
  assert.equal(registry.getByHandle(first.handle), first);

  const validated = await validateFontArtifact(embeddedBytes);
  const extracted = getRegisteredFontData(first);
  assert.equal(extracted.fontFaceIndex, 0);
  assert.deepEqual(Buffer.from(extracted.shapingSfnt), Buffer.from(validated.shapingSfnt));
  assert.deepEqual(Buffer.from(extracted.glyphExtents), Buffer.from(validated.glyphExtents));
  assert.deepEqual(Buffer.from(extracted.glyphExtentsAvailability), Buffer.from(validated.glyphExtentsAvailability));
  assert.equal(extracted.unicodeVersion, '17.0.0');
  assert.equal(extracted.sourceBytes, undefined);
  assert.deepEqual(
    extracted.sourceCandidates.map(({ sourceUrl }) => sourceUrl),
    ['https://assets.test/fonts/Inter.TTF?v=4'],
  );
});

test('baked-only and explicit override requests obey their exact URLs', async () => {
  const calls = [];
  const routes = new Map([
    ['https://assets.test/direct/Inter.font.glb?build=8', embeddedBytes],
    ['https://cdn.test/generated/renamed.glb', embeddedBytes],
  ]);
  const loader = new FontLoader({
    baseUrl: 'https://assets.test/app/',
    fetch: fixtureFetch(routes, calls),
  });

  const direct = await loader.load('/direct/Inter.font.glb?build=8#ignored');
  const relocated = await loader.load({
    source: '/fonts/source.ttf?source=1',
    baked: 'https://cdn.test/generated/renamed.glb#ignored',
  });

  assert.equal(direct, relocated);
  assert.deepEqual(calls, [
    'https://assets.test/direct/Inter.font.glb?build=8',
    'https://cdn.test/generated/renamed.glb',
  ]);
});

test('every canonical source suffix and extensionless path derives one exact sibling', async () => {
  const calls = [];
  const expected = [
    'https://assets.test/fonts/A.font.glb',
    'https://assets.test/fonts/B.font.glb?x=1',
    'https://assets.test/fonts/C.font.glb',
    'https://assets.test/api/font/D.font.glb',
  ];
  const loader = new FontLoader({
    baseUrl: 'https://assets.test/app/',
    fetch: fixtureFetch(new Map(expected.map((url) => [url, embeddedBytes])), calls),
  });

  await loader.load('/fonts/A.otf');
  await loader.load('/fonts/B.WOFF?x=1#ignored');
  await loader.load('/fonts/C.woff2');
  await loader.load('/api/font/D');

  assert.deepEqual(calls, expected);
});

test('an explicit baked null request skips sibling discovery and uses runtime baking', async () => {
  const calls = [];
  let bakes = 0;
  const sourceUrl = 'https://assets.test/fonts/Inter.ttf';
  const loader = new FontLoader({
    fetch: fixtureFetch(new Map([[sourceUrl, sourceBytes]]), calls),
    async runtimeBake(request) {
      bakes += 1;
      assert.equal(request.sourceUrl, sourceUrl);
      assert.equal(request.bakedUrl, undefined);
      return embeddedBytes;
    },
  });

  const font = await loader.load({ source: sourceUrl, baked: null });

  assert.equal(font.glyphCount, 2937);
  assert.equal(bakes, 1);
  assert.deepEqual(calls, [sourceUrl]);
});

test('runtime persistence inherits source response cache policy', async () => {
  const requests = [];
  const now = Date.now();
  const cacheable = new FontLoader({
    fetch: async () =>
      new Response(sourceBytes, {
        headers: {
          'cache-control': 'public, max-age=3600',
          date: new Date(now).toUTCString(),
        },
      }),
    async runtimeBake(request) {
      requests.push(request);
      return embeddedBytes;
    },
  });
  await cacheable.load({ source: 'https://assets.test/cacheable.ttf', baked: null });
  assert.ok(requests[0].cache.expiresAt > now);
  assert.ok(requests[0].cache.expiresAt <= now + 3_600_000);

  const uncacheable = new FontLoader({
    fetch: async () => new Response(sourceBytes, { headers: { 'cache-control': 'no-store' } }),
    async runtimeBake(request) {
      requests.push(request);
      return embeddedBytes;
    },
  });
  await uncacheable.load({ source: 'https://assets.test/private.ttf', baked: null });
  assert.equal(requests[1].cache, undefined);
});

test('missing and invalid probes fall back once with deduplicated diagnostics', async () => {
  const calls = [];
  const warnings = [];
  const diagnostics = [];
  let bakes = 0;
  const routes = new Map([
    ['https://assets.test/fonts/Missing.ttf', sourceBytes],
    ['https://assets.test/fonts/Invalid.font.glb', new Uint8Array([1, 2, 3])],
    ['https://assets.test/fonts/Invalid.ttf', sourceBytes],
    ['https://assets.test/fonts/Incompatible.font.glb', incompatibleBytes],
    ['https://assets.test/fonts/Incompatible.ttf', sourceBytes],
    ['data:font/ttf;base64,AA==', sourceBytes],
  ]);
  const loader = new FontLoader({
    baseUrl: 'https://assets.test/app/',
    fetch: fixtureFetch(routes, calls),
    development: true,
    onWarning: (warning) => warnings.push(warning),
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    async runtimeBake(request) {
      bakes += 1;
      assert.deepEqual(Buffer.from(request.source), Buffer.from(sourceBytes));
      return embeddedBytes;
    },
  });

  const [missingA, missingB] = await Promise.all([
    loader.load('/fonts/Missing.ttf'),
    loader.load(new URL('https://assets.test/fonts/Missing.ttf#same')),
  ]);
  const invalid = await loader.load({
    source: '/fonts/Invalid.ttf',
    baked: '/fonts/Invalid.font.glb',
  });
  const incompatible = await loader.load('/fonts/Incompatible.ttf');
  const nonHierarchical = await loader.load('data:font/ttf;base64,AA==');

  assert.equal(missingA, missingB);
  assert.equal(missingA, invalid);
  assert.equal(invalid, incompatible);
  assert.equal(invalid, nonHierarchical);
  assert.equal(bakes, 4);
  assert.deepEqual(
    warnings.map(({ code, url }) => ({ code, url })),
    [
      {
        code: 'BAKED_FONT_MISSING',
        url: 'https://assets.test/fonts/Missing.font.glb',
      },
    ],
  );
  assert.deepEqual(
    diagnostics.map(({ code, url }) => ({ code, url })),
    [
      {
        code: 'BAKED_FONT_INVALID',
        url: 'https://assets.test/fonts/Invalid.font.glb',
      },
      {
        code: 'BAKED_FONT_INCOMPATIBLE',
        url: 'https://assets.test/fonts/Incompatible.font.glb',
      },
    ],
  );
  assert.equal(calls.filter((url) => url === 'https://assets.test/fonts/Missing.font.glb').length, 1);
  const retained = getRegisteredFontData(missingA);
  assert.deepEqual(Buffer.from(retained.sourceBytes), Buffer.from(sourceBytes));
  assert.equal(retained.sourceHash, '40d692fce188e4471e2b3cba937be967878f631ad3ebbbdcd587687c7ebe0c82');
});

test('baked-only failures never fetch a source or invoke fallback', async () => {
  let bakes = 0;
  const loader = new FontLoader({
    baseUrl: 'https://assets.test/',
    fetch: fixtureFetch(new Map([['https://assets.test/invalid.glb', new Uint8Array([1, 2, 3])]]), []),
    async runtimeBake() {
      bakes += 1;
      return embeddedBytes;
    },
  });

  await assert.rejects(
    loader.load({ baked: '/missing.glb' }),
    (error) => error instanceof FontLoadError && error.code === 'BAKED_FONT_MISSING',
  );
  await assert.rejects(
    loader.load('/invalid.glb'),
    (error) => error instanceof FontLoadError && error.code === 'BAKED_FONT_INVALID',
  );
  assert.equal(bakes, 0);
});

test('runtime output cannot claim provenance for different source bytes', async () => {
  const changedSource = new Uint8Array(sourceBytes);
  changedSource[changedSource.byteLength - 1] ^= 1;
  const loader = new FontLoader({
    baseUrl: 'https://assets.test/',
    fetch: fixtureFetch(new Map([['https://assets.test/source.ttf', changedSource]]), []),
    async runtimeBake() {
      return embeddedBytes;
    },
    onWarning() {},
  });

  await assert.rejects(
    loader.load('/source.ttf'),
    (error) => error instanceof FontLoadError && error.code === 'FONT_SOURCE_IDENTITY',
  );
});

test('shaping deduplication keeps differently sourced bytes qualified by provenance', async () => {
  const registry = new FontRegistry();
  const canonical = await registry.registerAsset(embeddedBytes);
  const canonicalData = getRegisteredFontData(canonical);
  const changedSource = Uint8Array.from(sourceBytes);
  changedSource[changedSource.byteLength - 1] ^= 1;
  const changedHash = createHash('sha256').update(changedSource).digest('hex');
  const changedArtifact = replaceAscii(embeddedBytes, canonicalData.sourceHash, changedHash);
  const calls = [];
  const loader = new FontLoader({
    registry,
    baseUrl: 'https://assets.test/',
    fetch: fixtureFetch(new Map([['https://assets.test/variant.ttf', changedSource]]), calls),
    async runtimeBake() {
      return changedArtifact;
    },
    onWarning() {},
  });

  const deduplicated = await loader.load('variant.ttf');
  assert.equal(deduplicated, canonical);
  assert.equal(canonicalData.sourceBytes, undefined);
  assert.equal(canonicalData.sourceCandidates.length, 1);
  assert.equal(canonicalData.sourceCandidates[0].sourceHash, changedHash);
  assert.equal(canonicalData.sourceCandidates[0].sourceUrl, 'https://assets.test/variant.ttf');
  assert.equal(typeof canonicalData.sourceCandidates[0].fetch, 'function');
  assert.deepEqual(calls, ['https://assets.test/variant.font.glb', 'https://assets.test/variant.ttf']);
});

test('registration merges embedded and external delivery without changing raster identity', async () => {
  const registry = new FontRegistry();
  const external = await registry.registerAsset(externalCoreBytes);
  const embedded = await registry.registerAsset(embeddedBytes);

  assert.equal(embedded, external);
  assert.equal(external.rasterReferences.length, 1);
  assert.equal(external.rasterReferences[0].source.type, 'embedded');
  const raster = await external.loadRaster({
    rasterKey: external.rasterReferences[0].rasterKey,
    kind: 'bitmap',
  });
  const recordsBufferView = raster.extensionData.strikes[0].recordBufferView;
  assert.equal(typeof recordsBufferView, 'number');
  const records = raster.view(recordsBufferView);
  assert.equal(records.byteLength, 2937 * 20);
  const firstByte = records[0];
  records[0] ^= 0xff;
  assert.equal(raster.view(recordsBufferView)[0], firstByte ^ 0xff);
  records[0] = firstByte;
  assert.throws(() => raster.view(1_000_000), RangeError);
});

test('external raster loading resolves relative to the baked core and authenticates its hash', async () => {
  const calls = [];
  const coreUrl = 'https://assets.test/generated/Inter.font.glb';
  const rasterUrl = `https://assets.test/generated/${externalRasterId}`;
  const pageUrl = 'https://assets.test/generated/page.bin';
  const pageBytes = Uint8Array.of(3, 1, 4, 1, 5, 9);
  const pageHash = createHash('sha256').update(pageBytes).digest('hex');
  const loader = new FontLoader({
    fetch: fixtureFetch(
      new Map([
        [coreUrl, externalCoreBytes],
        [rasterUrl, externalRasterBytes],
        [pageUrl, pageBytes],
      ]),
      calls,
    ),
  });
  const font = await loader.load({ baked: coreUrl });
  const reference = font.rasterReferences[0];
  const raster = await font.loadRaster({ rasterKey: reference.rasterKey });

  assert.equal(raster.kind, 'bitmap');
  assert.equal(font.getRaster(reference.rasterKey), raster);
  const resolvedPage = await raster.resource({
    type: 'external',
    uri: 'page.bin',
    byteLength: pageBytes.byteLength,
    artifactHash: pageHash,
  });
  assert.deepEqual(resolvedPage, pageBytes);
  resolvedPage.fill(0);
  assert.deepEqual(pageBytes, Uint8Array.of(3, 1, 4, 1, 5, 9));

  await assert.rejects(
    raster.resource({
      type: 'external',
      uri: 'page.bin',
      byteLength: pageBytes.byteLength,
      artifactHash: '0'.repeat(64),
    }),
    (error) => error instanceof FontLoadError && error.code === 'RASTER_RESOURCE_HASH',
  );
  const controller = new AbortController();
  controller.abort(new Error('page cancelled'));
  await assert.rejects(
    raster.resource(
      {
        type: 'external',
        uri: 'page.bin',
        byteLength: pageBytes.byteLength,
        artifactHash: pageHash,
      },
      controller.signal,
    ),
    /page cancelled/,
  );
  assert.deepEqual(calls, [coreUrl, rasterUrl, pageUrl, pageUrl]);

  const otherRegistry = new FontRegistry();
  const otherFont = await otherRegistry.registerAsset(externalCoreBytes);
  await assert.rejects(
    otherRegistry.attachRaster(otherFont, embeddedBytes),
    (error) => error instanceof FontLoadError && error.code === 'RASTER_ARTIFACT_HASH',
  );
});

test('registries isolate generations, own their bytes, enforce limits, and invalidate disposal', async () => {
  const firstRegistry = new FontRegistry();
  const secondRegistry = new FontRegistry();
  const mutable = new Uint8Array(embeddedBytes);
  const first = await firstRegistry.registerAsset(mutable);
  mutable.fill(0);
  const second = await secondRegistry.registerAsset(embeddedBytes);

  assert.notEqual(first.key, second.key);
  assert.notEqual(first.handle, second.handle);
  assert.equal(first.shapingHash, second.shapingHash);
  assert.equal(getRegisteredFontData(first).shapingSfnt[0], 0);

  first.dispose();
  assert.equal(firstRegistry.get(first.key), undefined);
  assert.equal(firstRegistry.getByHandle(first.handle), undefined);
  assert.throws(() => first.rasterReferences, /disposed/);

  const limited = new FontRegistry({ maxArtifactBytes: embeddedBytes.byteLength - 1 });
  await assert.rejects(
    limited.registerAsset(embeddedBytes),
    (error) => error instanceof FontLoadError && error.code === 'FONT_RESOURCE_LIMIT',
  );
});

test('raster handles are generation-scoped and become stale on disposal', async () => {
  const registry = new FontRegistry();
  const font = await registry.registerAsset(embeddedBytes);
  const reference = font.rasterReferences[0];
  const first = await font.loadRaster({ rasterKey: reference.rasterKey, kind: 'bitmap' });
  const view = first.extensionData.strikes[0].recordBufferView;

  assert.ok(first.view(view).byteLength > 0);
  first.dispose();
  assert.equal(font.getRaster(reference.rasterKey), undefined);
  assert.throws(
    () => first.view(view),
    (error) => error instanceof FontLoadError && error.code === 'STALE_RASTER_HANDLE',
  );

  const second = await font.loadRaster({ rasterKey: reference.rasterKey, kind: 'bitmap' });
  assert.notEqual(second.handle, first.handle);
  font.dispose();
  assert.throws(
    () => second.view(view),
    (error) => error instanceof FontLoadError && error.code === 'STALE_FONT_HANDLE',
  );
});

test('fetch limits reject both declared and streamed excess before registration', async () => {
  const streamed = new FontLoader({
    registry: new FontRegistry({ maxArtifactBytes: 1024 }),
    fetch: fixtureFetch(new Map([['https://assets.test/streamed.glb', embeddedBytes]]), []),
  });
  await assert.rejects(
    streamed.load({ baked: 'https://assets.test/streamed.glb' }),
    (error) => error instanceof FontLoadError && error.code === 'BAKED_FONT_RESOURCE_LIMIT',
  );

  const declared = new FontLoader({
    registry: new FontRegistry({ maxArtifactBytes: 1024 }),
    async fetch() {
      return new Response(null, { status: 200, headers: { 'content-length': '2048' } });
    },
  });
  await assert.rejects(
    declared.load({ baked: 'https://assets.test/declared.glb' }),
    (error) => error instanceof FontLoadError && error.code === 'BAKED_FONT_RESOURCE_LIMIT',
  );
});

test('cancellation detaches one caller while another retains the shared request', async () => {
  let release;
  let sharedSignal;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const loader = new FontLoader({
    fetch: async (_input, init) => {
      sharedSignal = init.signal;
      await pending;
      return response(embeddedBytes);
    },
  });
  const controller = new AbortController();
  const cancelled = loader.load({ baked: 'https://assets.test/font.glb' }, { signal: controller.signal });
  const retained = loader.load({ baked: 'https://assets.test/font.glb' });
  controller.abort(new Error('fixture cancellation'));
  await assert.rejects(cancelled, /fixture cancellation/);
  assert.equal(sharedSignal.aborted, false);
  release();

  const font = await retained;
  assert.equal(font.glyphCount, 2937);
  font.dispose();
  const reloaded = await loader.load({ baked: 'https://assets.test/font.glb' });
  assert.notEqual(reloaded.handle, font.handle);
});

test('the final detached caller aborts underlying work and a later request starts fresh', async () => {
  const signals = [];
  let calls = 0;
  const loader = new FontLoader({
    fetch: async (_input, init) => {
      calls += 1;
      signals.push(init.signal);
      if (calls > 1) return response(embeddedBytes);
      return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
      });
    },
  });
  const firstController = new AbortController();
  const finalController = new AbortController();
  const first = loader.load({ baked: 'https://assets.test/font.glb' }, { signal: firstController.signal });
  const final = loader.load({ baked: 'https://assets.test/font.glb' }, { signal: finalController.signal });

  firstController.abort(new Error('first detached'));
  await assert.rejects(first, /first detached/);
  assert.equal(signals[0].aborted, false);
  finalController.abort(new Error('final detached'));
  await assert.rejects(final, /final detached/);
  assert.equal(signals[0].aborted, true);

  const recovered = await loader.load({ baked: 'https://assets.test/font.glb' });
  assert.equal(recovered.glyphCount, 2937);
  assert.equal(calls, 2);
  assert.notEqual(signals[0], signals[1]);
});

function fixtureFetch(routes, calls) {
  return async (input) => {
    const url = typeof input === 'string' ? input : input.url;
    calls.push(url);
    const body = routes.get(url);
    return body === undefined ? new Response(null, { status: 404 }) : response(body);
  };
}

function response(bytes) {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { 'content-type': 'model/gltf-binary' },
  });
}

function replaceAscii(source, from, to) {
  assert.equal(from.length, to.length);
  const bytes = new Uint8Array(source);
  const needle = new TextEncoder().encode(from);
  const replacement = new TextEncoder().encode(to);
  let offset = -1;
  for (let index = 0; index <= bytes.byteLength - needle.byteLength; index += 1) {
    if (needle.every((value, inner) => bytes[index + inner] === value)) {
      assert.equal(offset, -1, `fixture text ${from} must occur exactly once`);
      offset = index;
    }
  }
  assert.notEqual(offset, -1, `fixture text ${from} was not found`);
  bytes.set(replacement, offset);
  return bytes;
}
