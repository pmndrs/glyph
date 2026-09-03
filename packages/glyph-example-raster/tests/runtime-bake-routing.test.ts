import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { glyph } from '@pmndrs/glyph';
import { test } from 'vitest';

import { glyphExample } from '../src/index.js';

const fixtureDirectory = new URL('../../../apps/benchmarks/fixtures/fonts/inter-v4.1/', import.meta.url);
/**
 * The published external contract, end to end: an external raster format
 * loads through FontFace and bakes host-side through the baker its own
 * declaration names. A successful load proves the core Worker accepted only
 * its built-in work before Glyph attached and decoded the external raster.
 */
test('the example raster format bakes host-side while the Worker plan stays first-party', async () => {
  const source = await readFile(new URL('Inter-Regular.ttf', fixtureDirectory));
  const face = glyph.fontFace(new Blob([source], { type: 'font/ttf' }), {
    family: 'ExternalRasterRuntimeBake',
    format: glyphExample({ paletteSeed: 17, inset: 0.1 }),
  });
  try {
    assert.equal(await face.load(), face);
    assert.equal(face.isLoaded(), true);
  } finally {
    face.dispose();
  }
});
