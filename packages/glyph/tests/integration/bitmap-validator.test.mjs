import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test, { before } from 'node:test';

import { bitmapBakerFromCore, createBitmapBaker } from '@pmndrs/glyph/bakers/bitmap';
import { BitmapArtifactValidationError, validateBitmapArtifact } from '../../dist/bakers/bitmap-validator.js';
import { bitmapDescriptor, bitmapRasterKey } from '@pmndrs/glyph/raster/bitmap';
import { interShapingFingerprint, interSourceFingerprint } from '../support/inter-identity.mjs';
import { compatibilityFingerprint } from '../../dist/internal/raster-identity.js';

const GLB_MAGIC = 0x4654_6c67;
const JSON_CHUNK = 0x4e4f_534a;
const BIN_CHUNK = 0x004e_4942;
const shapingFingerprint = interShapingFingerprint;
const descriptor = bitmapDescriptor({ strikes: [16] });
let rasterKey;
let embedded;
let external;
let context;
let golden;
let sourceBytes;

before(async () => {
  const [wasm, source, goldenBytes] = await Promise.all([
    readFile(new URL('../../dist/bitmap-baker.wasm', import.meta.url)),
    readFile(new URL('../../../../apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf', import.meta.url)),
    readFile(new URL('../fixtures/inter-bitmap-v0.json', import.meta.url)),
  ]);
  sourceBytes = source;
  golden = JSON.parse(goldenBytes);
  rasterKey = bitmapRasterKey({ strikes: [16] });
  const baker = bitmapBakerFromCore(await createBitmapBaker(wasm));
  const font = {
    source,
    sourceFingerprint: interSourceFingerprint,
    fontFaceIndex: 0,
    glyphCount: 2937,
    shapingFingerprint,
  };
  [embedded, external] = await Promise.all([
    baker.bake({
      font,
      rasterKey,
      packaging: { artifact: 'external' },
      descriptor,
    }),
    baker.bake({
      font,
      rasterKey,
      packaging: { artifact: 'external' },
      descriptor,
    }),
  ]);
  context = { rasterKey, shapingFingerprint, glyphCount: 2937, glyphIdWidth: 16, descriptor };
});

test('matches the exact canonical Inter bitmap identities and payload bytes', async () => {
  assert.deepEqual(
    { bytes: sourceBytes.byteLength, sha256: hash(sourceBytes) },
    { bytes: golden.source.bytes, sha256: golden.source.sha256 },
  );
  assert.equal(rasterKey, golden.rasterKey);
  assert.deepEqual(descriptor, golden.descriptor);
  assert.deepEqual(
    embedded.artifacts.map(({ role, id, bytes, fingerprint }) => ({
      role,
      id,
      bytes: bytes.byteLength,
      fingerprint,
      sha256: hash(bytes),
    })),
    golden.embedded.artifacts,
  );
  assert.deepEqual(
    external.artifacts.map(({ role, id, bytes, fingerprint }) => ({
      role,
      id,
      bytes: bytes.byteLength,
      fingerprint,
      sha256: hash(bytes),
    })),
    golden.external.artifacts,
  );
  assert.deepEqual(embedded.report, golden.embedded.report);
  assert.deepEqual(external.report, golden.external.report);
  const embeddedValidation = await validateBitmapArtifact(embedded.artifacts[0].bytes, context);
  const externalValidation = await validateBitmapArtifact(external.artifacts[0].bytes, context);
  assert.equal(hash(embeddedValidation.strikes[0].records), golden.records.sha256);
  assert.equal(embeddedValidation.strikes[0].records.byteLength, golden.records.bytes);
  assert.deepEqual(summarizePages(embeddedValidation), golden.embedded.pages);
  assert.deepEqual(summarizePages(externalValidation), golden.external.pages);
});

test('round-trips embedded and split Inter pages through every bitmap validation layer', async () => {
  const embeddedResult = await validateBitmapArtifact(embedded.artifacts[0].bytes, context);
  assert.equal(embeddedResult.strikes.length, 1);
  assert.equal(embeddedResult.strikes[0].records.byteLength, 2937 * 20);
  assert.ok(embeddedResult.strikes[0].pages.every(({ source }) => source === 'embedded'));
  assert.equal(embeddedResult.khronos.validatorVersion, '2.0.0-dev.3.10');
  assert.equal(embeddedResult.khronos.issues.numErrors, 0);
  assert.equal(embeddedResult.khronos.issues.numWarnings, 0);

  // A split companion carries its pages the same way an embedded raster does; only the file it
  // travels in differs.
  const externalResult = await validateBitmapArtifact(external.artifacts[0].bytes, context);
  assert.ok(externalResult.strikes[0].pages.every(({ source }) => source === 'embedded'));
  assert.deepEqual(externalResult.strikes[0].records, embeddedResult.strikes[0].records);
});

test('keeps every packaged bitmap schema byte-identical to its canonical source', async () => {
  const pairs = [
    [
      '../../../../.agents/docs/planning/extensions/PMNDRS_font_bitmap/schema/glTF.PMNDRS_font_bitmap.schema.json',
      '../../src/bakers/schemas/glTF.PMNDRS_font_bitmap.schema.json',
    ],
    [
      '../../../../.agents/docs/planning/extensions/schema/resourceSource.PMNDRS_font.schema.json',
      '../../src/bakers/schemas/resourceSource.PMNDRS_font.schema.json',
    ],
    [
      '../../../../.agents/docs/planning/extensions/schema/textureResource.PMNDRS_font.schema.json',
      '../../src/bakers/schemas/textureResource.PMNDRS_font.schema.json',
    ],
    [
      '../../../../.agents/docs/planning/extensions/schema/texturePages.PMNDRS_font.schema.json',
      '../../src/bakers/schemas/texturePages.PMNDRS_font.schema.json',
    ],
  ];
  for (const [canonical, packaged] of pairs) {
    assert.deepEqual(
      await readFile(new URL(canonical, import.meta.url)),
      await readFile(new URL(packaged, import.meta.url)),
    );
  }
});

test('covers every required bitmap field one deletion at a time', async () => {
  const base = decodeGlb(embedded.artifacts[0].bytes).document;
  const root = ['extensions', 'PMNDRS_font_bitmap'];
  const required = [
    [...root, 'version'],
    [...root, 'rasterKey'],
    [...root, 'fingerprint'],
    [...root, 'strikes'],
    ...['ppemX', 'ppemY', 'planeUnitsPerEm', 'recordBufferView', 'recordStride', 'pages'].map((field) => [
      ...root,
      'strikes',
      0,
      field,
    ]),
    ...['width', 'height', 'mipLevelCount', 'colorSpace', 'variants'].map((field) => [
      ...root,
      'strikes',
      0,
      'pages',
      0,
      field,
    ]),
    ...['source', 'container', 'gpuFormat', 'quality'].map((field) => [
      ...root,
      'strikes',
      0,
      'pages',
      0,
      'variants',
      0,
      field,
    ]),
  ];
  for (const path of required) {
    const document = structuredClone(base);
    delete atPath(document, path)[path.at(-1)];
    await rejectsWithPrefix(encodeGlb(embedded.artifacts[0].bytes, document), 'SCHEMA_');
  }
});

test('rejects reciprocal identity, strike, record, page, KTX2, and budget mutations', async () => {
  const bytes = embedded.artifacts[0].bytes;
  const decoded = decodeGlb(bytes);
  const extension = decoded.document.extensions.PMNDRS_font_bitmap;
  const strike = extension.strikes[0];
  const recordView = decoded.document.bufferViews[strike.recordBufferView];
  const recordsStart = decoded.binStart + recordView.byteOffset;
  const present = findRecord(bytes, recordsStart, 2937, (view, offset) => view.getUint16(offset + 16, true) !== 0xffff);
  const absent = findRecord(bytes, recordsStart, 2937, (view, offset) => view.getUint16(offset + 16, true) === 0xffff);

  const wrongIdentity = structuredClone(decoded.document);
  wrongIdentity.extensions.PMNDRS_font_bitmap.fingerprint = '0'.repeat(32);
  await rejectsWithCode(encodeGlb(bytes, wrongIdentity), 'RECIPROCAL_IDENTITY');

  const wrongStrike = structuredClone(decoded.document);
  wrongStrike.extensions.PMNDRS_font_bitmap.strikes[0].ppemX = 17;
  await rejectsWithCode(encodeGlb(bytes, wrongStrike), 'STRIKE_TUPLE');

  const flags = bytes.slice();
  new DataView(flags.buffer).setUint16(recordsStart + present * 20 + 18, 1, true);
  await rejectsWithCode(flags, 'RECORD_FLAGS');

  const absentData = bytes.slice();
  absentData[recordsStart + absent * 20] = 1;
  await rejectsWithCode(absentData, 'RECORD_ABSENT_DATA');

  const missingPage = bytes.slice();
  new DataView(missingPage.buffer).setUint16(recordsStart + present * 20 + 16, 0xfffe, true);
  await rejectsWithCode(missingPage, 'RECORD_PAGE');

  const atlasBounds = bytes.slice();
  new DataView(atlasBounds.buffer).setUint16(recordsStart + present * 20 + 12, 0xffff, true);
  await rejectsWithCode(atlasBounds, 'RECORD_ATLAS_BOUNDS');

  const pageViewIndex = strike.pages[0].variants[0].source.bufferView;
  const pageView = decoded.document.bufferViews[pageViewIndex];
  const badKtx = bytes.slice();
  badKtx[decoded.binStart + pageView.byteOffset] ^= 0xff;
  await rejectsWithCode(badKtx, 'KTX2_INVALID');

  const wrongFeature = structuredClone(decoded.document);
  wrongFeature.extensions.PMNDRS_font_bitmap.strikes[0].pages[0].variants[0].requiredFeature = 'texture-compression-bc';
  await rejectsWithCode(encodeGlb(bytes, wrongFeature), 'VARIANT_CONTRACT');

  const unsupportedFormat = structuredClone(decoded.document);
  unsupportedFormat.extensions.PMNDRS_font_bitmap.strikes[0].pages[0].variants[0].gpuFormat = 'rgba8unorm';
  await rejectsWithCode(encodeGlb(bytes, unsupportedFormat), 'BITMAP_GPU_FORMAT');

  const mislabeledCompressed = structuredClone(decoded.document);
  Object.assign(mislabeledCompressed.extensions.PMNDRS_font_bitmap.strikes[0].pages[0].variants[0], {
    gpuFormat: 'bc4-r-unorm',
    quality: 'quality-gated',
    requiredFeature: 'texture-compression-bc',
  });
  await rejectsWithCode(encodeGlb(bytes, mislabeledCompressed), 'KTX2_VARIANT');

  const duplicateFormat = structuredClone(decoded.document);
  duplicateFormat.extensions.PMNDRS_font_bitmap.strikes[0].pages[0].variants.push(
    structuredClone(duplicateFormat.extensions.PMNDRS_font_bitmap.strikes[0].pages[0].variants[0]),
  );
  await rejectsWithCode(encodeGlb(bytes, duplicateFormat), 'VARIANT_DUPLICATE');

  await rejectsWithCode(bytes, 'GPU_BUDGET', { ...context, limits: { maxGpuBytes: 1 } });
});

test('validates the pinned 65,535-glyph dense-record and multi-page boundary', async () => {
  const fixture = JSON.parse(
    await readFile(
      new URL('../../../../apps/benchmarks/fixtures/contracts/max-glyph-pages-v0.json', import.meta.url),
      'utf8',
    ),
  );
  const embeddedGlb = decodeGlb(embedded.artifacts[0].bytes);
  const embeddedPageView =
    embeddedGlb.document.bufferViews[
      embeddedGlb.document.extensions.PMNDRS_font_bitmap.strikes[0].pages[0].variants[0].source.bufferView
    ];
  const pageBytes = embedded.artifacts[0].bytes.subarray(
    embeddedGlb.binStart + embeddedPageView.byteOffset,
    embeddedGlb.binStart + embeddedPageView.byteOffset + embeddedPageView.byteLength,
  );
  const page = golden.external.pages[0];
  const records = new Uint8Array(fixture.expectedRecordBytes);
  const recordView = new DataView(records.buffer);
  const absent = new Set(fixture.absentGlyphIds);
  for (let glyphId = 0; glyphId < fixture.glyphCount; glyphId += 1) {
    const offset = glyphId * fixture.recordStride;
    if (absent.has(glyphId)) {
      recordView.setUint16(offset + 16, fixture.absenceSentinel, true);
      continue;
    }
    recordView.setInt16(offset + 4, 1, true);
    recordView.setInt16(offset + 6, 1, true);
    recordView.setUint16(offset + 12, 1, true);
    recordView.setUint16(offset + 14, 1, true);
    recordView.setUint16(offset + 16, Math.floor(glyphId / fixture.pageCapacity), true);
  }
  // Every page points at the one KTX2 view carried in this artifact: pages are never files.
  const alignedPage = (pageBytes.byteLength + 3) & ~3;
  const pageOffset = (records.byteLength + 3) & ~3;
  const recordsAndPage = new Uint8Array(pageOffset + alignedPage * fixture.logicalPageCount);
  recordsAndPage.set(records, 0);
  for (let index = 0; index < fixture.logicalPageCount; index += 1) {
    recordsAndPage.set(pageBytes, pageOffset + alignedPage * index);
  }
  const pages = Array.from({ length: fixture.logicalPageCount }, (_, index) => ({
    width: page.width,
    height: page.height,
    mipLevelCount: 1,
    colorSpace: 'linear',
    variants: [
      {
        source: { type: 'bufferView', bufferView: 1 + index },
        container: 'ktx2',
        gpuFormat: 'r8unorm',
        quality: 'lossless',
      },
    ],
  }));
  const document = {
    asset: { version: '2.0' },
    extensionsUsed: ['PMNDRS_font_bitmap'],
    extensionsRequired: ['PMNDRS_font_bitmap'],
    extensions: {
      PMNDRS_font_bitmap: {
        version: 0,
        rasterKey,
        fingerprint: compatibilityFingerprint({
          glyphCount: fixture.glyphCount,
          glyphIdWidth: 16,
          kind: 'bitmap',
          rasterKey,
          shaping: shapingFingerprint,
          version: 0,
        }),
        strikes: [
          {
            ppemX: 16,
            ppemY: 16,
            planeUnitsPerEm: 2048,
            recordBufferView: 0,
            recordStride: 20,
            pages,
          },
        ],
      },
    },
    buffers: [{ byteLength: recordsAndPage.byteLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: records.byteLength },
      ...Array.from({ length: fixture.logicalPageCount }, (_, index) => ({
        buffer: 0,
        byteOffset: pageOffset + alignedPage * index,
        byteLength: pageBytes.byteLength,
      })),
    ],
  };
  const result = await validateBitmapArtifact(buildGlb(document, recordsAndPage), {
    ...context,
    glyphCount: fixture.glyphCount,
  });
  assert.equal(result.strikes[0].records.byteLength, fixture.expectedRecordBytes);
  for (const glyphId of fixture.boundaryGlyphIds) {
    assert.equal(
      new DataView(result.strikes[0].records.buffer, result.strikes[0].records.byteOffset).getUint16(
        glyphId * 20 + 16,
        true,
      ),
      Math.floor(glyphId / fixture.pageCapacity),
    );
  }
});

async function rejectsWithCode(bytes, code, validationContext = context) {
  await assert.rejects(
    validateBitmapArtifact(bytes, validationContext),
    (error) => error instanceof BitmapArtifactValidationError && error.issues.some((issue) => issue.code === code),
  );
}

async function rejectsWithPrefix(bytes, prefix) {
  await assert.rejects(
    validateBitmapArtifact(bytes, context),
    (error) =>
      error instanceof BitmapArtifactValidationError && error.issues.some((issue) => issue.code.startsWith(prefix)),
  );
}

function findRecord(bytes, recordsStart, count, predicate) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let glyphId = 0; glyphId < count; glyphId += 1) {
    if (predicate(view, recordsStart + glyphId * 20)) return glyphId;
  }
  throw new Error('fixture does not contain the requested record kind');
}

function readU32(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

function decodeGlb(bytes) {
  const jsonLength = readU32(bytes, 12);
  const binHeader = 20 + jsonLength;
  assert.equal(readU32(bytes, 16), JSON_CHUNK);
  assert.equal(readU32(bytes, binHeader + 4), BIN_CHUNK);
  return {
    document: JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)).trimEnd()),
    binStart: binHeader + 8,
  };
}

function encodeGlb(source, document) {
  const oldJsonLength = readU32(source, 12);
  const oldBinHeader = 20 + oldJsonLength;
  const binLength = readU32(source, oldBinHeader);
  const bin = source.subarray(oldBinHeader + 8, oldBinHeader + 8 + binLength);
  const json = new TextEncoder().encode(JSON.stringify(document));
  const paddedJsonLength = (json.byteLength + 3) & ~3;
  const totalLength = 12 + 8 + paddedJsonLength + 8 + bin.byteLength;
  const output = new Uint8Array(totalLength);
  output.fill(0x20, 20, 20 + paddedJsonLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, paddedJsonLength, true);
  view.setUint32(16, JSON_CHUNK, true);
  output.set(json, 20);
  const binHeader = 20 + paddedJsonLength;
  view.setUint32(binHeader, bin.byteLength, true);
  view.setUint32(binHeader + 4, BIN_CHUNK, true);
  output.set(bin, binHeader + 8);
  return output;
}

function buildGlb(document, binary) {
  const json = new TextEncoder().encode(JSON.stringify(document));
  const paddedJsonLength = (json.byteLength + 3) & ~3;
  const paddedBinLength = (binary.byteLength + 3) & ~3;
  const totalLength = 12 + 8 + paddedJsonLength + 8 + paddedBinLength;
  const output = new Uint8Array(totalLength);
  output.fill(0x20, 20, 20 + paddedJsonLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, paddedJsonLength, true);
  view.setUint32(16, JSON_CHUNK, true);
  output.set(json, 20);
  const binHeader = 20 + paddedJsonLength;
  view.setUint32(binHeader, paddedBinLength, true);
  view.setUint32(binHeader + 4, BIN_CHUNK, true);
  output.set(binary, binHeader + 8);
  return output;
}

function atPath(root, path) {
  return path.slice(0, -1).reduce((value, key) => value[key], root);
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function summarizePages(validation) {
  return validation.strikes.flatMap((strike) =>
    strike.pages.map(({ width, height, bytes, source, uri }) => ({
      ppem: strike.ppem,
      width,
      height,
      source,
      ...(uri === undefined ? {} : { uri }),
      bytes: bytes.byteLength,
      sha256: hash(bytes),
    })),
  );
}
