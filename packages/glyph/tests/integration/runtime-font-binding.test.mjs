import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { bitmap } from '../../dist/raster/bitmap-technique.js';
import { getRegisteredFontData } from '../../dist/internal/registered-font.js';
import { createFontStack, immutableFontResources } from '../../dist/loaded-font.js';
import { loadFont } from '../../dist/loader.js';
import { threeRenderPolicyDescriptor } from '../../dist/three/render-policy.js';
import {
  acquireRuntimeFontBinding,
  createTextRuntime,
  observeTextRuntimeDispose,
  runtimeFontBindingHandle,
  runtimeFontBindingResources,
  textRuntimeShaper,
} from '../../dist/text-runtime.js';

const fontUrl = new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);
const wasmUrl = new URL('../../dist/text-shaper.wasm', import.meta.url);
const raster = { technique: bitmap, options: { strikes: [16] } };

async function fixtureFont() {
  return loadFont({ input: { baked: { bytes: await readFile(fontUrl) } }, raster });
}

async function fixtureRuntime() {
  return createTextRuntime({ wasm: await readFile(wasmUrl) });
}

test('one immutable font binds independently into two runtimes', async () => {
  const font = await fixtureFont();
  const firstRuntime = await fixtureRuntime();
  const secondRuntime = await fixtureRuntime();
  const firstShaper = textRuntimeShaper(firstRuntime);
  const secondShaper = textRuntimeShaper(secondRuntime);

  const first = acquireRuntimeFontBinding(firstRuntime, font);
  const repeated = acquireRuntimeFontBinding(firstRuntime, font);
  const second = acquireRuntimeFontBinding(secondRuntime, font);

  assert.equal(firstShaper.memoryReport().fontCount, 1);
  assert.equal(secondShaper.memoryReport().fontCount, 1);
  assert.equal(runtimeFontBindingHandle(first), runtimeFontBindingHandle(repeated));
  assert.equal(runtimeFontBindingHandle(first), runtimeFontBindingHandle(second));

  first.dispose();
  assert.equal(firstShaper.memoryReport().fontCount, 1);
  repeated.dispose();
  assert.equal(firstShaper.memoryReport().fontCount, 0);
  assert.equal(secondShaper.memoryReport().fontCount, 1);

  firstRuntime.dispose();
  second.dispose();
  assert.equal(secondShaper.memoryReport().fontCount, 0);
  secondRuntime.dispose();
  font.dispose();
});

test('a disposed Font rejects new binding while an existing runtime lease remains valid', async () => {
  const font = await fixtureFont();
  const runtime = await fixtureRuntime();
  const shaper = textRuntimeShaper(runtime);
  const binding = acquireRuntimeFontBinding(runtime, font);
  const handle = runtimeFontBindingHandle(binding);
  const registered = immutableFontResources(font).font;

  font.dispose();

  assert.equal(shaper.memoryReport().fontCount, 1);
  assert.equal(runtimeFontBindingHandle(binding), handle);
  assert.equal(runtimeFontBindingResources(binding).font, registered);
  assert.equal(getRegisteredFontData(registered).artifactBytes.byteLength > 0, true);
  assert.throws(() => acquireRuntimeFontBinding(runtime, font), /font has been disposed/);

  binding.dispose();
  assert.equal(shaper.memoryReport().fontCount, 0);
  assert.throws(() => runtimeFontBindingHandle(binding), /binding has been disposed/);
  assert.throws(() => runtimeFontBindingResources(binding), /binding has been disposed/);
  assert.throws(() => getRegisteredFontData(registered), /not registered by this package/);
  runtime.dispose();
});

test('runtime disposal releases bindings after owner observers and before the shaper', async () => {
  const font = await fixtureFont();
  const runtime = await fixtureRuntime();
  const shaper = textRuntimeShaper(runtime);
  const binding = acquireRuntimeFontBinding(runtime, font);
  const observed = [];
  observeTextRuntimeDispose(runtime, () => {
    observed.push({ bindingDisposed: binding.disposed, fontCount: shaper.memoryReport().fontCount });
  });

  runtime.dispose();

  assert.deepEqual(observed, [{ bindingDisposed: false, fontCount: 1 }]);
  assert.equal(binding.disposed, true);
  assert.throws(() => shaper.memoryReport(), /disposed/);
  binding.dispose();
  font.dispose();
});

test('runtime font binding inputs are rejected at their calls', async () => {
  const font = await fixtureFont();
  const runtime = await fixtureRuntime();

  assert.throws(() => acquireRuntimeFontBinding({}, font), /runtime was not created by this package/);
  assert.throws(() => acquireRuntimeFontBinding(runtime, {}), /font was not created by this package/);
  assert.throws(() => runtimeFontBindingHandle({}), /binding was not created by this package/);

  runtime.dispose();
  assert.throws(() => acquireRuntimeFontBinding(runtime, font), /runtime has been disposed/);
  font.dispose();
});

test('a runtime-owned host installs complete policies and deduplicates opaque font bindings', async () => {
  const font = await fixtureFont();
  const runtime = await fixtureRuntime();
  const shaper = textRuntimeShaper(runtime);
  const host = runtime.createTextEngineHost({ integration: 'test.host-font-binding' });

  assert.throws(() => host.bindFont(font), /no installed policy/);
  assert.equal(shaper.memoryReport().fontCount, 0);
  const policy = host.installPolicy(threeRenderPolicyDescriptor(host.wireIdentities));
  const first = host.bindFont(font);
  const second = host.bindFont(font);
  assert.equal(first.technique, bitmap);
  assert.equal(second.technique, bitmap);
  assert.equal(shaper.memoryReport().fontCount, 1);

  font.dispose();
  first.dispose();
  assert.equal(shaper.memoryReport().fontCount, 1);
  second.dispose();
  assert.equal(shaper.memoryReport().fontCount, 0);
  policy.dispose();
  host.dispose();
  runtime.dispose();
});

test('a runtime-owned host binds immutable font stacks and retains their fonts', async () => {
  const font = await fixtureFont();
  const stack = createFontStack(font);
  const runtime = await fixtureRuntime();
  const shaper = textRuntimeShaper(runtime);
  const host = runtime.createTextEngineHost({ integration: 'test.host-font-stack-binding' });
  const policy = host.installPolicy(threeRenderPolicyDescriptor(host.wireIdentities));

  assert.throws(() => host.bindFontStack({ fonts: [font] }), /font stack was not created by this package/);
  const first = host.bindFontStack(stack);
  const second = host.bindFontStack(stack);
  assert.equal(shaper.memoryReport().fontCount, 1);

  font.dispose();
  first.dispose();
  assert.equal(shaper.memoryReport().fontCount, 1);
  second.dispose();
  assert.equal(shaper.memoryReport().fontCount, 0);
  policy.dispose();
  host.dispose();
  runtime.dispose();
});
