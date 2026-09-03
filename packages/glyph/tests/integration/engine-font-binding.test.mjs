import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { techniqueProgram } from '../../dist/config/codec-program.js';
import { id } from '../../dist/config/codec.js';
import { defineRasterFormat, defineRasterResourceId } from '../../dist/config/raster-format.js';
import { createRasterCodecProgram, registerRasterCodec } from '../../dist/config/raster.js';
import { defineTechniqueSchema } from '../../dist/config/schema.js';
import { bitmap } from '../../dist/raster/bitmap.js';
import { getRegisteredFontData } from '../../dist/internal/registered-font.js';
import { createFontStack, immutableFontResources } from '../../dist/loaded-font.js';
import { loadFont } from '../../dist/loader.js';
import { threeCodecCapabilitySet, threeCodecDescriptor, threeSystemBuffers } from '../../dist/three/codec.js';
import {
  acquireEngineFontBinding,
  createGlyphEngine,
  createGlyphHandleState,
  observeGlyphEngineDispose,
  engineFontBindingHandle,
  engineFontBindingResources,
  glyphEngineShaperForTests,
} from '../../dist/glyph-engine.js';

const fontUrl = new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);
const wasmUrl = new URL('../../dist/text-shaper.wasm', import.meta.url);
const raster = { raster: bitmap, options: { strikes: [16] } };
const COLLIDING_RESOURCE_A = defineRasterResourceId('pmndrs.msdf/4wzx/16');
const COLLIDING_RESOURCE_B = defineRasterResourceId('pmndrs.msdf/b6cd/16');
const COLLISION_ORIGIN_BUFFER_ID = id.buffer('test.handle-state-font-binding/collision-origin');

function collisionTechnique(name) {
  return defineRasterFormat({
    id: `test.handleState-font-binding.${name}`,
    kind: bitmap.kind,
    extension: bitmap.extension,
    version: bitmap.version,
    textEffects: bitmap.textEffects,
    descriptor: (options) => bitmap.descriptor(options),
    decode: (font, artifact, signal) => bitmap.decode(font, artifact, signal),
    dispose: (data) => bitmap.dispose(data),
  });
}

function collisionPlan(technique, resource) {
  const schema = defineTechniqueSchema({
    technique: technique.id,
    scope: 'glyph',
    binding: {},
    buffers: { origin: { id: COLLISION_ORIGIN_BUFFER_ID, scalar: 'f32', lanes: ['x', 'y'] } },
    resources: { payload: { kind: 'buffer' } },
    render: { resource: 'payload', geometry: { kind: 'synthetic-quad' } },
  });
  return registerRasterCodec({
    raster: technique,
    schema,
    codecBody(system) {
      const program = techniqueProgram(schema, { system });
      return program.compile({
        origin: [program.semantics.inlineOrigin, program.semantics.blockOrigin],
      });
    },
    compileFont(compiler) {
      compiler.retain('payload', resource, { kind: 'buffer', bytes: new Uint8Array(4), stride: 4 });
      return compiler.compile({ strikes: [0], resource: () => resource });
    },
  });
}

const firstCollisionTechnique = collisionTechnique('collision-a');
const secondCollisionTechnique = collisionTechnique('collision-b');
const firstCollisionPlan = collisionPlan(firstCollisionTechnique, COLLIDING_RESOURCE_A);
const secondCollisionPlan = collisionPlan(secondCollisionTechnique, COLLIDING_RESOURCE_B);

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

test('a glyph-engine-owned handle state installs a complete codec and deduplicates opaque font bindings', async () => {
  const font = await fixtureFont();
  const glyphEngine = await fixtureEngine();
  const shaper = glyphEngineShaperForTests(glyphEngine);
  const handleState = createGlyphHandleState(glyphEngine, { integration: 'test.handle-state-font-binding' });

  assert.throws(() => handleState.bindFont(font), /no installed codec/);
  assert.equal(shaper.memoryReport().fontCount, 0);
  const codec = handleState.installCodec(threeCodecDescriptor);
  const first = handleState.bindFont(font);
  const second = handleState.bindFont(font);
  assert.equal(first.raster, bitmap);
  assert.equal(second.raster, bitmap);
  assert.equal(shaper.memoryReport().fontCount, 1);

  font.dispose();
  first.dispose();
  assert.equal(shaper.memoryReport().fontCount, 1);
  second.dispose();
  assert.equal(shaper.memoryReport().fontCount, 0);
  codec.dispose();
  handleState.dispose();
  glyphEngine.dispose();
});

test('one handle state rejects colliding resource identities when the second font binds', async () => {
  const bytes = await readFile(fontUrl);
  const [firstFont, secondFont] = await Promise.all([
    loadFont({ baked: { bytes } }, { raster: firstCollisionTechnique, options: { strikes: [16] } }),
    loadFont({ baked: { bytes } }, { raster: secondCollisionTechnique, options: { strikes: [16] } }),
  ]);
  const glyphEngine = await fixtureEngine();
  const shaper = glyphEngineShaperForTests(glyphEngine);
  const handleState = createGlyphHandleState(glyphEngine, { integration: 'test.handle-state-font-binding-collision' });
  const codec = handleState.installCodec((ids) => {
    const capabilitySet = threeCodecCapabilitySet();
    const options = {
      namespace: 'test.handle-state-font-binding-collision',
      system: threeSystemBuffers,
      capabilitySet,
      transformMode: 'indexed',
      allocationMode: 'ordered',
      ids,
    };
    return threeCodecDescriptor(ids, 'indexed', [
      createRasterCodecProgram(firstCollisionPlan, options),
      createRasterCodecProgram(secondCollisionPlan, options),
    ]);
  });
  const first = handleState.bindFont(firstFont);

  assert.throws(() => handleState.bindFont(secondFont), /render wire identity collision/);
  assert.equal(shaper.memoryReport().fontCount, 1, 'a rejected binding must release its engine registration');

  first.dispose();
  codec.dispose();
  handleState.dispose();
  glyphEngine.dispose();
  firstFont.dispose();
  secondFont.dispose();
});

test('a glyph-engine-owned handle state binds immutable font stacks and retains their fonts', async () => {
  const font = await fixtureFont();
  const stack = createFontStack(font);
  const glyphEngine = await fixtureEngine();
  const shaper = glyphEngineShaperForTests(glyphEngine);
  const handleState = createGlyphHandleState(glyphEngine, { integration: 'test.handle-state-font-stack-binding' });
  const codec = handleState.installCodec(threeCodecDescriptor);

  assert.throws(() => handleState.bindFontStack({ fonts: [font] }), /font stack was not created by this package/);
  const first = handleState.bindFontStack(stack);
  const second = handleState.bindFontStack(stack);
  assert.equal(shaper.memoryReport().fontCount, 1);

  font.dispose();
  first.dispose();
  assert.equal(shaper.memoryReport().fontCount, 1);
  second.dispose();
  assert.equal(shaper.memoryReport().fontCount, 0);
  codec.dispose();
  handleState.dispose();
  glyphEngine.dispose();
});
