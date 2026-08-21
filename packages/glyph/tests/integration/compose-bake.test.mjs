import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { before } from 'node:test';

import { createFontBaker } from '@pmndrs/glyph/bake';
import { parseGlb, validateFontArtifact } from '@pmndrs/glyph/bake';
import { bitmapBakerFromCore, createBitmapBaker } from '@pmndrs/glyph/bakers/bitmap';
import { validateBitmapArtifact } from '@pmndrs/glyph/bakers/bitmap/validate';
import { bitmapDescriptor, bitmapRasterKey } from '@pmndrs/glyph/raster/bitmap';

import { BakeCompositionError, composeFontBake } from '../../dist/internal/compose-bake.js';

let core;
let bitmapEmbedded;
let bitmapExternal;
let context;
let golden;

before(async () => {
  const [source, fontWasm, bitmapWasm, goldenBytes] = await Promise.all([
    readFile(new URL('../../../../apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf', import.meta.url)),
    readFile(new URL('../../dist/font-baker.wasm', import.meta.url)),
    readFile(new URL('../../dist/bitmap-baker.wasm', import.meta.url)),
    readFile(new URL('../fixtures/inter-bitmap-v0.json', import.meta.url)),
  ]);
  golden = JSON.parse(goldenBytes);
  const fontBaker = await createFontBaker(fontWasm);
  core = fontBaker.bake({ source, descriptor: { formatVersion: 0, fontFaceIndex: 0 } });
  const coreValidation = await validateFontArtifact(core.artifacts[0].bytes);
  const descriptor = bitmapDescriptor({ strikes: [16] });
  const rasterKey = await bitmapRasterKey({ strikes: [16] });
  context = {
    rasterKey,
    shapingHash: coreValidation.shapingHash,
    glyphCount: coreValidation.glyphCount,
    glyphIdWidth: 16,
    descriptor,
  };
  const bitmapBaker = bitmapBakerFromCore(await createBitmapBaker(bitmapWasm));
  const font = {
    source,
    fontFaceIndex: 0,
    glyphCount: coreValidation.glyphCount,
    shapingHash: coreValidation.shapingHash,
  };
  [bitmapEmbedded, bitmapExternal] = await Promise.all([
    bitmapBaker.bake({
      font,
      rasterKey,
      packaging: { artifact: 'embedded', pages: 'embedded' },
      descriptor,
    }),
    bitmapBaker.bake({
      font,
      rasterKey,
      packaging: { artifact: 'external', pages: 'external' },
      descriptor,
    }),
  ]);
});

test('deterministically embeds a companion while preserving both validated payloads', async () => {
  const input = [{ raster: bitmapEmbedded, packaging: { artifact: 'embedded', pages: 'embedded' } }];
  const first = await composeFontBake(core, input);
  const second = await composeFontBake(core, input);
  assert.deepEqual(second, first);
  assert.deepEqual(
    first.artifacts.map(({ role }) => role),
    ['font'],
  );
  assert.deepEqual(summarize(first), golden.composed.embedded);

  const [bareFont, combinedFont, splitBitmap, combinedBitmap] = await Promise.all([
    validateFontArtifact(core.artifacts[0].bytes),
    validateFontArtifact(first.artifacts[0].bytes),
    validateBitmapArtifact(bitmapEmbedded.artifacts[0].bytes, context),
    validateBitmapArtifact(first.artifacts[0].bytes, context),
  ]);
  assert.deepEqual(combinedFont.shapingSfnt, bareFont.shapingSfnt);
  assert.deepEqual(combinedFont.glyphExtents, bareFont.glyphExtents);
  assert.deepEqual(combinedBitmap.strikes[0].records, splitBitmap.strikes[0].records);
  assert.deepEqual(combinedBitmap.strikes[0].pages[0].bytes, splitBitmap.strikes[0].pages[0].bytes);
  assert.deepEqual(combinedFont.document.extensions.PMNDRS_font.rasters, [
    {
      rasterKey: context.rasterKey,
      kind: 'bitmap',
      extension: 'PMNDRS_font_bitmap',
      version: 0,
      source: { type: 'embedded' },
    },
  ]);
});

test('preserves the exact shaping-only artifact for the identity-neutral empty raster set', async () => {
  const result = await composeFontBake(core, []);
  assert.deepEqual(summarize(result), golden.composed.empty);
  assert.deepEqual(result.artifacts, core.artifacts);
  assert.deepEqual(result.report.rasters, []);
  const font = await validateFontArtifact(result.artifacts[0].bytes);
  assert.deepEqual(font.document.extensions.PMNDRS_font.rasters, []);
});

test('rebases opaque buffer-view references for multiple distinct embedded extensions', async () => {
  const custom = await customRaster(bitmapEmbedded, '1'.repeat(64), 'STUDIO_font_custom');
  const result = await composeFontBake(core, [
    { raster: bitmapEmbedded, packaging: { artifact: 'embedded', pages: 'embedded' } },
    { raster: custom, packaging: { artifact: 'embedded', pages: 'embedded' } },
  ]);
  const parsed = parseGlb(result.artifacts[0].bytes);
  const customData = parsed.document.extensions.STUDIO_font_custom;
  assert.equal(customData.strikes[0].recordBufferView, 5);
  assert.equal(customData.strikes[0].pages[0].variants[0].source.bufferView, 6);
  assert.deepEqual(
    parsed.document.extensions.PMNDRS_font.rasters.map(({ source }) => source),
    [{ type: 'embedded' }, { type: 'embedded' }],
  );
  await validateFontArtifact(result.artifacts[0].bytes);
  await validateBitmapArtifact(result.artifacts[0].bytes, context);
});

test('emits an authenticated external companion and independently addressable pages', async () => {
  const result = await composeFontBake(core, [
    { raster: bitmapExternal, packaging: { artifact: 'external', pages: 'external' } },
  ]);
  assert.deepEqual(summarize(result), golden.composed.external);
  assert.deepEqual(
    result.artifacts.map(({ role }) => role),
    ['font', 'raster', 'raster-page'],
  );
  const font = await validateFontArtifact(result.artifacts[0].bytes);
  assert.deepEqual(font.document.extensions.PMNDRS_font.rasters, [
    {
      rasterKey: context.rasterKey,
      kind: 'bitmap',
      extension: 'PMNDRS_font_bitmap',
      version: 0,
      source: {
        type: 'external',
        uri: bitmapExternal.artifacts[0].id,
        artifactHash: bitmapExternal.artifacts[0].sha256,
      },
    },
  ]);
  const pages = new Map(
    result.artifacts.filter(({ role }) => role === 'raster-page').map(({ id, bytes }) => [id, bytes]),
  );
  await validateBitmapArtifact(result.artifacts[1].bytes, { ...context, externalPages: pages });
  assert.deepEqual(
    result.report.transport,
    result.artifacts.map(({ id, bytes }) => ({
      artifactId: id,
      format: 'raw',
      bytes: bytes.byteLength,
    })),
  );
});

test('rejects tampered artifacts, reciprocal mismatches, and duplicate raster keys', async () => {
  const tampered = structuredClone(bitmapEmbedded);
  tampered.artifacts[0].bytes = tampered.artifacts[0].bytes.slice();
  tampered.artifacts[0].bytes[0] ^= 1;
  await assert.rejects(
    composeFontBake(core, [{ raster: tampered, packaging: { artifact: 'embedded', pages: 'embedded' } }]),
    (error) => error instanceof BakeCompositionError && error.code === 'ARTIFACT_HASH',
  );

  await assert.rejects(
    composeFontBake(core, [
      {
        raster: { ...bitmapEmbedded, rasterKey: '0'.repeat(64) },
        packaging: { artifact: 'embedded', pages: 'embedded' },
      },
    ]),
    (error) => error instanceof BakeCompositionError && error.code === 'RASTER_RECIPROCAL_IDENTITY',
  );

  await assert.rejects(
    composeFontBake(core, [
      { raster: bitmapEmbedded, packaging: { artifact: 'embedded', pages: 'embedded' } },
      { raster: bitmapEmbedded, packaging: { artifact: 'external', pages: 'embedded' } },
    ]),
    (error) => error instanceof BakeCompositionError && error.code === 'RASTER_KEY_DUPLICATE',
  );
});

async function customRaster(source, rasterKey, extension) {
  const main = source.artifacts[0];
  const parsed = parseGlb(main.bytes);
  const document = structuredClone(parsed.document);
  const data = document.extensions.PMNDRS_font_bitmap;
  delete document.extensions.PMNDRS_font_bitmap;
  data.rasterKey = rasterKey;
  document.extensions[extension] = data;
  document.extensionsUsed = [extension];
  document.extensionsRequired = [extension];
  const bytes = encodeGlb(document, parsed.bin.subarray(0, parsed.declaredBinLength));
  const sha256 = await hash(bytes);
  return {
    ...source,
    rasterKey,
    kind: 'studio.custom',
    extension,
    artifacts: [{ ...main, id: 'studio-custom.glb', bytes, sha256 }],
  };
}

function encodeGlb(document, binary) {
  const json = new TextEncoder().encode(JSON.stringify(document));
  const jsonLength = align4(json.byteLength);
  const binaryLength = align4(binary.byteLength);
  const output = new Uint8Array(28 + jsonLength + binaryLength);
  output.fill(0x20, 20, 20 + jsonLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0x4654_6c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, output.byteLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f_534a, true);
  output.set(json, 20);
  const binaryHeader = 20 + jsonLength;
  view.setUint32(binaryHeader, binaryLength, true);
  view.setUint32(binaryHeader + 4, 0x004e_4942, true);
  output.set(binary, binaryHeader + 8);
  return output;
}

function align4(value) {
  const remainder = value % 4;
  return remainder === 0 ? value : value + 4 - remainder;
}

async function hash(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer))]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function summarize(result) {
  return {
    artifacts: result.artifacts.map(({ role, id, bytes, sha256 }) => ({
      role,
      id,
      bytes: bytes.byteLength,
      sha256,
    })),
    report: result.report,
  };
}
