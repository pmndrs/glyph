import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { bitmap } from '../../dist/raster/bitmap-technique.js';
import { getRegisteredFontData } from '../../dist/internal/registered-font.js';
import { createFontStack, immutableFontResources } from '../../dist/loaded-font.js';
import { loadFont } from '../../dist/loader.js';
import { threeRenderPolicyDescriptor } from '../../dist/three/render-policy.js';
import {
  acquireEngineFontBinding,
  createGlyphEngine,
  observeGlyphEngineDispose,
  engineFontBindingHandle,
  engineFontBindingResources,
  glyphEngineShaperForTests,
} from '../../dist/glyph-engine.js';

const fontUrl = new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);
const wasmUrl = new URL('../../dist/text-shaper.wasm', import.meta.url);
const raster = { technique: bitmap, options: { strikes: [16] } };

async function fixtureFont() {
  return loadFont({ baked: { bytes: await readFile(fontUrl) } }, raster);
}

async function fixtureEngine() {
  return createGlyphEngine({ wasm: await readFile(wasmUrl) });
}

test('one immutable font binds independently into two glyph engines', async () => {
  const font = await fixtureFont();
  const firstEngine = await fixtureEngine();
  const secondEngine = await fixtureEngine();
  const firstShaper = glyphEngineShaperForTests(firstEngine);
  const secondShaper = glyphEngineShaperForTests(secondEngine);

  const first = acquireEngineFontBinding(firstEngine, font);
  const repeated = acquireEngineFontBinding(firstEngine, font);
  const second = acquireEngineFontBinding(secondEngine, font);

  assert.equal(firstShaper.memoryReport().fontCount, 1);
  assert.equal(secondShaper.memoryReport().fontCount, 1);
  assert.equal(engineFontBindingHandle(first), engineFontBindingHandle(repeated));
  assert.equal(engineFontBindingHandle(first), engineFontBindingHandle(second));

  first.dispose();
  assert.equal(firstShaper.memoryReport().fontCount, 1);
  repeated.dispose();
  assert.equal(firstShaper.memoryReport().fontCount, 0);
  assert.equal(secondShaper.memoryReport().fontCount, 1);

  firstEngine.dispose();
  second.dispose();
  assert.equal(secondShaper.memoryReport().fontCount, 0);
  secondEngine.dispose();
  font.dispose();
});

test('a disposed Font rejects new binding while an existing glyphEngine lease remains valid', async () => {
  const font = await fixtureFont();
  const glyphEngine = await fixtureEngine();
  const shaper = glyphEngineShaperForTests(glyphEngine);
  const binding = acquireEngineFontBinding(glyphEngine, font);
  const handle = engineFontBindingHandle(binding);
  const registered = immutableFontResources(font).font;

  font.dispose();

  assert.equal(shaper.memoryReport().fontCount, 1);
  assert.equal(engineFontBindingHandle(binding), handle);
  assert.equal(engineFontBindingResources(binding).font, registered);
  assert.equal(getRegisteredFontData(registered).artifactBytes.byteLength > 0, true);
  assert.throws(() => acquireEngineFontBinding(glyphEngine, font), /font has been disposed/);

  binding.dispose();
  assert.equal(shaper.memoryReport().fontCount, 0);
  assert.throws(() => engineFontBindingHandle(binding), /binding has been disposed/);
  assert.throws(() => engineFontBindingResources(binding), /binding has been disposed/);
  assert.throws(() => getRegisteredFontData(registered), /not registered by this package/);
  glyphEngine.dispose();
});

test('glyphEngine disposal releases bindings after owner observers and before the shaper', async () => {
  const font = await fixtureFont();
  const glyphEngine = await fixtureEngine();
  const shaper = glyphEngineShaperForTests(glyphEngine);
  const binding = acquireEngineFontBinding(glyphEngine, font);
  const observed = [];
  observeGlyphEngineDispose(glyphEngine, () => {
    observed.push({ bindingDisposed: binding.disposed, fontCount: shaper.memoryReport().fontCount });
  });

  glyphEngine.dispose();

  assert.deepEqual(observed, [{ bindingDisposed: false, fontCount: 1 }]);
  assert.equal(binding.disposed, true);
  assert.throws(() => shaper.memoryReport(), /disposed/);
  binding.dispose();
  font.dispose();
});

test('glyph engine font binding inputs are rejected at their calls', async () => {
  const font = await fixtureFont();
  const glyphEngine = await fixtureEngine();

  assert.throws(() => acquireEngineFontBinding({}, font), /glyph engine was not created by this package/);
  assert.throws(() => acquireEngineFontBinding(glyphEngine, {}), /font was not created by this package/);
  assert.throws(() => engineFontBindingHandle({}), /binding was not created by this package/);

  glyphEngine.dispose();
  assert.throws(() => acquireEngineFontBinding(glyphEngine, font), /glyph engine has been disposed/);
  font.dispose();
});

test('a glyph-engine-owned backend installs complete policies and deduplicates opaque font bindings', async () => {
  const font = await fixtureFont();
  const glyphEngine = await fixtureEngine();
  const shaper = glyphEngineShaperForTests(glyphEngine);
  const backend = glyphEngine.createBackend({ integration: 'test.backend-font-binding' });

  assert.throws(() => backend.bindFont(font), /no installed policy/);
  assert.equal(shaper.memoryReport().fontCount, 0);
  const policy = backend.installPolicy(threeRenderPolicyDescriptor);
  const first = backend.bindFont(font);
  const second = backend.bindFont(font);
  assert.equal(first.technique, bitmap);
  assert.equal(second.technique, bitmap);
  assert.equal(shaper.memoryReport().fontCount, 1);

  font.dispose();
  first.dispose();
  assert.equal(shaper.memoryReport().fontCount, 1);
  second.dispose();
  assert.equal(shaper.memoryReport().fontCount, 0);
  policy.dispose();
  backend.dispose();
  glyphEngine.dispose();
});

test('a glyph-engine-owned backend binds immutable font stacks and retains their fonts', async () => {
  const font = await fixtureFont();
  const stack = createFontStack(font);
  const glyphEngine = await fixtureEngine();
  const shaper = glyphEngineShaperForTests(glyphEngine);
  const backend = glyphEngine.createBackend({ integration: 'test.backend-font-stack-binding' });
  const policy = backend.installPolicy(threeRenderPolicyDescriptor);

  assert.throws(() => backend.bindFontStack({ fonts: [font] }), /font stack was not created by this package/);
  const first = backend.bindFontStack(stack);
  const second = backend.bindFontStack(stack);
  assert.equal(shaper.memoryReport().fontCount, 1);

  font.dispose();
  first.dispose();
  assert.equal(shaper.memoryReport().fontCount, 1);
  second.dispose();
  assert.equal(shaper.memoryReport().fontCount, 0);
  policy.dispose();
  backend.dispose();
  glyphEngine.dispose();
});
