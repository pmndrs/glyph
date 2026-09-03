import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { bitmap } from '../../dist/raster/bitmap.js';
import { getRegisteredFontData } from '../../dist/internal/registered-font.js';
import { immutableFontResources } from '../../dist/loaded-font.js';
import { createFontLibrary, loadFont } from '../../dist/loader.js';

const fixtureUrl = new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);
const raster = { raster: bitmap, options: { strikes: [16] } };

test('copy input creates one private GLB backing and exposes no mutable implementation handles', async () => {
  const source = await readFile(fixtureUrl);
  const pending = loadFont({ baked: { bytes: source, ownership: 'copy' } }, raster);
  source.fill(0);
  const font = await pending;

  assert.equal(font.raster, bitmap);
  assert.equal(font.metrics.unitsPerEm, 2048);
  assert.equal(font.glyphCount, 2937);
  assert.equal('data' in font, false);
  assert.equal('font' in font, false);
  assert.equal('raster' in font, true);
  assert.equal('handle' in font, false);

  const resources = immutableFontResources(font);
  const registered = getRegisteredFontData(resources.font);
  assert.notEqual(registered.artifactBytes.buffer, source.buffer);
  assert.equal(registered.shapingSfnt.buffer, registered.artifactBytes.buffer);
  assert.equal(registered.glyphExtents.buffer, registered.artifactBytes.buffer);
  assert.equal(registered.glyphExtentsAvailability.buffer, registered.artifactBytes.buffer);
  for (const embedded of registered.rasterSources.values()) {
    if (embedded.binaryBytes !== undefined) {
      assert.equal(embedded.binaryBytes.buffer, registered.artifactBytes.buffer);
    }
  }

  font.dispose();
  assert.equal(font.disposed, true);
  assert.throws(() => immutableFontResources(font), /disposed/);
  assert.throws(() => getRegisteredFontData(resources.font), /not registered by this package/);
  font.dispose();
});

test('transfer input validates ownership before detaching and adopts a full ArrayBuffer', async () => {
  const fixture = await readFile(fixtureUrl);
  const transferable = Uint8Array.from(fixture);
  const originalByteLength = transferable.byteLength;
  const pending = loadFont({ baked: { bytes: transferable, ownership: 'transfer' } }, raster);

  assert.equal(transferable.buffer.byteLength, 0);
  const font = await pending;
  assert.equal(getRegisteredFontData(immutableFontResources(font).font).artifactBytes.byteLength, originalByteLength);

  const partialBacking = Uint8Array.from(fixture);
  const partial = partialBacking.subarray(1);
  assert.throws(() => loadFont({ baked: { bytes: partial, ownership: 'transfer' } }, raster), /complete ArrayBuffer/);
  assert.equal(partialBacking.buffer.byteLength, fixture.byteLength);

  if (typeof SharedArrayBuffer === 'function') {
    const shared = new Uint8Array(new SharedArrayBuffer(fixture.byteLength));
    assert.throws(() => loadFont({ baked: { bytes: shared, ownership: 'transfer' } }, raster), /SharedArrayBuffer/);
    assert.equal(shared.byteLength, fixture.byteLength);
  }
  font.dispose();
});

test('low-level loads share the FontFace graph while returned user leases remain live', async () => {
  const bytes = await readFile(fixtureUrl);
  const calls = [];
  const fetch = async (input) => {
    calls.push(String(input));
    return new Response(Uint8Array.from(bytes));
  };
  const library = createFontLibrary({ fetch });
  const request = { input: { baked: 'https://fonts.test/inter.glb' }, raster };

  const [first, second] = await Promise.all([
    library.loadFont(request.input, request.raster),
    library.loadFont(request.input, request.raster),
  ]);
  assert.notEqual(first, second);
  assert.equal(calls.length, 1);
  first.dispose();
  assert.equal(second.disposed, false);
  assert.equal(second.glyphCount, 2937);

  const third = await library.loadFont(request.input, request.raster);
  assert.equal(calls.length, 1);
  assert.equal(third.glyphCount, 2937);
  second.dispose();
  third.dispose();

  const fourth = await library.loadFont(request.input, request.raster);
  assert.equal(calls.length, 2);
  library.dispose();
  assert.equal(fourth.glyphCount, 2937);
  assert.throws(() => library.loadFont(request.input, request.raster), /disposed/);
  fourth.dispose();

  let topLevelCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    topLevelCalls += 1;
    return new Response(Uint8Array.from(bytes));
  };
  try {
    const [topA, topB] = await Promise.all([
      loadFont(request.input, request.raster),
      loadFont(request.input, request.raster),
    ]);
    assert.equal(topLevelCalls, 1);
    assert.notEqual(topA, topB);
    topA.dispose();
    topB.dispose();
    await Promise.resolve();
    const topC = await loadFont(request.input, request.raster);
    assert.equal(topLevelCalls, 2);
    topC.dispose();

    const byteSource = Uint8Array.from(bytes);
    const byteRequestA = { input: { baked: { bytes: byteSource } }, raster };
    const byteRequestB = { input: { baked: { bytes: byteSource } }, raster };
    const [byteA, byteB] = await Promise.all([
      loadFont(byteRequestA.input, byteRequestA.raster),
      loadFont(byteRequestB.input, byteRequestB.raster),
    ]);
    assert.equal(immutableFontResources(byteA).font, immutableFontResources(byteB).font);
    byteA.dispose();
    byteB.dispose();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('font library and load options reject malformed values at their calls', async () => {
  assert.throws(() => createFontLibrary(null), /options must be an object/);
  const library = createFontLibrary();
  const request = { input: { baked: 'https://fonts.test/invalid-options.glb' }, raster };
  assert.throws(() => library.loadFont(request.input, request.raster, null), /load options must be an object/);
  assert.throws(() => loadFont(request.input), /requires a raster format/);
  assert.throws(() => loadFont(request.input, []), /at least one raster format/);
  assert.throws(() => loadFont(request.input, request.raster, { retry: true }), /only accept signal/);
  library.dispose();
});
