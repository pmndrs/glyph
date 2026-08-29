import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

import { createFontBaker, validateFontArtifact } from '@pmndrs/glyph/bake';
import { fontBakerWasmUrl } from '@pmndrs/glyph/bake';

import { bitmapBakerFromCore, createBitmapBaker } from '../dist/bakers/bitmap.js';
import { validateBitmapArtifact } from '../dist/bakers/bitmap-validator.js';
import { composeFontBake } from '../dist/internal/compose-bake.js';
import { bitmapDescriptor, bitmapRasterKey } from '../dist/raster/bitmap.js';

const sourceUrl = new URL('../../../apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf', import.meta.url);
const wasmUrl = new URL('../dist/bitmap-baker.wasm', import.meta.url);
const outputUrl = new URL('../tests/fixtures/inter-bitmap-v0.json', import.meta.url);
const renderingFixtureUrl = new URL(
  '../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb',
  import.meta.url,
);
const glyphCount = 2937;
const options = { strikes: [16] };
const descriptor = bitmapDescriptor(options);
const rasterKey = bitmapRasterKey(options);
const [source, wasm, fontWasm] = await Promise.all([
  readFile(sourceUrl),
  readFile(wasmUrl),
  readFile(new URL(fontBakerWasmUrl)),
]);
const baker = bitmapBakerFromCore(await createBitmapBaker(wasm));
const fontBaker = await createFontBaker(fontWasm);
const core = fontBaker.bake({ source, descriptor: { formatVersion: 0, fontFaceIndex: 0 } });
const coreValidation = await validateFontArtifact(core.artifacts[0].bytes);
const font = {
  source,
  sourceFingerprint: coreValidation.sourceFingerprint,
  fontFaceIndex: 0,
  glyphCount,
  shapingFingerprint: coreValidation.shapingFingerprint,
};
const [embedded, external] = await Promise.all([
  baker.bake({
    font,
    rasterKey,
    packaging: { artifact: 'embedded', pages: 'embedded' },
    descriptor,
  }),
  baker.bake({
    font,
    rasterKey,
    packaging: { artifact: 'external', pages: 'external' },
    descriptor,
  }),
]);
const [combinedEmbedded, combinedExternal, empty] = await Promise.all([
  composeFontBake(core, [{ raster: embedded, packaging: { artifact: 'embedded', pages: 'embedded' } }]),
  composeFontBake(core, [{ raster: external, packaging: { artifact: 'external', pages: 'external' } }]),
  composeFontBake(core, []),
]);
const context = {
  rasterKey,
  shapingFingerprint: coreValidation.shapingFingerprint,
  glyphCount,
  glyphIdWidth: 16,
  descriptor,
};
const embeddedValidation = await validateBitmapArtifact(embedded.artifacts[0].bytes, context);
const externalPages = new Map(
  external.artifacts.filter(({ role }) => role === 'raster-page').map(({ id, bytes }) => [id, bytes]),
);
const externalValidation = await validateBitmapArtifact(external.artifacts[0].bytes, {
  ...context,
  externalPages,
});
const records = embeddedValidation.strikes[0].records;
if (!records.every((value, index) => value === externalValidation.strikes[0].records[index])) {
  throw new Error('embedded and external packaging changed authoritative record bytes');
}
const recordView = new DataView(records.buffer, records.byteOffset, records.byteLength);
let presentGlyphs = 0;
for (let glyphId = 0; glyphId < glyphCount; glyphId += 1) {
  if (recordView.getUint16(glyphId * 20 + 16, true) !== 0xffff) presentGlyphs += 1;
}

const fixture = {
  schemaVersion: 0,
  source: {
    fixture: 'apps/benchmarks/fixtures/fonts/inter-v4.1/Inter-Regular.ttf',
    bytes: source.byteLength,
    sha256: hash(source),
    fingerprint: coreValidation.sourceFingerprint,
    faceIndex: 0,
    glyphCount,
    shapingFingerprint: coreValidation.shapingFingerprint,
  },
  descriptor,
  rasterKey,
  generator: {
    version: '0.0.0',
    optimizedWasmBytes: wasm.byteLength,
    dependencies: {
      readFonts: '0.42.1',
      skrifa: '0.45.1',
      zeno: '0.3.3',
      ktx2Rust: '0.5.0',
      ktxParse: '1.1.0',
      binaryen: '129.0.0',
    },
  },
  records: {
    stride: 20,
    bytes: records.byteLength,
    sha256: hash(records),
    presentGlyphs,
    absentGlyphs: glyphCount - presentGlyphs,
  },
  embedded: summarizeResult(embedded, embeddedValidation),
  external: summarizeResult(external, externalValidation),
  composed: {
    embedded: summarizeComposition(combinedEmbedded),
    external: summarizeComposition(combinedExternal),
    empty: summarizeComposition(empty),
  },
};

await mkdir(new URL('../../../apps/benchmarks/fixtures/rendering/', import.meta.url), {
  recursive: true,
});
await Promise.all([
  writeFile(outputUrl, `${JSON.stringify(fixture, null, 2)}\n`),
  writeFile(renderingFixtureUrl, combinedEmbedded.artifacts[0].bytes),
]);

function summarizeResult(result, validation) {
  return {
    artifacts: result.artifacts.map(({ role, id, bytes, fingerprint }) => ({
      role,
      id,
      bytes: bytes.byteLength,
      fingerprint,
      sha256: hash(bytes),
    })),
    report: result.report,
    pages: validation.strikes.flatMap((strike) =>
      strike.pages.map(({ width, height, bytes, source: pageSource, uri }) => ({
        ppem: strike.ppem,
        width,
        height,
        source: pageSource,
        ...(uri === undefined ? {} : { uri }),
        bytes: bytes.byteLength,
        sha256: hash(bytes),
      })),
    ),
  };
}

function summarizeComposition(result) {
  return {
    artifacts: result.artifacts.map(({ role, id, bytes, fingerprint }) => ({
      role,
      id,
      bytes: bytes.byteLength,
      fingerprint,
      sha256: hash(bytes),
    })),
    report: result.report,
  };
}

function hash(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
