import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test, { before } from 'node:test';

import { createFontBaker } from '../../../dist/font-baker/index.js';
import { FONT_BAKER_VERSION, FONT_FORMAT_VERSION } from '../../../dist/font-baker/contract.js';
import { FontArtifactValidationError, validateFontArtifact } from '../../../dist/font-baker/validator.js';
import { fontBakerWasmUrl } from '../../../dist/font-baker/wasm-url.js';

const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
let artifact;
let cjkProfileArtifact;

before(async () => {
  const [source, wasm] = await Promise.all([
    readFile(new URL('../../../../../apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf', import.meta.url)),
    readFile(new URL('../../../dist/font-baker.wasm', import.meta.url)),
  ]);
  const baker = await createFontBaker(wasm);
  artifact = baker.bake({ source, descriptor: { formatVersion: 0, fontFaceIndex: 0 } }).artifacts[0].bytes;
  const cjkProfileSource = source.slice();
  for (const [sourceTag, retainedTag] of [
    ['cvt ', 'BASE'],
    ['fpgm', 'vhea'],
    ['gasp', 'vmtx'],
    ['name', 'VORG'],
  ]) {
    const record = sourceTableRecord(cjkProfileSource, sourceTag);
    cjkProfileSource.write(retainedTag, record, 4, 'ascii');
  }
  cjkProfileArtifact = baker.bake({
    source: cjkProfileSource,
    descriptor: { formatVersion: 0, fontFaceIndex: 0 },
  }).artifacts[0].bytes;
});

test('validates the canonical Inter artifact through every core layer', async () => {
  const result = await validateFontArtifact(artifact);

  assert.equal(result.glyphCount, 2937);
  assert.equal(result.shapingHash, '6a96d9c6f9e59fd6aeb51848413bd4dd8711730a5479a7d004979d80f3b3cd09');
  assert.equal(result.shapingSfnt.byteLength, 147192);
  assert.equal(result.glyphExtents.byteLength, 23496);
  assert.equal(result.glyphExtentsAvailability.byteLength, 368);
  assert.equal(result.khronos.validatorVersion, '2.0.0-dev.3.10');
  assert.deepEqual(
    result.khronos.issues.messages.map(({ code, severity, pointer }) => ({
      code,
      severity,
      pointer,
    })),
    [
      { code: 'UNSUPPORTED_EXTENSION', severity: 2, pointer: '/extensionsUsed/0' },
      { code: 'UNUSED_OBJECT', severity: 2, pointer: '/bufferViews/0' },
      { code: 'UNUSED_OBJECT', severity: 2, pointer: '/bufferViews/1' },
      { code: 'UNUSED_OBJECT', severity: 2, pointer: '/bufferViews/2' },
    ],
  );
});

test('validates Node Buffer inputs repeatedly without mutating artifact bytes', async () => {
  const input = Buffer.from(artifact);
  const original = Buffer.from(input);

  const first = await validateFontArtifact(input);
  const second = await validateFontArtifact(input);

  assert.deepEqual(input, original);
  assert.equal(second.shapingHash, first.shapingHash);
  assert.deepEqual(second.shapingSfnt, first.shapingSfnt);
});

test('accepts only the expanded closed CJK shaping-table profile', async () => {
  const validated = await validateFontArtifact(cjkProfileArtifact);
  assert.deepEqual(sourceTableTags(validated.shapingSfnt), [
    'BASE',
    'GDEF',
    'GPOS',
    'GSUB',
    'OS/2',
    'VORG',
    'cmap',
    'head',
    'hhea',
    'hmtx',
    'maxp',
    'vhea',
    'vmtx',
  ]);

  const outsideProfile = artifact.slice();
  const decoded = decodeDocument(outsideProfile);
  const shaping = decoded.document.extensions.PMNDRS_font.shaping;
  const shapingView = decoded.document.bufferViews[shaping.bufferView];
  outsideProfile.set(new TextEncoder().encode('JSTF'), decoded.binStart + shapingView.byteOffset + 12);
  await rejectsWithCode(outsideProfile, 'SFNT_TABLE_PROFILE');

  const nonAsciiTag = artifact.slice();
  nonAsciiTag[decoded.binStart + shapingView.byteOffset + 12] |= 0x80;
  await rejectsWithCode(nonAsciiTag, 'SFNT_TABLE_PROFILE');
});

test('keeps the packaged extension schema byte-identical to the canonical schema', async () => {
  const [canonical, packaged, manifestSource, coreSource, schemaFiles, sourceLicense, distributedLicense] =
    await Promise.all([
      readFile(
        new URL(
          '../../../../../docs/planning/extensions/PMNDRS_font/schema/glTF.PMNDRS_font.schema.json',
          import.meta.url,
        ),
      ),
      readFile(new URL('../../../src/font-baker/schemas/extensions/glTF.PMNDRS_font.schema.json', import.meta.url)),
      readFile(new URL('../../../package.json', import.meta.url), 'utf8'),
      readFile(new URL('../../../dist/font-baker/index.js', import.meta.url), 'utf8'),
      readdir(new URL('../../../src/font-baker/schemas/gltf-2.0/', import.meta.url)),
      readFile(new URL('../../../src/font-baker/schemas/KHRONOS-SPEC-LICENSE.txt', import.meta.url)),
      readFile(new URL('../../../dist/font-baker/schemas/KHRONOS-SPEC-LICENSE.txt', import.meta.url)),
    ]);
  assert.deepEqual(packaged, canonical);
  assert.equal(schemaFiles.filter((name) => name.endsWith('.json')).length, 33);
  assert.deepEqual(distributedLicense, sourceLicense);

  const manifest = JSON.parse(manifestSource);
  assert.deepEqual(manifest.exports['./bake'], {
    types: {
      source: './src/node/bake.ts',
      default: './dist/node/bake.d.ts',
    },
    source: './src/node/bake.ts',
    import: './dist/node/bake.js',
  });
  assert.equal(FONT_BAKER_VERSION, manifest.version);
  assert.equal(FONT_FORMAT_VERSION, 0);
  assert.equal(fontBakerWasmUrl, new URL('../../../dist/font-baker.wasm', import.meta.url).href);
  assert.doesNotMatch(coreSource, /(?:ajv|gltf-validator|validator\.js)/);

  const property = JSON.parse(
    await readFile(
      new URL('../../../src/font-baker/schemas/gltf-2.0/glTFProperty.schema.json', import.meta.url),
      'utf8',
    ),
  );
  assert.equal(property.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(property.$id, 'glTFProperty.schema.json');
});

test('rejects malformed GLB framing before schema or payload work', async () => {
  const cases = [
    ['GLB_MAGIC', mutateU32(artifact, 0, 0)],
    ['GLB_VERSION', mutateU32(artifact, 4, 1)],
    ['GLB_LENGTH', mutateU32(artifact, 8, artifact.byteLength - 4)],
    ['GLB_CHUNK_ORDER', mutateU32(artifact, 16, BIN_CHUNK)],
    ['GLB_CHUNK_ALIGNMENT', mutateU32(artifact, 12, readU32(artifact, 12) - 1)],
  ];
  for (const [code, bytes] of cases) await rejectsWithCode(bytes, code);

  const invalidJson = artifact.slice();
  assert.equal(invalidJson[20], 0x7b);
  invalidJson[20] = 0;
  await rejectsWithCode(invalidJson, 'GLB_JSON');
});

test('covers every PMNDRS_font required field and raster-source union one field at a time', async () => {
  const base = decodeDocument(artifact).document;
  const fontPath = ['extensions', 'PMNDRS_font'];
  const requiredPaths = [
    [...fontPath, 'version'],
    [...fontPath, 'shaping'],
    [...fontPath, 'metrics'],
    [...fontPath, 'provenance'],
    [...fontPath, 'rasters'],
    [...fontPath, 'shaping', 'format'],
    [...fontPath, 'shaping', 'bufferView'],
    [...fontPath, 'shaping', 'hash'],
    [...fontPath, 'shaping', 'fontFunctions'],
    [...fontPath, 'shaping', 'fontFunctions', 'glyphExtentsBufferView'],
    [...fontPath, 'shaping', 'fontFunctions', 'glyphExtentsStride'],
    [...fontPath, 'shaping', 'fontFunctions', 'glyphExtentsAvailabilityBufferView'],
    ...[
      'glyphCount',
      'glyphIdWidth',
      'unitsPerEm',
      'ascender',
      'descender',
      'lineGap',
      'underlinePosition',
      'underlineThickness',
      'strikeoutPosition',
      'strikeoutSize',
    ].map((name) => [...fontPath, 'metrics', name]),
    ...[
      'sourceHash',
      'descriptorHash',
      'fontFaceIndex',
      'bakerVersion',
      'harfrustVersion',
      'harfbuzzReferenceVersion',
      'unicodeVersion',
    ].map((name) => [...fontPath, 'provenance', name]),
  ];
  for (const path of requiredPaths) {
    const document = structuredClone(base);
    delete atPath(document, path)[path.at(-1)];
    await rejectsWithPrefix(encodeDocument(artifact, document), 'SCHEMA_');
  }

  const rasterBase = structuredClone(base);
  rasterBase.extensions.PMNDRS_font.rasters = [
    {
      rasterKey: 'a'.repeat(64),
      kind: 'bitmap',
      extension: 'PMNDRS_font_bitmap',
      version: 0,
      source: { type: 'external' },
    },
  ];
  await validateFontArtifact(encodeDocument(artifact, rasterBase));
  for (const field of ['rasterKey', 'kind', 'extension', 'version', 'source']) {
    const document = structuredClone(rasterBase);
    delete document.extensions.PMNDRS_font.rasters[0][field];
    await rejectsWithPrefix(encodeDocument(artifact, document), 'SCHEMA_');
  }
  for (const source of [
    {},
    { type: 'unknown' },
    { type: 'embedded', uri: 'forbidden.glb' },
    { type: 'external', uri: '' },
    { type: 'external', uri: 'raster.glb' },
  ]) {
    const document = structuredClone(rasterBase);
    document.extensions.PMNDRS_font.rasters[0].source = source;
    await rejectsWithPrefix(encodeDocument(artifact, document), 'SCHEMA_');
  }
});

test('rejects semantic and embedded-payload mutations deterministically', async () => {
  const decoded = decodeDocument(artifact);

  const incompatible = structuredClone(decoded.document);
  incompatible.extensions.PMNDRS_font.provenance.harfrustVersion = '0.13.0';
  await rejectsWithCode(encodeDocument(artifact, incompatible), 'FONT_VERSION_INCOMPATIBLE');

  const wrongHash = structuredClone(decoded.document);
  wrongHash.extensions.PMNDRS_font.shaping.hash = '0'.repeat(64);
  await rejectsWithCode(encodeDocument(artifact, wrongHash), 'SHAPING_HASH');

  const unclaimed = structuredClone(decoded.document);
  unclaimed.bufferViews.push(structuredClone(unclaimed.bufferViews[2]));
  await rejectsWithCode(encodeDocument(artifact, unclaimed), 'BUFFER_VIEW_UNCLAIMED');

  const extentsMutation = artifact.slice();
  const extentsView = decoded.document.bufferViews[1];
  extentsMutation[decoded.binStart + extentsView.byteOffset] ^= 1;
  await rejectsWithCode(extentsMutation, 'SHAPING_HASH');

  const sfntMutation = artifact.slice();
  sfntMutation[decoded.binStart + 16] ^= 1;
  await rejectsWithCode(sfntMutation, 'SFNT_TABLE_CHECKSUM');

  const reciprocal = structuredClone(decoded.document);
  reciprocal.extensionsUsed.push('PMNDRS_font_bitmap');
  reciprocal.extensions.PMNDRS_font.rasters = [
    {
      rasterKey: 'a'.repeat(64),
      kind: 'bitmap',
      extension: 'PMNDRS_font_bitmap',
      version: 0,
      source: { type: 'embedded' },
    },
  ];
  reciprocal.extensions.PMNDRS_font_bitmap = { rasterKey: 'b'.repeat(64) };
  await rejectsWithCode(encodeDocument(artifact, reciprocal), 'RASTER_RECIPROCAL_KEY');
});

async function rejectsWithCode(bytes, code) {
  await assert.rejects(
    validateFontArtifact(bytes),
    (error) => error instanceof FontArtifactValidationError && error.issues.some((issue) => issue.code === code),
  );
}

async function rejectsWithPrefix(bytes, prefix) {
  await assert.rejects(
    validateFontArtifact(bytes),
    (error) =>
      error instanceof FontArtifactValidationError && error.issues.some((issue) => issue.code.startsWith(prefix)),
  );
}

function mutateU32(source, offset, value) {
  const result = source.slice();
  new DataView(result.buffer).setUint32(offset, value, true);
  return result;
}

function readU32(source, offset) {
  return new DataView(source.buffer, source.byteOffset, source.byteLength).getUint32(offset, true);
}

function decodeDocument(bytes) {
  const jsonLength = readU32(bytes, 12);
  const binHeader = 20 + jsonLength;
  assert.equal(readU32(bytes, 16), JSON_CHUNK);
  assert.equal(readU32(bytes, binHeader + 4), BIN_CHUNK);
  return {
    document: JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)).trimEnd()),
    binStart: binHeader + 8,
  };
}

function encodeDocument(source, document) {
  decodeDocument(source);
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

function atPath(root, path) {
  return path.slice(0, -1).reduce((value, key) => value[key], root);
}

function sourceTableRecord(font, wanted) {
  const count = font.readUInt16BE(4);
  for (let index = 0; index < count; index += 1) {
    const record = 12 + index * 16;
    if (font.toString('ascii', record, record + 4) === wanted) return record;
  }
  throw new Error(`missing source table ${wanted}`);
}

function sourceTableTags(font) {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const count = view.getUint16(4, false);
  return Array.from({ length: count }, (_, index) =>
    new TextDecoder().decode(font.subarray(12 + index * 16, 16 + index * 16)),
  );
}
