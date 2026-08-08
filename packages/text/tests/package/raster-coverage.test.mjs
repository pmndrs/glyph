import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeRasterCoverage, RasterCoverageError } from '@pmndrs/text';
import { bitmapDescriptor, bitmapRasterKey } from '@pmndrs/text/raster/bitmap';
import { msdfDescriptor, msdfRasterKey } from '@pmndrs/text/raster/msdf';
import { normalizeBitmapOptions } from '../../dist/internal/bitmap-contract.js';
import { assertRasterCoverage } from '../../dist/internal/raster-coverage-artifact.js';

const authored = {
  unicodeRanges: [
    { start: 0x61, end: 0x7a },
    { start: 0x41, end: 0x5a },
  ],
  text: 'AB',
  glyphIds: [7, 3],
};

test('normalizes bounded raster seeds without changing their selection semantics', () => {
  const normalized = normalizeRasterCoverage(authored);
  assert.deepEqual(normalized, {
    unicodeRanges: [
      { start: 0x41, end: 0x5a },
      { start: 0x61, end: 0x7a },
    ],
    text: 'AB',
    glyphIds: [3, 7],
  });
  assert.ok(Object.isFrozen(normalized));
  assert.ok(Object.isFrozen(normalized.unicodeRanges));
  assert.ok(Object.isFrozen(normalized.glyphIds));
});

test('normalizes the complete Bitmap Worker option boundary without dropping coverage', () => {
  assert.deepEqual(normalizeBitmapOptions({ strikes: [32, 16], coverage: authored }), {
    strikes: [16, 32],
    coverage: normalizeRasterCoverage(authored),
  });
  assert.throws(() => normalizeBitmapOptions({ strikes: [16], unknown: true }), /unknown property/);
});

test('authenticates identical bounded coverage in Bitmap and MSDF descriptors', async () => {
  const coverage = {
    unicodeRanges: [{ start: 65, end: 90 }],
    text: 'AB',
    glyphIds: [3, 7],
  };
  assert.deepEqual(bitmapDescriptor({ strikes: [16, 32], coverage }), {
    coverage,
    generatorVersion: '0.0.0',
    strikes: [16, 32],
  });
  assert.equal(
    await bitmapRasterKey({ strikes: [16, 32], coverage }),
    'c2ca57973a0666f858d350def46deb26b41b9219e3073df6636a3eaa0810e853',
  );
  assert.deepEqual(msdfDescriptor({ coverage }), { coverage, generatorVersion: '0.0.0' });
  assert.equal(await msdfRasterKey({ coverage }), '4118e8f8787ea4de99492c4869059cca10b0ae69494b780699a421d5fe22fe4d');
});

test('rejects ambiguous, unbounded, and non-scalar coverage input', () => {
  for (const coverage of [
    {},
    { glyphIds: [3, 3] },
    { glyphIds: [-1] },
    { glyphIds: [65_536] },
    {
      unicodeRanges: [
        { start: 65, end: 90 },
        { start: 70, end: 80 },
      ],
    },
    { unicodeRanges: [{ start: 0xd7ff, end: 0xe000 }] },
    { text: '\ud800' },
    { unknown: true },
  ]) {
    assert.throws(() => normalizeRasterCoverage(coverage));
  }
});

test('reports missing shaped glyphs as a stable public error', () => {
  const error = new RasterCoverageError('msdf', [3, 7]);
  assert.equal(error.name, 'RasterCoverageError');
  assert.equal(error.rasterKind, 'msdf');
  assert.deepEqual(error.missingGlyphIds, [3, 7]);
  assert.match(error.message, /font-local glyph IDs: 3, 7/);
});

test('checks shaped font-local glyphs before publishing a bounded raster batch', () => {
  const layout = {
    glyphIds: Uint16Array.of(3, 7, 9),
    glyphFontSlots: Uint16Array.of(0, 1, 0),
  };
  const selected = Uint8Array.of((1 << 3) | (1 << 7), 1 << 1);
  assert.doesNotThrow(() => assertRasterCoverage(layout, 0, selected, 'bitmap'));
  assert.throws(
    () => assertRasterCoverage(layout, 1, Uint8Array.of(1 << 3, 0), 'bitmap'),
    (error) => error instanceof RasterCoverageError && error.missingGlyphIds.join(',') === '7',
  );
});
