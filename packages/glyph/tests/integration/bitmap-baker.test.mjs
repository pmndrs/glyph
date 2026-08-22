import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  bitmapBakerAbi,
  bitmapBakerFromCore,
  createBitmapBaker,
  createBitmapBakerFromInstance,
} from '@pmndrs/glyph/bakers/bitmap';
import { bitmap, bitmapDescriptor, bitmapRasterKey } from '@pmndrs/glyph/raster/bitmap';
import { validateBitmapArtifact } from '@pmndrs/glyph/bakers/bitmap/validate';

const wasmUrl = new URL('../../dist/bitmap-baker.wasm', import.meta.url);
const fontUrl = new URL('../../../../apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf', import.meta.url);
const shapingHash = '6a96d9c6f9e59fd6aeb51848413bd4dd8711730a5479a7d004979d80f3b3cd09';
const publishedAbi = bitmapBakerAbi;
const progressImports = { env: { pmndrs_glyph_bake_progress() {} } };

async function setup() {
  const [wasm, source] = await Promise.all([readFile(wasmUrl), readFile(fontUrl)]);
  const module = await WebAssembly.compile(wasm);
  const instance = await WebAssembly.instantiate(module, progressImports);
  const core = await createBitmapBaker(module);
  return { wasm, source: new Uint8Array(source), module, instance, core };
}

async function bake(core, source, pages) {
  const options = { strikes: [16] };
  const descriptor = bitmapDescriptor(options);
  const rasterKey = await bitmapRasterKey(options);
  return bitmapBakerFromCore(core).bake({
    font: {
      source,
      fontFaceIndex: 0,
      glyphCount: 2937,
      shapingHash,
    },
    rasterKey,
    packaging: { artifact: 'external', pages },
    descriptor,
  });
}

test('ships one generated progress import and bundles its generated ABI in TypeScript', async () => {
  const { module } = await setup();
  assert.deepEqual(WebAssembly.Module.imports(module), [
    { module: 'env', name: 'pmndrs_glyph_bake_progress', kind: 'function' },
  ]);
  assert.deepEqual(bitmapBakerAbi, publishedAbi);
  assert.equal(
    WebAssembly.Module.exports(module).some(({ name }) => name.includes('abi_')),
    false,
  );
  assert.deepEqual(bitmapBakerAbi.versions, {
    bitmapFormat: 0,
    generator: '0.0.0',
    ktx2: '0.5.0',
    readFonts: '0.42.1',
    skrifa: '0.45.1',
    zeno: '0.3.3',
  });
});

test('bakes canonical Inter deterministically through the public direct-memory shim', async () => {
  const { source, core } = await setup();
  const progress = [];
  const options = { strikes: [16] };
  const descriptor = bitmapDescriptor(options);
  const first = await bitmapBakerFromCore(core).bake({
    font: { source, fontFaceIndex: 0, glyphCount: 2937, shapingHash },
    rasterKey: await bitmapRasterKey(options),
    packaging: { artifact: 'external', pages: 'embedded' },
    descriptor,
    onProgress: (event) => progress.push([event.completed, event.total]),
  });
  const second = await bake(core, source, 'embedded');

  assert.deepEqual(first, second);
  assert.equal(first.kind, 'bitmap');
  assert.equal(first.extension, 'PMNDRS_font_bitmap');
  assert.equal(first.version, 0);
  assert.equal(first.report.metadataBytes, 2937 * 20);
  assert.ok(first.report.gpuBytes > 0);
  assert.ok(first.report.pages.length > 0);
  assert.ok(first.artifacts.every(({ role }) => role === 'raster'));
  assert.match(first.artifacts[0].id, new RegExp(`^bitmap-${shapingHash}-[0-9a-f]{64}\\.glb$`));
  assert.deepEqual([...first.artifacts[0].bytes.subarray(0, 4)], [0x67, 0x6c, 0x54, 0x46]);
  assert.deepEqual(progress.at(-1), [2937, 2937]);
  assert.ok(progress.every((entry) => entry[1] === 2937));
});

test('external page packaging preserves authoritative records and emits hashed KTX2 artifacts', async () => {
  const { source, core } = await setup();
  const embedded = await bake(core, source, 'embedded');
  const external = await bake(core, source, 'external');

  assert.equal(external.report.metadataBytes, embedded.report.metadataBytes);
  assert.equal(external.report.gpuBytes, embedded.report.gpuBytes);
  const pages = external.artifacts.filter(({ role }) => role === 'raster-page');
  assert.equal(pages.length, external.report.pages.length);
  assert.ok(pages.length > 0);
  for (const page of pages) {
    assert.match(page.id, new RegExp(`^bitmap-${shapingHash}-[0-9a-f]{64}-s16-p\\d+\\.ktx2$`));
    assert.deepEqual(
      [...page.bytes.subarray(0, 12)],
      [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a],
    );
    assert.match(page.sha256, /^[0-9a-f]{64}$/);
  }
});

test('bakes bounded coverage with deterministic progress and a validated selection bitset', async () => {
  const { source, core } = await setup();
  const options = { strikes: [16], coverage: { glyphIds: [43, 44] } };
  const descriptor = bitmapDescriptor(options);
  const rasterKey = await bitmapRasterKey(options);
  const progress = [];
  const result = await bitmapBakerFromCore(core).bake({
    font: { source, fontFaceIndex: 0, glyphCount: 2937, shapingHash },
    rasterKey,
    packaging: { artifact: 'external', pages: 'embedded' },
    descriptor,
    onProgress: (event) => progress.push([event.completed, event.total]),
  });
  const raster = result.artifacts.find((artifact) => artifact.role === 'raster');
  assert.ok(raster);
  assert.equal(result.report.metadataBytes, 2937 * 20 + Math.ceil(2937 / 8));
  assert.deepEqual(progress.at(-1), [2, 2]);
  assert.ok(progress.every((entry) => entry[1] === 2));
  const validated = await validateBitmapArtifact(raster.bytes, {
    rasterKey,
    shapingHash,
    glyphCount: 2937,
    glyphIdWidth: 16,
    descriptor,
  });
  assert.equal(validated.coverage.length, Math.ceil(2937 / 8));
  assert.equal(
    validated.coverage.reduce((count, byte) => count + byte.toString(2).replaceAll('0', '').length, 0),
    2,
  );

  const { document, views } = glbViews(raster.bytes);
  const font = { handle: 7, shapingHash, glyphCount: 2937 };
  const runtimeRaster = {
    font: font.handle,
    handle: 11,
    kind: 'bitmap',
    extension: 'PMNDRS_font_bitmap',
    version: 0,
    rasterKey,
    extensionData: document.extensions.PMNDRS_font_bitmap,
    view: (index) => views[index],
    dispose() {},
  };
  const data = await bitmap.decode(font, runtimeRaster);
  assert.equal(data.coverage[43 >> 3] & (1 << (43 & 7)), 1 << (43 & 7));
  assert.equal(data.coverage[45 >> 3] & (1 << (45 & 7)), 0);
  bitmap.dispose(data);

  const mismatchedPolicy = {
    ...runtimeRaster,
    extensionData: structuredClone(runtimeRaster.extensionData),
  };
  mismatchedPolicy.extensionData.strikes[0].ppemX = 17;
  mismatchedPolicy.extensionData.strikes[0].ppemY = 17;
  await assert.rejects(bitmap.decode(font, mismatchedPolicy), /raster key does not match its generation policy/);
});

test('rejects mismatched shaping context and honors pre-bake cancellation', async () => {
  const { source, core } = await setup();
  const descriptor = bitmapDescriptor({ strikes: [16] });
  const rasterKey = await bitmapRasterKey({ strikes: [16] });
  const baker = bitmapBakerFromCore(core);

  await assert.rejects(
    baker.bake({
      font: { source, fontFaceIndex: 0, glyphCount: 1, shapingHash },
      rasterKey,
      packaging: { artifact: 'external', pages: 'embedded' },
      descriptor,
    }),
    (error) => error.code === 'INVALID_GLYPH_COUNT',
  );

  const controller = new AbortController();
  controller.abort(new Error('cancelled by fixture'));
  await assert.rejects(
    baker.bake({
      font: { source, fontFaceIndex: 0, glyphCount: 2937, shapingHash },
      rasterKey,
      packaging: { artifact: 'external', pages: 'embedded' },
      descriptor,
      signal: controller.signal,
    }),
    /cancelled by fixture/,
  );
});

test('direct-memory allocations reject forged releases and recover after invalid requests', async () => {
  const { instance } = await setup();
  const {
    memory,
    pmndrs_bitmap_baker_alloc: allocate,
    pmndrs_bitmap_baker_dealloc: deallocate,
    pmndrs_bitmap_baker_bake: bakeExport,
    pmndrs_bitmap_baker_result_len: resultLength,
  } = instance.exports;
  assert.ok(memory instanceof WebAssembly.Memory);
  assert.equal(typeof allocate, 'function');
  assert.equal(typeof deallocate, 'function');
  assert.equal(typeof bakeExport, 'function');
  assert.equal(typeof resultLength, 'function');

  assert.equal(allocate(64 * 1024 * 1024 + 1), 0);
  const pointer = allocate(8);
  assert.notEqual(pointer, 0);
  new Uint8Array(memory.buffer, pointer, 8).fill(0x20);
  deallocate(pointer + 1, 7);
  deallocate(pointer, 7);
  const response = bakeExport(pointer, 8, pointer, 8);
  const responseLength = resultLength();
  assert.notEqual(response, 0);
  assert.ok(responseLength > 0);
  deallocate(pointer, 8);
  deallocate(pointer, 8);
  deallocate(response, responseLength - 1);
  assert.equal(resultLength(), responseLength);
  deallocate(response, responseLength);
  assert.equal(resultLength(), 0);

  const recovered = allocate(8);
  assert.notEqual(recovered, 0);
  deallocate(recovered, 8);
});

test('the direct-memory shim releases earlier allocations when a later copy fails', () => {
  const released = [];
  let allocations = 0;
  const core = createBitmapBakerFromInstance(
    fakeBitmapBakerInstance({
      allocate: () => (++allocations === 1 ? 4096 : 0),
      deallocate: (pointer, length) => released.push([pointer, length]),
    }),
  );

  assert.throws(
    () =>
      core.bake({
        source: new Uint8Array(8),
        request: {
          fontFaceIndex: 0,
          glyphCount: 1,
          shapingHash: '0'.repeat(64),
          rasterKey: '0'.repeat(64),
          packaging: { artifact: 'embedded', pages: 'embedded' },
          descriptor: bitmapDescriptor({ strikes: [16] }),
        },
      }),
    /allocation failed/,
  );
  assert.deepEqual(released, [[4096, 8]]);
});

test('the direct-memory shim releases an allocation whose memory copy fails', () => {
  const released = [];
  let allocations = 0;
  const core = createBitmapBakerFromInstance(
    fakeBitmapBakerInstance({
      allocate: () => (++allocations === 1 ? 4096 : 65_535),
      deallocate: (pointer, length) => released.push([pointer, length]),
    }),
  );

  assert.throws(() =>
    core.bake({
      source: new Uint8Array(8),
      request: {
        fontFaceIndex: 0,
        glyphCount: 1,
        shapingHash: '0'.repeat(64),
        rasterKey: '0'.repeat(64),
        packaging: { artifact: 'embedded', pages: 'embedded' },
        descriptor: bitmapDescriptor({ strikes: [16] }),
      },
    }),
  );
  assert.deepEqual(
    released.map(([pointer]) => pointer),
    [65_535, 4096],
  );
});

function fakeBitmapBakerInstance({ allocate = () => 0, deallocate = () => undefined } = {}) {
  const memory = new WebAssembly.Memory({ initial: 1 });
  return {
    exports: {
      memory,
      pmndrs_bitmap_baker_alloc: allocate,
      pmndrs_bitmap_baker_dealloc: deallocate,
      pmndrs_bitmap_baker_bake: () => 0,
      pmndrs_bitmap_baker_result_len: () => 0,
    },
  };
}

function glbViews(bytes) {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = data.getUint32(12, true);
  const document = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
  const binaryStart = 20 + jsonLength + 8;
  return {
    document,
    views: document.bufferViews.map(({ byteOffset = 0, byteLength }) =>
      bytes.subarray(binaryStart + byteOffset, binaryStart + byteOffset + byteLength),
    ),
  };
}
