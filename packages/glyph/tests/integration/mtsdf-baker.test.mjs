import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  createMsdfBaker,
  createMsdfBakerFromInstance,
  msdfBakerAbi,
  msdfBakerFromCore,
} from '@pmndrs/glyph/bakers/msdf';
import { MsdfArtifactValidationError, validateMsdfArtifact } from '../../dist/bakers/msdf-validator.js';
import {
  MSDF_EM_SIZE,
  MSDF_EXTENSION,
  MSDF_PIXEL_RANGE,
  MSDF_PLANE_UNITS_PER_EM,
  msdf,
  msdfDescriptor,
  msdfDescriptorRasterKey,
} from '@pmndrs/glyph/raster/msdf';
import { mtsdfBakerAbi } from '../../dist/mtsdf-baker-abi.js';
import { fingerprint128, fingerprintDomain } from '../../dist/internal/fingerprint.js';
import { interShapingFingerprint } from '../support/inter-identity.mjs';

const wasmUrl = new URL('../../dist/mtsdf-baker.wasm', import.meta.url);
const fontUrl = new URL('../../../../apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf', import.meta.url);
const showcaseFontUrl = new URL(
  '../../../../apps/benchmarks/fixtures/fonts/noto-sans-cjk-showcase-v0/NotoSansCJKjp-Showcase.otf',
  import.meta.url,
);
const shapingFingerprint = interShapingFingerprint;
const showcaseShapingFingerprint = '0e83f1eecef0d421fa6c592495eb46f5';
const publishedAbi = mtsdfBakerAbi;
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
    core: await createMsdfBaker(module),
  };
}

test('ships one generated progress import and bundles its artifact contract in TypeScript', async () => {
  const { module } = await setup();
  assert.deepEqual(WebAssembly.Module.imports(module), [
    { module: 'env', name: 'pmndrs_glyph_bake_progress', kind: 'function' },
  ]);
  assert.deepEqual(msdfBakerAbi, publishedAbi);
  assert.equal(
    WebAssembly.Module.exports(module).some(({ name }) => name.includes('abi_')),
    false,
  );
  assert.deepEqual(msdfBakerAbi.artifactBaker.versions, {
    generator: '0.0.0',
    ktx2: '0.5.0',
    msdfFormat: 0,
    readFonts: '0.42.1',
    skrifa: '0.45.1',
  });
});

test('bakes canonical Inter through the public direct-memory shim', async () => {
  const { source, sourceFingerprint, core } = await setup();
  const descriptor = msdfDescriptor();
  const rasterKey = await msdfDescriptorRasterKey();
  const progress = [];
  assert.equal(rasterKey, 'c51a74581f4288c40c308436ca120d67');
  const result = await msdfBakerFromCore(core).bake({
    font: {
      source,
      sourceFingerprint,
      fontFaceIndex: 0,
      glyphCount: 2937,
      shapingFingerprint,
    },
    rasterKey,
    packaging: { artifact: 'external', pages: 'external' },
    descriptor,
    onProgress: (event) => progress.push([event.completed, event.total]),
  });

  assert.equal(result.kind, 'msdf');
  assert.equal(result.extension, MSDF_EXTENSION);
  assert.equal(result.version, 0);
  assert.equal(result.report.metadataBytes, 2937 * 20);
  assert.ok(result.report.gpuBytes > 0);
  assert.ok(result.report.pages.length > 0);
  assert.ok(result.report.pages.every((page) => page.format === 'rgba8unorm'));
  const raster = result.artifacts.find((artifact) => artifact.role === 'raster');
  assert.ok(raster);
  assert.match(raster.id, new RegExp(`^msdf-${shapingFingerprint}-${rasterKey}-[0-9a-f]{32}\\.glb$`));
  const pages = result.artifacts.filter((artifact) => artifact.role === 'raster-page');
  assert.equal(pages.length, result.report.pages.length);
  for (const [index, page] of pages.entries()) {
    assert.match(page.id, new RegExp(`^msdf-${shapingFingerprint}-${rasterKey}-p${index}-[0-9a-f]{32}\\.ktx2$`));
    assert.deepEqual(
      [...page.bytes.subarray(0, 12)],
      [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a],
    );
  }
  const extension = glbRoot(raster.bytes).extensions[MSDF_EXTENSION];
  assert.deepEqual(
    result.artifacts.map(({ bytes }) => bytes.byteLength),
    [
      63_104, 3_989_700, 4_190_404, 4_161_760, 4_137_316, 4_051_140, 3_969_644, 3_845_356, 4_178_128, 4_186_308,
      2_403_940,
    ],
  );
  assert.ok(result.artifacts.every(({ fingerprint }) => /^[0-9a-f]{32}$/.test(fingerprint)));
  assert.equal(extension.encoding, 'mtsdf');
  assert.equal(extension.emSize, MSDF_EM_SIZE);
  assert.equal(extension.pixelRange, MSDF_PIXEL_RANGE);
  assert.equal(extension.planeUnitsPerEm, MSDF_PLANE_UNITS_PER_EM);
  assert.equal(extension.recordStride, 20);
  assert.equal(extension.pages.length, pages.length);
  assert.deepEqual(progress.at(-1), [2937, 2937]);
  assert.ok(progress.every((entry) => entry[1] === 2937));
  await exerciseArtifactValidation(result, raster, pages, rasterKey);
  await exerciseRuntime(result, raster, extension, rasterKey);
});

test('bakes and validates fingerprinted 32 px/em quality policies', async () => {
  const [wasm, source] = await Promise.all([readFile(wasmUrl), readFile(showcaseFontUrl)]);
  const sourceFingerprint = fingerprint128(source, fingerprintDomain.source);
  const core = await createMsdfBaker(wasm);
  const reports = [];
  for (const pixelRange of [4, 6]) {
    const descriptor = msdfDescriptor({ emSize: 32, pixelRange });
    const rasterKey = await msdfDescriptorRasterKey(descriptor);
    const result = await msdfBakerFromCore(core).bake({
      font: {
        source: new Uint8Array(source),
        sourceFingerprint,
        fontFaceIndex: 0,
        glyphCount: 155,
        shapingFingerprint: showcaseShapingFingerprint,
      },
      rasterKey,
      packaging: { artifact: 'embedded', pages: 'embedded' },
      descriptor,
    });
    const raster = result.artifacts.find((artifact) => artifact.role === 'raster');
    assert.ok(raster);
    const extension = glbRoot(raster.bytes).extensions[MSDF_EXTENSION];
    assert.equal(extension.emSize, 32);
    assert.equal(extension.pixelRange, pixelRange);
    assert.equal(extension.planeUnitsPerEm, 32);
    const validated = await validateMsdfArtifact(raster.bytes, {
      rasterKey,
      shapingFingerprint: showcaseShapingFingerprint,
      glyphCount: 155,
      glyphIdWidth: 16,
      descriptor,
    });
    assert.equal(validated.pages.length, result.report.pages.length);
    if (pixelRange === 4) {
      const { document, views } = glbViews(raster.bytes);
      const font = { handle: 7, shapingFingerprint: showcaseShapingFingerprint, glyphCount: 155 };
      const runtimeRaster = {
        font: font.handle,
        handle: 11,
        kind: 'msdf',
        extension: MSDF_EXTENSION,
        version: 0,
        rasterKey,
        extensionData: document.extensions[MSDF_EXTENSION],
        view(index) {
          const view = views[index];
          if (view === undefined) throw new RangeError('missing embedded 32 px/em MSDF runtime view');
          return view;
        },
        dispose() {},
      };
      const data = await msdf.decode(font, runtimeRaster);
      try {
        assert.equal(data.emSize, 32);
        assert.equal(data.pixelRange, 4);
        const records = views[extension.recordBufferView];
        assert.ok(records);
        assert.ok(firstPresentGlyph(records) >= 0);
      } finally {
        msdf.dispose(data);
      }
    }
    reports.push(result.report);
  }
  assert.ok(reports[0].gpuBytes < reports[1].gpuBytes);
});

test('bakes bounded coverage with deterministic progress and a validated selection bitset', async () => {
  const { source, sourceFingerprint, core } = await setup();
  const descriptor = msdfDescriptor({ coverage: { glyphIds: [43, 44] } });
  const rasterKey = await msdfDescriptorRasterKey(descriptor);
  const progress = [];
  const result = await msdfBakerFromCore(core).bake({
    font: { source, sourceFingerprint, fontFaceIndex: 0, glyphCount: 2937, shapingFingerprint },
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
  const validated = await validateMsdfArtifact(raster.bytes, {
    rasterKey,
    shapingFingerprint,
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
  const font = { handle: 7, shapingFingerprint, glyphCount: 2937 };
  const runtimeRaster = {
    font: font.handle,
    handle: 11,
    kind: 'msdf',
    extension: MSDF_EXTENSION,
    version: 0,
    rasterKey,
    extensionData: document.extensions[MSDF_EXTENSION],
    view: (index) => views[index],
    dispose() {},
  };
  const data = await msdf.decode(font, runtimeRaster);
  assert.equal(data.resource, `pmndrs.msdf/${shapingHash}/${rasterKey}`);
  assert.equal(data.coverage[43 >> 3] & (1 << (43 & 7)), 1 << (43 & 7));
  assert.equal(data.coverage[45 >> 3] & (1 << (45 & 7)), 0);
  msdf.dispose(data);
});

test('keeps the packaged MSDF schema byte-identical to its canonical source', async () => {
  assert.deepEqual(
    await readFile(
      new URL(
        '../../../../.agents/docs/planning/extensions/PMNDRS_font_distance_field/schema/glTF.PMNDRS_font_distance_field.schema.json',
        import.meta.url,
      ),
    ),
    await readFile(new URL('../../src/bakers/schemas/glTF.PMNDRS_font_distance_field.schema.json', import.meta.url)),
  );
});

test('releases a source allocation when the request allocation fails', () => {
  const released = [];
  let allocations = 0;
  const core = createMsdfBakerFromInstance(
    fakeMsdfBakerInstance({
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
          descriptor: msdfDescriptor(),
        },
      }),
    /allocation failed/,
  );
  assert.deepEqual(released, [[4096, 8]]);
});

test('copies a segmented response in bounded chunks and releases its Wasm ownership', () => {
  const artifactBytes = Uint8Array.from({ length: 10 }, (_, index) => index + 1);
  const metadata = {
    rasterKey: '1'.repeat(32),
    kind: 'msdf',
    extension: MSDF_EXTENSION,
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
      metadataBytes: 20,
      serializedBytes: artifactBytes.byteLength,
      gpuBytes: 4,
      pages: [
        {
          width: 1,
          height: 1,
          format: 'rgba8unorm',
          gpuBytes: 4,
          source: 'embedded',
          encodedBytes: artifactBytes.byteLength,
        },
      ],
    },
  };
  const metadataBytes = new TextEncoder().encode(JSON.stringify(metadata));
  const metadataPointer = 8_192;
  const artifactPointer = 16_384;
  let allocationPointer = 32_768;
  let releases = 0;
  const chunkOffsets = [];
  const instance = fakeMsdfBakerInstance({
    allocate: (length) => {
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

  const result = createMsdfBakerFromInstance(instance).bake({
    source: new Uint8Array([1]),
    request: {
      sourceFingerprint: '0'.repeat(32),
      fontFaceIndex: 0,
      glyphCount: 1,
      shapingFingerprint: '0'.repeat(32),
      rasterKey: '1'.repeat(32),
      packaging: { artifact: 'embedded', pages: 'embedded' },
      descriptor: msdfDescriptor(),
    },
  });

  assert.deepEqual(result.artifacts[0].bytes, artifactBytes);
  assert.deepEqual(chunkOffsets, [0, 4, 8]);
  assert.equal(releases, 1);
});

function glbRoot(bytes) {
  assert.deepEqual([...bytes.subarray(0, 4)], [0x67, 0x6c, 0x54, 0x46]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
}

async function exerciseArtifactValidation(result, rasterArtifact, pageArtifacts, rasterKey) {
  const context = {
    rasterKey,
    shapingFingerprint,
    glyphCount: 2937,
    glyphIdWidth: 16,
    descriptor: msdfDescriptor(),
  };
  const externalPages = new Map(pageArtifacts.map(({ id, bytes }) => [id, bytes]));
  const external = await validateMsdfArtifact(rasterArtifact.bytes, {
    ...context,
    externalPages,
  });
  assert.equal(external.khronos.validatorVersion, '2.0.0-dev.3.10');
  assert.equal(external.khronos.issues.numErrors, 0);
  assert.equal(external.khronos.issues.numWarnings, 0);
  assert.equal(external.records.byteLength, 2937 * 20);
  assert.equal(external.pages.length, result.report.pages.length);
  assert.ok(external.pages.every(({ source }) => source === 'external'));

  const embeddedBytes = embedRasterPages(rasterArtifact.bytes, pageArtifacts);
  const embedded = await validateMsdfArtifact(embeddedBytes, context);
  assert.deepEqual(embedded.records, external.records);
  assert.ok(embedded.pages.every(({ source }) => source === 'embedded'));
  assert.deepEqual(
    embedded.pages.map(({ bytes }) => bytes),
    external.pages.map(({ bytes }) => bytes),
  );

  const required = [
    'version',
    'rasterKey',
    'shapingFingerprint',
    'glyphCount',
    'glyphIdWidth',
    'encoding',
    'emSize',
    'pixelRange',
    'planeUnitsPerEm',
    'recordBufferView',
    'recordStride',
    'pages',
  ];
  for (const field of required) {
    const document = structuredClone(glbRoot(embeddedBytes));
    delete document.extensions[MSDF_EXTENSION][field];
    await rejectsMsdf(rewriteGlbDocument(embeddedBytes, document), context, 'SCHEMA_');
  }
  for (const field of ['width', 'height', 'mipLevelCount', 'colorSpace', 'variants']) {
    const document = structuredClone(glbRoot(embeddedBytes));
    delete document.extensions[MSDF_EXTENSION].pages[0][field];
    await rejectsMsdf(rewriteGlbDocument(embeddedBytes, document), context, 'SCHEMA_');
  }
  for (const field of ['source', 'container', 'gpuFormat', 'quality']) {
    const document = structuredClone(glbRoot(embeddedBytes));
    delete document.extensions[MSDF_EXTENSION].pages[0].variants[0][field];
    await rejectsMsdf(rewriteGlbDocument(embeddedBytes, document), context, 'SCHEMA_');
  }
  for (const field of ['type', 'bufferView']) {
    const document = structuredClone(glbRoot(embeddedBytes));
    delete document.extensions[MSDF_EXTENSION].pages[0].variants[0].source[field];
    await rejectsMsdf(rewriteGlbDocument(embeddedBytes, document), context, 'SCHEMA_');
  }

  const decoded = decodeGlb(embeddedBytes);
  const extension = decoded.document.extensions[MSDF_EXTENSION];
  const recordView = decoded.document.bufferViews[extension.recordBufferView];
  const recordsStart = decoded.binStart + recordView.byteOffset;
  const present = firstPresentGlyph(embedded.records);

  const wrongIdentity = structuredClone(decoded.document);
  wrongIdentity.extensions[MSDF_EXTENSION].shapingFingerprint = '0'.repeat(32);
  await rejectsMsdf(rewriteGlbDocument(embeddedBytes, wrongIdentity), context, 'RECIPROCAL_IDENTITY');

  const wrongConstant = structuredClone(decoded.document);
  wrongConstant.extensions[MSDF_EXTENSION].pixelRange = MSDF_PIXEL_RANGE + 1;
  await rejectsMsdf(rewriteGlbDocument(embeddedBytes, wrongConstant), context, 'MTSDF_CONFIGURATION');

  const flags = embeddedBytes.slice();
  new DataView(flags.buffer).setUint16(recordsStart + present * 20 + 18, 1, true);
  await rejectsMsdf(flags, context, 'RECORD_FLAGS');

  const emptyPlane = embeddedBytes.slice();
  const emptyPlaneView = new DataView(emptyPlane.buffer);
  emptyPlaneView.setInt16(
    recordsStart + present * 20 + 4,
    emptyPlaneView.getInt16(recordsStart + present * 20, true),
    true,
  );
  await rejectsMsdf(emptyPlane, context, 'RECORD_PLANE_BOUNDS');

  const atlasBounds = embeddedBytes.slice();
  new DataView(atlasBounds.buffer).setUint16(recordsStart + present * 20 + 12, 0xffff, true);
  await rejectsMsdf(atlasBounds, context, 'RECORD_ATLAS_BOUNDS');

  const duplicateVariant = structuredClone(decoded.document);
  duplicateVariant.extensions[MSDF_EXTENSION].pages[0].variants.push(
    structuredClone(duplicateVariant.extensions[MSDF_EXTENSION].pages[0].variants[0]),
  );
  await rejectsMsdf(rewriteGlbDocument(embeddedBytes, duplicateVariant), context, 'VARIANT_COUNT');

  const pageViewIndex = extension.pages[0].variants[0].source.bufferView;
  const pageView = decoded.document.bufferViews[pageViewIndex];
  const badKtx = embeddedBytes.slice();
  badKtx[decoded.binStart + pageView.byteOffset] ^= 0xff;
  await rejectsMsdf(badKtx, context, 'KTX2_INVALID');

  const badDfd = embeddedBytes.slice();
  badDfd[decoded.binStart + pageView.byteOffset + 118] = 2;
  await rejectsMsdf(badDfd, context, 'KTX2_DFD');

  await rejectsMsdf(embeddedBytes, { ...context, limits: { maxGpuBytes: 1 } }, 'GPU_BUDGET');
  // The individual Inter pages total 39,111,736 bytes, but the runtime allocates one
  // 1024×1024×10-layer RGBA8 texture array (41,943,040 bytes).
  await rejectsMsdf(embeddedBytes, { ...context, limits: { maxGpuBytes: 40_000_000 } }, 'GPU_BUDGET');
  await rejectsMsdf(rasterArtifact.bytes, context, 'EXTERNAL_PAGE_MISSING');

  const tamperedExternalPages = new Map(pageArtifacts.map(({ id, bytes }) => [id, bytes.slice()]));
  const firstPage = tamperedExternalPages.values().next().value;
  firstPage[firstPage.byteLength - 1] ^= 1;
  await rejectsMsdf(
    rasterArtifact.bytes,
    { ...context, externalPages: tamperedExternalPages },
    'EXTERNAL_PAGE_FINGERPRINT',
  );
}

async function rejectsMsdf(bytes, context, codePrefix) {
  await assert.rejects(
    validateMsdfArtifact(bytes, context),
    (error) =>
      error instanceof MsdfArtifactValidationError && error.issues.some(({ code }) => code.startsWith(codePrefix)),
  );
}

function embedRasterPages(rasterBytes, pageArtifacts) {
  const { document, views } = glbViews(rasterBytes);
  const extension = document.extensions[MSDF_EXTENSION];
  const records = views[extension.recordBufferView];
  assert.ok(records);
  const embeddedDocument = structuredClone(document);
  embeddedDocument.extensions[MSDF_EXTENSION].recordBufferView = 0;
  for (const [pageIndex, page] of embeddedDocument.extensions[MSDF_EXTENSION].pages.entries()) {
    page.variants[0].source = { type: 'bufferView', bufferView: pageIndex + 1 };
  }
  return buildGlb(embeddedDocument, [records, ...pageArtifacts.map(({ bytes }) => bytes)]);
}

function buildGlb(document, chunks) {
  const bufferViews = [];
  let binLength = 0;
  for (const bytes of chunks) {
    binLength = align4(binLength);
    bufferViews.push({ buffer: 0, byteOffset: binLength, byteLength: bytes.byteLength });
    binLength += bytes.byteLength;
  }
  const declaredBinLength = binLength;
  const paddedBinLength = align4(binLength);
  const root = structuredClone(document);
  root.buffers = [{ byteLength: declaredBinLength }];
  root.bufferViews = bufferViews;
  const json = new TextEncoder().encode(JSON.stringify(root));
  const paddedJsonLength = align4(json.byteLength);
  const output = new Uint8Array(12 + 8 + paddedJsonLength + 8 + paddedBinLength);
  output.fill(0x20, 20, 20 + paddedJsonLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0x4654_6c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, output.byteLength, true);
  view.setUint32(12, paddedJsonLength, true);
  view.setUint32(16, 0x4e4f_534a, true);
  output.set(json, 20);
  const binHeader = 20 + paddedJsonLength;
  view.setUint32(binHeader, paddedBinLength, true);
  view.setUint32(binHeader + 4, 0x004e_4942, true);
  for (const [index, bytes] of chunks.entries()) {
    output.set(bytes, binHeader + 8 + bufferViews[index].byteOffset);
  }
  return output;
}

function decodeGlb(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  return {
    document: glbRoot(bytes),
    binStart: 20 + jsonLength + 8,
  };
}

function rewriteGlbDocument(source, document) {
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const oldJsonLength = view.getUint32(12, true);
  const oldBinHeader = 20 + oldJsonLength;
  const binLength = view.getUint32(oldBinHeader, true);
  const bin = source.subarray(oldBinHeader + 8, oldBinHeader + 8 + binLength);
  const json = new TextEncoder().encode(JSON.stringify(document));
  const paddedJsonLength = align4(json.byteLength);
  const output = new Uint8Array(12 + 8 + paddedJsonLength + 8 + bin.byteLength);
  output.fill(0x20, 20, 20 + paddedJsonLength);
  const outputView = new DataView(output.buffer);
  outputView.setUint32(0, 0x4654_6c67, true);
  outputView.setUint32(4, 2, true);
  outputView.setUint32(8, output.byteLength, true);
  outputView.setUint32(12, paddedJsonLength, true);
  outputView.setUint32(16, 0x4e4f_534a, true);
  output.set(json, 20);
  const binHeader = 20 + paddedJsonLength;
  outputView.setUint32(binHeader, bin.byteLength, true);
  outputView.setUint32(binHeader + 4, 0x004e_4942, true);
  output.set(bin, binHeader + 8);
  return output;
}

function align4(value) {
  return (value + 3) & ~3;
}

async function exerciseRuntime(result, rasterArtifact, extension, rasterKey) {
  const { document, views } = glbViews(rasterArtifact.bytes);
  const records = views[extension.recordBufferView];
  assert.ok(records);
  const pageArtifacts = result.artifacts.filter((artifact) => artifact.role === 'raster-page');
  const runtimeExtension = structuredClone(extension);
  for (const [pageIndex, page] of runtimeExtension.pages.entries()) {
    page.variants[0].source = { type: 'bufferView', bufferView: pageIndex + 1 };
  }
  const font = {
    handle: 7,
    shapingFingerprint,
    glyphCount: 2937,
  };
  const runtimeRaster = {
    font: font.handle,
    handle: 11,
    kind: 'msdf',
    extension: MSDF_EXTENSION,
    version: 0,
    rasterKey,
    extensionData: runtimeExtension,
    view(index) {
      if (index === 0) return records;
      const page = pageArtifacts[index - 1];
      if (page === undefined) throw new RangeError('missing synthetic MSDF runtime view');
      return page.bytes;
    },
    dispose() {},
  };
  assert.equal(document.extensions[MSDF_EXTENSION].recordBufferView, 0);
  const data = await msdf.decode(font, runtimeRaster);
  assert.equal(data.records.byteLength, 2937 * 20);
  assert.equal(data.pages.length, 10);
  assert.deepEqual(data.binding, { width: 1024, height: 1024, layers: 10 });
  // Decoded pages carry their own bytes, not the padded binding. This Inter atlas has unequal page sizes inside a
  // 1024x1024x10 binding, so retaining actual page bytes holds 37.3 MiB where padding every page to the binding would
  // hold 40 MiB. The technique ends at CPU data; padding into the texture array is the engine target's work.
  const paddedBindingBytes = data.binding.width * data.binding.height * data.binding.layers * 4;
  const decodedPageBytes = data.pages.reduce((bytes, page) => bytes + page.bytes.byteLength, 0);
  assert.equal(paddedBindingBytes, 41_943_040);
  assert.equal(decodedPageBytes, 39_111_736);
  assert.ok(decodedPageBytes < paddedBindingBytes, 'decoded pages must not carry the binding padding');

  const glyphIds = firstPresentGlyphByPage(records, data.pages.length);
  const recordView = new DataView(records.buffer, records.byteOffset, records.byteLength);
  assert.deepEqual(
    [...glyphIds].map((glyphId) => recordView.getUint16(glyphId * 20 + 16, true)),
    [...glyphIds.keys()],
    'each baked page keeps its own record page index',
  );
  msdf.dispose(data);
}

function glbViews(bytes) {
  const document = glbRoot(bytes);
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = data.getUint32(12, true);
  const binaryStart = 20 + jsonLength + 8;
  return {
    document,
    views: document.bufferViews.map(({ byteOffset = 0, byteLength }) =>
      bytes.subarray(binaryStart + byteOffset, binaryStart + byteOffset + byteLength),
    ),
  };
}

function firstPresentGlyphByPage(records, pageCount) {
  const view = new DataView(records.buffer, records.byteOffset, records.byteLength);
  const glyphs = new Uint16Array(pageCount);
  const found = new Uint8Array(pageCount);
  for (let glyphId = 0; glyphId < records.byteLength / 20; glyphId += 1) {
    const pageIndex = view.getUint16(glyphId * 20 + 16, true);
    if (pageIndex === 0xffff || found[pageIndex] === 1) continue;
    glyphs[pageIndex] = glyphId;
    found[pageIndex] = 1;
    if (found.every((value) => value === 1)) return glyphs;
  }
  throw new Error('canonical MSDF fixture has no present glyph on every page');
}

function firstPresentGlyph(records) {
  const view = new DataView(records.buffer, records.byteOffset, records.byteLength);
  for (let glyphId = 0; glyphId < records.byteLength / 20; glyphId += 1) {
    if (view.getUint16(glyphId * 20 + 16, true) !== 0xffff) return glyphId;
  }
  throw new Error('canonical MSDF fixture has no present glyph');
}

function fakeMsdfBakerInstance({ allocate = () => 0, deallocate = () => undefined, segmented = {} } = {}) {
  const memory = new WebAssembly.Memory({ initial: 1 });
  return {
    exports: {
      memory,
      pmndrs_glyph_mtsdf_alloc: allocate,
      pmndrs_glyph_mtsdf_dealloc: deallocate,
      pmndrs_glyph_mtsdf_bake: () => 0,
      pmndrs_glyph_mtsdf_bake_result_len: () => 0,
      pmndrs_glyph_mtsdf_segmented_status: segmented.status ?? (() => -1),
      pmndrs_glyph_mtsdf_segmented_metadata_ptr: segmented.metadataPointer ?? (() => 0),
      pmndrs_glyph_mtsdf_segmented_metadata_len: segmented.metadataByteLength ?? (() => 0),
      pmndrs_glyph_mtsdf_segmented_artifact_count: segmented.artifactCount ?? (() => 0),
      pmndrs_glyph_mtsdf_segmented_artifact_len: segmented.artifactByteLength ?? (() => 0),
      pmndrs_glyph_mtsdf_segmented_chunk_ptr: segmented.chunkPointer ?? (() => 0),
      pmndrs_glyph_mtsdf_segmented_chunk_len: segmented.chunkByteLength ?? (() => 0),
      pmndrs_glyph_mtsdf_segmented_release: segmented.release ?? (() => undefined),
    },
  };
}
