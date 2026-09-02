import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { getRegisteredFontData } from '../../dist/internal/registered-font.js';
import {
  immutableFontResources,
  observeImmutableFontDispose,
  observeImmutableFontVariantRelease,
} from '../../dist/loaded-font.js';
import { loadFont } from '../../dist/loader.js';
import { bitmap } from '../../dist/raster/bitmap.js';

const fontUrl = new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);

test('immutable-font disposal remains total when one observer fails', async () => {
  const font = await loadFont(
    { baked: { bytes: await readFile(fontUrl) } },
    { raster: bitmap, options: { strikes: [16] } },
  );
  const registered = immutableFontResources(font).font;
  let failingObserverCalls = 0;
  let successfulObserverCalls = 0;
  let releaseObserverCalls = 0;
  observeImmutableFontDispose(font, () => {
    failingObserverCalls += 1;
    throw new Error('injected observer failure');
  });
  observeImmutableFontDispose(font, () => {
    successfulObserverCalls += 1;
  });
  observeImmutableFontVariantRelease(font, () => {
    releaseObserverCalls += 1;
  });

  const warnings = [];
  const originalWarn = console.warn;
  try {
    console.warn = (...values) => warnings.push(values.join(' '));
    assert.doesNotThrow(() => font.dispose());
    assert.doesNotThrow(() => font.dispose());
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(failingObserverCalls, 1);
  assert.equal(successfulObserverCalls, 1, 'one observer cannot prevent the remaining observers');
  assert.equal(releaseObserverCalls, 1, 'one observer cannot prevent final resource release');
  assert.throws(() => getRegisteredFontData(registered), /not registered by this package/);
  assert.ok(warnings.some((warning) => warning.includes('injected observer failure')));
});
