import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  createSlugBaker,
  createSlugBakerFromInstance,
  SlugBakeError,
  slugBakerAbi,
  slugBakerFromCore,
} from '../../dist/bakers/slug.js';
import { validateSlugArtifact } from '../../dist/bakers/slug-validator.js';
import { SLUG_EXTENSION, slugDescriptor, slugDescriptorRasterKey } from '../../dist/internal/slug-contract.js';
import { fingerprint128, fingerprintDomain } from '../../dist/internal/fingerprint.js';
import { interShapingFingerprint } from '../support/inter-identity.mjs';

const wasmUrl = new URL('../../dist/slug-baker.wasm', import.meta.url);
const fontUrl = new URL('../../../../apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf', import.meta.url);
const shapingFingerprint = interShapingFingerprint;
const progressImports = { env: { pmndrs_glyph_bake_progress() {} } };

async function setup() {
  const [wasm, source] = await Promise.all([readFile(wasmUrl), readFile(fontUrl)]);
  const module = await WebAssembly.compile(wasm);
  const instance = await WebAssembly.instantiate(module, progressImports);
  return {
    source: new Uint8Array(source),
    sourceFingerprint: fingerprint128(source, fingerprintDomain.source),
    module,
    instance,
    core: await createSlugBaker(module),
  };
}

test('ships the generated generic direct/segmented Slug ABI', async () => {
  const { module } = await setup();
  assert.deepEqual(WebAssembly.Module.imports(module), [
    { module: 'env', name: 'pmndrs_glyph_bake_progress', kind: 'function' },
  ]);
  assert.deepEqual(slugBakerAbi, slugBakerAbi);
  assert.equal(slugBakerAbi.response.magic, 'PMSL');
  assert.equal(slugBakerAbi.segmented.chunkByteLength, 8 * 1024 * 1024);
  assert.deepEqual(slugBakerAbi.versions, {
    generator: '0.0.0',
    ktx2: '0.5.0',
    readFonts: '0.42.1',
    skrifa: '0.45.1',
    slugFormat: 0,
  });
});

test('bakes and validates exact external and embedded Inter Slug resources', async () => {
  const { source, sourceFingerprint, core } = await setup();
  const descriptor = slugDescriptor();
  const rasterKey = slugDescriptorRasterKey();
  const progress = [];
  const baker = slugBakerFromCore(core);
  const input = (pages) => ({
    font: { source, sourceFingerprint, fontFaceIndex: 0, glyphCount: 2937, shapingFingerprint },
    rasterKey,
    packaging: { artifact: 'external', pages },
    descriptor,
    onProgress(value) {
      progress.push(value);
    },
  });
  const external = await baker.bake(input('external'));
  const embedded = await baker.bake(input('embedded'));

  assert.equal(external.kind, 'slug');
  assert.equal(external.extension, SLUG_EXTENSION);
  assert.equal(external.version, 0);
  assert.equal(external.report.metadataBytes, 2937 * 40);
  assert.ok(external.report.gpuBytes > 0);
  assert.ok(external.report.pages.length > 0);
  assert.ok(external.report.pages.every((page) => page.format === 'rgba16float'));
  assert.deepEqual(progress[0], {
    stage: 'raster',
    phase: 'rasterizing',
    completed: 0,
    total: 2937,
  });
  assert.deepEqual(progress.at(-1), {
    stage: 'raster',
    phase: 'rasterizing',
    completed: 2937,
    total: 2937,
  });

  const externalRaster = external.artifacts.find(({ role }) => role === 'raster');
  const embeddedRaster = embedded.artifacts.find(({ role }) => role === 'raster');
  assert.ok(externalRaster);
  assert.ok(embeddedRaster);
  const pageArtifacts = external.artifacts.filter(({ role }) => role === 'raster-page');
  assert.equal(pageArtifacts.length, external.report.pages.length * 3);
  assert.equal(embedded.artifacts.filter(({ role }) => role === 'raster-page').length, 0);
  assert.ok(pageArtifacts.some(({ id }) => /-curves-[0-9a-f]{32}\.ktx2$/.test(id)));
  assert.ok(pageArtifacts.some(({ id }) => /-headers-[0-9a-f]{32}\.r32ui\.bin$/.test(id)));
  assert.ok(pageArtifacts.some(({ id }) => /-references-[0-9a-f]{32}\.r16ui\.bin$/.test(id)));

  const context = { rasterKey, shapingFingerprint, glyphCount: 2937, glyphIdWidth: 16, descriptor };
  const externalValidated = await validateSlugArtifact(externalRaster.bytes, {
    ...context,
    externalPages: new Map(pageArtifacts.map(({ id, bytes }) => [id, bytes])),
  });
  const embeddedValidated = await validateSlugArtifact(embeddedRaster.bytes, context);
  assert.deepEqual(embeddedValidated.records, externalValidated.records);
  assert.equal(externalValidated.records.byteLength, 2937 * 40);
  assert.deepEqual(
    embeddedValidated.pages.map(({ curve, headers, references }) => [curve.bytes, headers.bytes, references.bytes]),
    externalValidated.pages.map(({ curve, headers, references }) => [curve.bytes, headers.bytes, references.bytes]),
  );
  for (const page of externalValidated.pages) {
    const ktx = new DataView(page.curve.bytes.buffer, page.curve.bytes.byteOffset);
    assert.equal(ktx.getUint32(12, true), 97);
    assert.equal(ktx.getUint32(16, true), 2);
    assert.equal(page.headers.bytes.byteLength, page.headerWidth * page.headerHeight * 4);
    assert.equal(page.references.bytes.byteLength, page.referenceWidth * page.referenceHeight * 2);
  }
});

test('surfaces structured identity failures before rasterizing', async () => {
  const { source, core } = await setup();
  assert.throws(
    () =>
      core.bake({
        source,
        request: {
          sourceFingerprint: fingerprint128(source, fingerprintDomain.source),
          fontFaceIndex: 0,
          glyphCount: 2937,
          shapingFingerprint,
          rasterKey: '0'.repeat(32),
          packaging: { artifact: 'external', pages: 'embedded' },
          descriptor: slugDescriptor(),
        },
      }),
    (error) => error instanceof SlugBakeError && error.reason === 'INVALID_IDENTITY',
  );
});

test('releases the source allocation when the request allocation fails', () => {
  const released = [];
  let allocations = 0;
  const core = createSlugBakerFromInstance(
    fakeSlugBakerInstance({
      allocate: () => (++allocations === 1 ? 4096 : 0),
      deallocate: (pointer, length) => released.push([pointer, length]),
    }),
  );
  assert.throws(
    () =>
      core.bake({
        source: new Uint8Array(8),
        request: {
          sourceFingerprint: '0'.repeat(32),
          fontFaceIndex: 0,
          glyphCount: 1,
          shapingFingerprint: '0'.repeat(32),
          rasterKey: '0'.repeat(32),
          packaging: { artifact: 'external', pages: 'embedded' },
          descriptor: slugDescriptor(),
        },
      }),
    /allocation failed/,
  );
  assert.deepEqual(released, [[4096, 8]]);
});

test('copies segmented Slug artifacts in bounded chunks and releases Wasm ownership', () => {
  const artifactBytes = Uint8Array.from({ length: 10 }, (_, index) => index + 1);
  const metadata = {
    rasterKey: '1'.repeat(32),
    kind: 'slug',
    extension: SLUG_EXTENSION,
    version: 0,
    artifacts: [
      {
        role: 'raster',
        id: 'segmented.glb',
        fingerprint: '2'.repeat(32),
        byteOffset: 0,
        byteLength: artifactBytes.byteLength,
      },
    ],
    report: {
      metadataBytes: 40,
      serializedBytes: artifactBytes.byteLength,
      gpuBytes: 8,
      pages: [
        {
          width: 1,
          height: 1,
          format: 'rgba16float',
          gpuBytes: 8,
          source: 'embedded',
          encodedBytes: artifactBytes.byteLength,
        },
      ],
    },
  };
  const metadataBytes = new TextEncoder().encode(JSON.stringify(metadata));
  const metadataPointer = 8192;
  const artifactPointer = 16_384;
  let allocationPointer = 32_768;
  let releases = 0;
  const chunkOffsets = [];
  const instance = fakeSlugBakerInstance({
    allocate(length) {
      const pointer = allocationPointer;
      allocationPointer += length;
      return pointer;
    },
    segmented: {
      status: () => 0,
      metadataPointer: () => metadataPointer,
      metadataByteLength: () => metadataBytes.byteLength,
      artifactCount: () => 1,
      artifactByteLength: () => artifactBytes.byteLength,
      chunkPointer: (_index, offset) => artifactPointer + offset,
      chunkByteLength: (_index, offset) => {
        chunkOffsets.push(offset);
        return Math.min(4, artifactBytes.byteLength - offset);
      },
      release: () => releases++,
    },
  });
  new Uint8Array(instance.exports.memory.buffer, metadataPointer, metadataBytes.byteLength).set(metadataBytes);
  new Uint8Array(instance.exports.memory.buffer, artifactPointer, artifactBytes.byteLength).set(artifactBytes);

  const result = createSlugBakerFromInstance(instance).bake({
    source: new Uint8Array([1]),
    request: {
      sourceFingerprint: '0'.repeat(32),
      fontFaceIndex: 0,
      glyphCount: 1,
      shapingFingerprint: '0'.repeat(32),
      rasterKey: '1'.repeat(32),
      packaging: { artifact: 'embedded', pages: 'embedded' },
      descriptor: slugDescriptor(),
    },
  });

  assert.deepEqual(result.artifacts[0].bytes, artifactBytes);
  assert.deepEqual(chunkOffsets, [0, 4, 8]);
  assert.equal(releases, 1);
});

function fakeSlugBakerInstance({ allocate = () => 0, deallocate = () => undefined, segmented = {} } = {}) {
  return {
    exports: {
      memory: new WebAssembly.Memory({ initial: 1 }),
      pmndrs_glyph_slug_alloc: allocate,
      pmndrs_glyph_slug_dealloc: deallocate,
      pmndrs_glyph_slug_bake: () => 0,
      pmndrs_glyph_slug_bake_result_len: () => 0,
      pmndrs_glyph_slug_segmented_status: segmented.status ?? (() => -1),
      pmndrs_glyph_slug_segmented_metadata_ptr: segmented.metadataPointer ?? (() => 0),
      pmndrs_glyph_slug_segmented_metadata_len: segmented.metadataByteLength ?? (() => 0),
      pmndrs_glyph_slug_segmented_artifact_count: segmented.artifactCount ?? (() => 0),
      pmndrs_glyph_slug_segmented_artifact_len: segmented.artifactByteLength ?? (() => 0),
      pmndrs_glyph_slug_segmented_chunk_ptr: segmented.chunkPointer ?? (() => 0),
      pmndrs_glyph_slug_segmented_chunk_len: segmented.chunkByteLength ?? (() => 0),
      pmndrs_glyph_slug_segmented_release: segmented.release ?? (() => undefined),
    },
  };
}
