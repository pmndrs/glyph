import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test, { before } from 'node:test';

import { SlugArtifactValidationError, validateSlugArtifact } from '../../dist/bakers/slug-validator.js';
import { slugDescriptor, slugDescriptorRasterKey } from '../../dist/internal/slug-contract.js';

const GLB_MAGIC = 0x4654_6c67;
const JSON_CHUNK = 0x4e4f_534a;
const BIN_CHUNK = 0x004e_4942;
const shapingHash = '6a96d9c6f9e59fd6aeb51848413bd4dd8711730a5479a7d004979d80f3b3cd09';
let rasterKey;
let context;
let embedded;

before(async () => {
  rasterKey = await slugDescriptorRasterKey();
  context = {
    rasterKey,
    shapingHash,
    glyphCount: 2,
    glyphIdWidth: 16,
    descriptor: slugDescriptor(),
  };
  embedded = makeArtifact('embedded');
});

test('validates exact embedded and authenticated external Slug page resources', async () => {
  const embeddedResult = await validateSlugArtifact(embedded.bytes, context);
  assert.equal(embeddedResult.records.byteLength, 80);
  assert.deepEqual(
    embeddedResult.pages.map((page) => ({
      curve: page.curve.source,
      headers: page.headers.source,
      references: page.references.source,
    })),
    [{ curve: 'embedded', headers: 'embedded', references: 'embedded' }],
  );

  const external = makeArtifact('external');
  const externalResult = await validateSlugArtifact(external.bytes, {
    ...context,
    externalPages: external.resources,
  });
  assert.deepEqual(
    externalResult.pages.map((page) => ({
      curve: page.curve.source,
      headers: page.headers.source,
      references: page.references.source,
    })),
    [{ curve: 'external', headers: 'external', references: 'external' }],
  );
});

test('keeps package-owned Slug schemas byte-identical to their canonical sources', async () => {
  const pairs = [
    [
      '../../../../.agents/docs/planning/extensions/PMNDRS_font_slug/schema/glTF.PMNDRS_font_slug.schema.json',
      '../../src/bakers/schemas/glTF.PMNDRS_font_slug.schema.json',
    ],
    [
      '../../../../.agents/docs/planning/extensions/schema/binaryResource.PMNDRS_font.schema.json',
      '../../src/bakers/schemas/binaryResource.PMNDRS_font.schema.json',
    ],
    [
      '../../../../.agents/docs/planning/extensions/schema/resourceSource.PMNDRS_font.schema.json',
      '../../src/bakers/schemas/resourceSource.PMNDRS_font.schema.json',
    ],
    [
      '../../../../.agents/docs/planning/extensions/schema/textureResource.PMNDRS_font.schema.json',
      '../../src/bakers/schemas/textureResource.PMNDRS_font.schema.json',
    ],
  ];
  for (const [canonical, packaged] of pairs) {
    assert.deepEqual(
      await readFile(new URL(canonical, import.meta.url)),
      await readFile(new URL(packaged, import.meta.url)),
    );
  }
});

test('rejects identity, exact record, bounds, overflow, and address mutations', async () => {
  const wrongIdentity = structuredClone(embedded.document);
  wrongIdentity.extensions.PMNDRS_font_slug.shapingHash = '0'.repeat(64);
  await rejectsWithCode(buildGlb(wrongIdentity, embedded.binary), 'RECIPROCAL_IDENTITY');

  const shortRecord = structuredClone(embedded.document);
  shortRecord.bufferViews[0].byteLength = 40;
  const shortRecordBinary = embedded.binary.slice();
  shortRecordBinary.fill(0, 40, 80);
  await rejectsWithCode(buildGlb(shortRecord, shortRecordBinary), 'RECORD_LENGTH');

  const flags = embedded.binary.slice();
  new DataView(flags.buffer).setUint16(14, 1, true);
  await rejectsWithCode(buildGlb(embedded.document, flags), 'RECORD_FLAGS');

  const plane = embedded.binary.slice();
  new DataView(plane.buffer).setInt16(4, -100, true);
  await rejectsWithCode(buildGlb(embedded.document, plane), 'RECORD_PLANE_BOUNDS');

  const curveRange = embedded.binary.slice();
  new DataView(curveRange.buffer).setUint32(20, 0x1_0000, true);
  await rejectsWithCode(buildGlb(embedded.document, curveRange), 'RECORD_U16_OVERFLOW');

  const headerOverflow = embedded.binary.slice();
  const headerView = embedded.document.bufferViews[2];
  new DataView(headerOverflow.buffer).setUint32(headerView.byteOffset, (2 << 16) | 0, true);
  await rejectsWithCode(buildGlb(embedded.document, headerOverflow), 'HEADER_REFERENCE_RANGE');

  const rowBoundary = embedded.binary.slice();
  const referenceView = embedded.document.bufferViews[3];
  new DataView(rowBoundary.buffer).setUint16(referenceView.byteOffset, 3, true);
  await rejectsWithCode(buildGlb(embedded.document, rowBoundary), 'CURVE_ROW_BOUNDARY');

  const absentPayload = embedded.binary.slice();
  absentPayload[40] = 1;
  await rejectsWithCode(buildGlb(embedded.document, absentPayload), 'RECORD_ABSENT_DATA');
});

test('rejects malformed RGBA16F KTX2 data and nonzero integer-grid tails', async () => {
  const wrongDfd = embedded.binary.slice();
  const curveView = embedded.document.bufferViews[1];
  wrongDfd[curveView.byteOffset + 104 + 4 + 27] = 0;
  await rejectsWithCode(buildGlb(embedded.document, wrongDfd), 'KTX2_DFD');

  const nonzeroHeaderTail = embedded.binary.slice();
  const headerView = embedded.document.bufferViews[2];
  nonzeroHeaderTail[headerView.byteOffset + 8] = 1;
  await rejectsWithCode(buildGlb(embedded.document, nonzeroHeaderTail), 'GRID_ZERO_TAIL');

  const nonzeroReferenceTail = embedded.binary.slice();
  const referenceView = embedded.document.bufferViews[3];
  nonzeroReferenceTail[referenceView.byteOffset + 2] = 1;
  await rejectsWithCode(buildGlb(embedded.document, nonzeroReferenceTail), 'GRID_ZERO_TAIL');

  await rejectsWithCode(embedded.bytes, 'GPU_BUDGET', { ...context, limits: { maxGpuBytes: 1 } });
});

test('requires exact external lengths and hashes for every Slug page resource', async () => {
  const external = makeArtifact('external');
  await rejectsWithCode(external.bytes, 'EXTERNAL_PAGE_MISSING');

  const resources = new Map(external.resources);
  const curve = resources.get('curve.ktx2').slice();
  curve[curve.byteLength - 1] ^= 1;
  resources.set('curve.ktx2', curve);
  await rejectsWithCode(external.bytes, 'EXTERNAL_PAGE_HASH', {
    ...context,
    externalPages: resources,
  });
});

async function rejectsWithCode(bytes, code, validationContext = context) {
  await assert.rejects(
    validateSlugArtifact(bytes, validationContext),
    (error) => error instanceof SlugArtifactValidationError && error.issues.some((issue) => issue.code === code),
  );
}

function makeArtifact(packaging) {
  const records = makeRecords();
  const curve = makeRgba16fKtx2(4, 2, new Uint8Array(64));
  const headers = new Uint8Array(16);
  const headerView = new DataView(headers.buffer);
  headerView.setUint32(0, 1 << 16, true);
  headerView.setUint32(4, 1 << 16, true);
  const references = new Uint8Array(4);
  const resources = new Map([
    ['curve.ktx2', curve],
    ['headers.r32ui', headers],
    ['references.r16ui', references],
  ]);
  const binaries = packaging === 'embedded' ? [records, curve, headers, references] : [records];
  const { binary, bufferViews } = joinViews(binaries);
  const source = (name, index) =>
    packaging === 'embedded'
      ? { type: 'bufferView', bufferView: index }
      : {
          type: 'external',
          uri: name,
          byteLength: resources.get(name).byteLength,
          artifactHash: hash(resources.get(name)),
        };
  const document = {
    asset: { version: '2.0' },
    extensionsUsed: ['PMNDRS_font_slug'],
    extensionsRequired: ['PMNDRS_font_slug'],
    extensions: {
      PMNDRS_font_slug: {
        version: 0,
        rasterKey,
        shapingHash,
        glyphCount: 2,
        glyphIdWidth: 16,
        planeUnitsPerEm: 2048,
        recordBufferView: 0,
        recordStride: 40,
        pages: [
          {
            curve: {
              width: 4,
              height: 2,
              mipLevelCount: 1,
              colorSpace: 'linear',
              variants: [
                {
                  source: source('curve.ktx2', 1),
                  container: 'ktx2',
                  gpuFormat: 'rgba16float',
                  quality: 'lossless',
                },
              ],
            },
            headerCount: 2,
            headerWidth: 4,
            headerHeight: 1,
            headerResource: { source: source('headers.r32ui', 2) },
            referenceCount: 1,
            referenceWidth: 2,
            referenceHeight: 1,
            referenceResource: { source: source('references.r16ui', 3) },
          },
        ],
      },
    },
    buffers: [{ byteLength: binary.byteLength }],
    bufferViews,
  };
  return { bytes: buildGlb(document, binary), binary, document, resources };
}

function makeRecords() {
  const records = new Uint8Array(80);
  const view = new DataView(records.buffer);
  view.setInt16(0, -100, true);
  view.setInt16(2, -200, true);
  view.setInt16(4, 300, true);
  view.setInt16(6, 400, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, 1, true);
  view.setUint16(12, 1, true);
  view.setUint32(16, 0, true);
  view.setUint32(20, 5, true);
  view.setUint32(24, 0, true);
  view.setUint32(28, 1, true);
  view.setUint32(32, 0, true);
  view.setUint32(36, 1, true);
  view.setUint16(40 + 8, 0xffff, true);
  return records;
}

function joinViews(parts) {
  const byteLength = parts.reduce((total, part) => ((total + 3) & ~3) + part.byteLength, 0);
  const binary = new Uint8Array(byteLength);
  const bufferViews = [];
  let offset = 0;
  for (const part of parts) {
    offset = (offset + 3) & ~3;
    binary.set(part, offset);
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: part.byteLength });
    offset += part.byteLength;
  }
  return { binary, bufferViews };
}

function makeRgba16fKtx2(width, height, texels) {
  const dfd = Uint8Array.from([
    0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x58, 0x00, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x0f, 0xc0, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80, 0xbf, 0x00, 0x00,
    0x80, 0x3f, 0x10, 0x00, 0x0f, 0xc1, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80, 0xbf, 0x00, 0x00, 0x80, 0x3f, 0x20,
    0x00, 0x0f, 0xc2, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80, 0xbf, 0x00, 0x00, 0x80, 0x3f, 0x30, 0x00, 0x0f, 0xcf,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80, 0xbf, 0x00, 0x00, 0x80, 0x3f,
  ]);
  const dfdOffset = 104;
  const dfdLength = dfd.byteLength + 4;
  const levelOffset = (dfdOffset + dfdLength + 3) & ~3;
  const output = new Uint8Array(levelOffset + texels.byteLength);
  output.set([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
  const view = new DataView(output.buffer);
  view.setUint32(12, 97, true);
  view.setUint32(16, 2, true);
  view.setUint32(20, width, true);
  view.setUint32(24, height, true);
  view.setUint32(36, 1, true);
  view.setUint32(40, 1, true);
  view.setUint32(48, dfdOffset, true);
  view.setUint32(52, dfdLength, true);
  view.setBigUint64(80, BigInt(levelOffset), true);
  view.setBigUint64(88, BigInt(texels.byteLength), true);
  view.setBigUint64(96, BigInt(texels.byteLength), true);
  view.setUint32(dfdOffset, dfdLength, true);
  output.set(dfd, dfdOffset + 4);
  output.set(texels, levelOffset);
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

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
