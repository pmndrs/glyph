import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { GlyphEngineStatusError } from '@pmndrs/glyph';

import { techniqueProgram } from '../../dist/config/codec-program.js';
import { id } from '../../dist/config/codec.js';
import { defineRasterFormat, defineRasterResourceId } from '../../dist/config/raster-format.js';
import { createRasterCodecProgram, registerRasterCodec } from '../../dist/config/raster.js';
import { defineTechniqueSchema } from '../../dist/config/schema.js';
import { bitmap } from '../../dist/raster/bitmap.js';
import { getRegisteredFontData } from '../../dist/internal/registered-font.js';
import { GlyphIdScope } from '../../dist/internal/glyph-id.js';
import { createFontStack, immutableFontResources } from '../../dist/loaded-font.js';
import { loadFont } from '../../dist/loader.js';
import { observeRenderPlannerDirty, stageRenderPlanner } from '../../dist/internal/render-planner.js';
import { textShaperAbi } from '../../dist/text-shaper-abi.js';
import { threeCodecCapabilitySet, threeCodecDescriptor, threeSystemBuffers } from '../../dist/three/codec.js';
import {
  acquireEngineFontBinding,
  createGlyphEngine,
  createGlyphHandleState,
  observeGlyphEngineDispose,
  engineFontBindingHandle,
  engineFontBindingResources,
  glyphEngineShaperForTests,
  registerGlyphShapeParticipant,
  shapeGlyphEngine,
} from '../../dist/glyph-engine.js';

const fontUrl = new URL('../../../../benches/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);
const wasmUrl = new URL('../../dist/text-shaper.wasm', import.meta.url);
const raster = bitmap({ strikes: [16] });
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
    codecBody() {
      const program = techniqueProgram(schema);
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

test('shape registration queue membership ends at staging, including deferral and rejection', async () => {
  const engine = await fixtureEngine();
  const failure = new Error('deliberate stage rejection');
  let reject = false;
  let stages = 0;
  let rejected = 0;
  const registration = registerGlyphShapeParticipant(engine, {
    stage() {
      stages += 1;
      assert.equal(registration.queued, false, 'the engine consumes the queue before entering stage hooks');
      assert.throws(() => shapeGlyphEngine(engine), /cannot be reentered/u);
      if (reject) throw failure;
      return undefined;
    },
    accepted() {},
    rejected(error) {
      assert.equal(error, failure);
      rejected += 1;
    },
  });
  try {
    assert.equal(registration.queued, false);
    registration.invalidate();
    registration.invalidate();
    assert.equal(registration.queued, true);
    shapeGlyphEngine(engine);
    assert.equal(registration.queued, false, 'a deferred root must not remain implicitly queued');
    shapeGlyphEngine(engine);
    assert.equal(stages, 1);
    reject = true;
    registration.invalidate();
    assert.throws(
      () => shapeGlyphEngine(engine),
      (error) => error === failure,
    );
    assert.equal(registration.queued, false, 'rejection must not create an implicit retry');
    shapeGlyphEngine(engine);
    assert.equal(stages, 2);
    assert.equal(rejected, 1);
    registration.invalidate();
    registration.dispose();
    assert.equal(registration.queued, false, 'disposal removes the existing queued registration');
  } finally {
    registration.dispose();
    engine.dispose();
  }
});

function captureNextMeasureRequest() {
  const originalInstantiate = WebAssembly.instantiate;
  let latestRequest;
  let measurementRequests = 0;
  WebAssembly.instantiate = async (source, imports) => {
    const instance = await originalInstantiate(source, imports);
    const exports = { ...instance.exports };
    const measure = exports[textShaperAbi.functions.measureParagraph];
    assert.equal(typeof measure, 'function', 'instrumented shaper must export measure_paragraph');
    exports[textShaperAbi.functions.measureParagraph] = (...arguments_) => {
      const [, pointer, length] = arguments_;
      measurementRequests += 1;
      latestRequest = new Uint8Array(exports.memory.buffer, pointer, length).slice();
      return measure(...arguments_);
    };
    return { exports };
  };
  return {
    restore() {
      WebAssembly.instantiate = originalInstantiate;
    },
    bytes() {
      assert.ok(latestRequest, 'a paragraph measurement request must have been captured');
      return latestRequest;
    },
    get count() {
      return measurementRequests;
    },
  };
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
    loadFont({ baked: { bytes } }, firstCollisionTechnique({ strikes: [16] })),
    loadFont({ baked: { bytes } }, secondCollisionTechnique({ strikes: [16] })),
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

test('the retained planner publishes canonical styles, flow, exclusions, and inline objects', async () => {
  const font = await fixtureFont();
  const capture = captureNextMeasureRequest();
  let glyphEngine;
  try {
    glyphEngine = await fixtureEngine();
  } finally {
    capture.restore();
  }
  const handleState = createGlyphHandleState(glyphEngine, { integration: 'test.render-planner-topology' });
  const codec = handleState.installCodec(threeCodecDescriptor);
  const fontBinding = handleState.bindFontStack(createFontStack(font));
  const transforms = [handleState.createTransformBinding(), handleState.createTransformBinding()];
  const inlineMaterials = [handleState.createMaterialBinding(), handleState.createMaterialBinding()];
  const inlineResources = [handleState.createResourceBinding(), handleState.createResourceBinding()];
  let acceptedPublications = 0;
  const transformTables = [];
  let targetControl;
  let duringAccept;
  const planner = handleState.createRootPlanner({
    codec,
    capabilitySetIndex: 0,
    target: (control) => {
      targetControl = control;
      return {
        delivery: 'borrowed',
        accept: (candidate) => {
          transformTables.push(candidate.transforms);
          duringAccept?.();
          acceptedPublications += 1;
          return { accepted: true };
        },
        dispose() {},
      };
    },
    limits: {
      maxParagraphs: 2,
      maxClusters: 64,
      maxLines: 16,
      maxRegions: 4,
      maxExclusions: 4,
      maxInlineObjects: 4,
      maxSlotsPerBand: 4,
      maxOutputBytes: 1_048_576,
    },
    requestCapacity: 65_536,
    resultCapacity: 1_048_576,
    textCapacity: 1_024,
  });
  const registration = registerGlyphShapeParticipant(glyphEngine, {
    stage: () => stageRenderPlanner(planner),
    accepted() {},
    rejected(error) {
      throw error;
    },
  });
  const stopObservingDirty = observeRenderPlannerDirty(planner, () => registration.invalidate());
  const region = (key, transform, inlineStart, inlineEnd) => ({
    key,
    transform,
    shape: 'rectangle',
    writingMode: 'horizontal-tb',
    textOrientation: 'mixed',
    inlineStart,
    blockStart: 0,
    inlineEnd,
    blockEnd: 80,
    clipInlineStart: inlineStart,
    clipBlockStart: 0,
    clipInlineEnd: inlineEnd,
    clipBlockEnd: 80,
  });
  const exclusion = (key, inlineStart, inlineEnd) => ({
    key,
    shape: 'rectangle',
    wrapSide: 'both',
    inlineStart,
    blockStart: 10,
    inlineEnd,
    blockEnd: 20,
    marginInline: 1,
    marginBlock: 2,
  });
  const inlineObject = (textOffset, material, resource) => ({
    textOffset,
    material,
    resource,
    inlineExtent: 8,
    blockExtent: 10,
    baselineOffset: 2,
    marginInlineStart: 1,
    marginInlineEnd: 1,
    marginBlockStart: 0,
    marginBlockEnd: 0,
    baselineAlignment: 'alphabetic',
  });
  const sourceText = 'A\uFFFcB\uFFFcC';
  const options = {
    font: fontBinding,
    text: {
      text: sourceText,
      spans: [
        {
          start: 1,
          end: 4,
          style: {
            language: 'fr',
            features: [{ tag: 'liga' }],
          },
        },
      ],
    },
    style: {
      fontSize: 18,
      lineHeight: 1.25,
      letterSpacing: 0.5,
      wordSpacing: 1.5,
      language: 'en-US',
      direction: 'rtl',
      features: [{ tag: 'kern', value: 2, start: 0, end: sourceText.length }],
      color: '#44556677',
      opacity: 0.75,
      decoration: {
        underline: true,
        lineThrough: true,
        color: '#11223344',
        thickness: 1,
        offset: 2,
      },
    },
    constraints: {
      width: { mode: 'exact', size: 160 },
      height: { mode: 'exact', size: 80 },
    },
    flow: {
      regions: [
        { region: region('left', transforms[0], 0, 80), exclusions: [exclusion('left-hole', 20, 30)] },
        { region: region('right', transforms[1], 80, 160), exclusions: [exclusion('right-hole', 100, 110)] },
      ],
    },
    inlineObjects: [
      inlineObject(1, inlineMaterials[0], inlineResources[0]),
      inlineObject(3, inlineMaterials[1], inlineResources[1]),
    ],
  };
  assert.throws(
    () => planner.createText({ ...options, inlineObjects: [inlineObject(6, inlineMaterials[0], inlineResources[0])] }),
    { name: 'RangeError', message: 'text inline object 0 offset is outside the text' },
  );
  assert.throws(
    () =>
      planner.createText({
        ...options,
        inlineObjects: [
          inlineObject(3, inlineMaterials[0], inlineResources[0]),
          inlineObject(1, inlineMaterials[1], inlineResources[1]),
        ],
      }),
    { name: 'RangeError', message: 'text inline object offsets must be strictly increasing' },
  );
  assert.throws(
    () => planner.createText({ ...options, style: { features: [{ tag: 'bad' }] } }),
    /feature 0 tag must contain exactly four printable ASCII bytes/u,
  );
  const text = planner.createText(options);

  try {
    const setterBytes = capture.bytes();
    assert.equal(text.measure().lineCount > 0, true);
    const bytes = setterBytes;
    assert.equal(text.glyphs().glyphCount > 0, true, 'explicit glyph inspection remains available after measurement');
    const request = textShaperAbi.layouts.engineUpdateRequest;
    const readRecords = (requestBytes, offsetField, countField, record) => {
      const header = new DataView(requestBytes.buffer, requestBytes.byteOffset, requestBytes.byteLength);
      const offset = header.getUint32(offsetField, true);
      const count = header.getUint32(countField, true);
      return Array.from(
        { length: count },
        (_value, index) =>
          new DataView(requestBytes.buffer, requestBytes.byteOffset + offset + index * record.size, record.size),
      );
    };
    const paragraph = readRecords(
      bytes,
      request.paragraphMutationsOffset,
      request.paragraphMutationCount,
      textShaperAbi.layouts.engineParagraphMutation,
    )[0].getUint32(textShaperAbi.layouts.engineParagraphMutation.paragraphId, true);
    const constraints = readRecords(
      bytes,
      request.constraintsOffset,
      request.constraintCount,
      textShaperAbi.layouts.engineConstraint,
    );
    const styles = readRecords(
      bytes,
      request.styleMutationsOffset,
      request.styleMutationCount,
      textShaperAbi.layouts.engineStyleMutation,
    );
    const textMutations = readRecords(
      bytes,
      request.textMutationsOffset,
      request.textMutationCount,
      textShaperAbi.layouts.engineTextMutation,
    );
    const regions = readRecords(bytes, request.regionsOffset, request.regionCount, textShaperAbi.layouts.engineRegion);
    const exclusions = readRecords(
      bytes,
      request.exclusionsOffset,
      request.exclusionCount,
      textShaperAbi.layouts.engineExclusion,
    );
    const inlineObjects = readRecords(
      bytes,
      request.inlineObjectsOffset,
      request.inlineObjectCount,
      textShaperAbi.layouts.engineInlineObject,
    );
    const regionIds = regions.map((value) => value.getUint32(textShaperAbi.layouts.engineRegion.id, true));
    const exclusionIds = exclusions.map((value) => value.getUint32(textShaperAbi.layouts.engineExclusion.id, true));
    const inlineObjectIds = inlineObjects.map((value) =>
      value.getUint32(textShaperAbi.layouts.engineInlineObject.id, true),
    );

    assert.equal(paragraph > 0, true);
    assert.equal(constraints.length, 1);
    assert.equal(styles.length, 2);
    assert.equal(regions.length, 2);
    assert.equal(
      textMutations[0].getUint16(textShaperAbi.layouts.engineTextMutation.reserved0, true),
      0,
      'compiler-owned reserved bytes remain zero',
    );
    assert.deepEqual(
      constraints.map((value) => value.getUint32(textShaperAbi.layouts.engineConstraint.resumeCluster, true)),
      [0],
    );
    assert.equal(new Set(regionIds).size, 2);
    assert.equal(new Set(exclusionIds).size, 2);
    assert.equal(new Set(inlineObjectIds).size, 2);
    assert.equal(
      regionIds.every((value) => value > 0),
      true,
    );
    assert.equal(
      exclusionIds.every((value) => value > 0),
      true,
    );
    assert.equal(
      inlineObjectIds.every((value) => value > 0),
      true,
    );
    assert.deepEqual(
      regions.map((value) => ({
        start: value.getUint16(textShaperAbi.layouts.engineRegion.exclusionStart, true),
        count: value.getUint16(textShaperAbi.layouts.engineRegion.exclusionCount, true),
      })),
      [
        { start: 0, count: 1 },
        { start: 1, count: 1 },
      ],
    );
    assert.deepEqual(
      exclusions.map((value) => value.getUint32(textShaperAbi.layouts.engineExclusion.regionId, true)),
      regionIds,
    );
    assert.deepEqual(
      inlineObjects.map((value) => value.getUint32(textShaperAbi.layouts.engineInlineObject.paragraphId, true)),
      [paragraph, paragraph],
    );
    assert.deepEqual(
      inlineObjects.map((value) => value.getUint32(textShaperAbi.layouts.engineInlineObject.textOffset, true)),
      [1, 3],
    );
    const style = textShaperAbi.layouts.engineStyleMutation;
    const fields = textShaperAbi.engine.styleFields;
    const rootStyle = styles[0];
    const spanStyle = styles[1];
    assert.equal(rootStyle.getUint8(style.opcode), textShaperAbi.engine.styleMutationOpcodes.upsert);
    assert.equal(spanStyle.getUint8(style.opcode), textShaperAbi.engine.styleMutationOpcodes.upsert);
    assert.equal(rootStyle.getUint8(style.flags), textShaperAbi.engine.styleFlags.root);
    assert.equal(spanStyle.getUint8(style.flags), 0);
    assert.equal(
      rootStyle.getUint32(style.fieldMask, true),
      fields.fontStack |
        fields.language |
        fields.features |
        fields.fontSize |
        fields.lineHeight |
        fields.letterSpacing |
        fields.wordSpacing |
        fields.rasterPixelRatio |
        fields.direction |
        fields.foreground |
        fields.opacity |
        fields.decoration,
    );
    assert.equal(spanStyle.getUint32(style.fieldMask, true), fields.language | fields.features);
    assert.equal(rootStyle.getUint8(style.direction), 2);
    assert.equal(spanStyle.getUint8(style.direction), 0, 'an absent direction stays zero');
    assert.equal(rootStyle.getUint32(style.textStart, true), 0);
    assert.equal(rootStyle.getUint32(style.textEnd, true), sourceText.length);
    assert.equal(spanStyle.getUint32(style.textStart, true), 1);
    assert.equal(spanStyle.getUint32(style.textEnd, true), 4);
    assert.equal(rootStyle.getUint32(style.materialId, true), 0, 'an absent material stays zero');
    assert.equal(rootStyle.getUint32(style.outlineRgba, true), 0, 'an absent outline stays zero');
    assert.equal(rootStyle.getUint32(style.outlineWidth, true), 0, 'an absent outline width stays zero');
    assert.equal(rootStyle.getUint32(style.shadowRgba, true), 0, 'an absent shadow stays zero');
    assert.equal(rootStyle.getUint32(style.shadowOffsetX, true), 0, 'an absent shadow offset stays zero');
    assert.equal(rootStyle.getUint32(style.shadowOffsetY, true), 0, 'an absent shadow offset stays zero');
    assert.equal(spanStyle.getUint32(style.fontStackHandle, true), 0, 'an inherited font stays absent');
    assert.equal(rootStyle.getUint8(style.decorationStyle), textShaperAbi.engine.decorationStyles.solid);
    assert.equal(rootStyle.getUint32(style.decorationRgba, true), 0x4433_2211);
    assert.equal(rootStyle.getUint32(style.decorationFlags, true), 5);
    assert.equal(rootStyle.getFloat32(style.decorationThickness, true), 1);
    assert.equal(rootStyle.getFloat32(style.decorationOffset, true), 2);
    assert.equal(spanStyle.getUint8(style.decorationStyle), 0, 'an absent decoration stays zero');
    assert.equal(spanStyle.getUint32(style.decorationFlags, true), 0, 'absent decoration flags stay zero');
    const scalarOffsets = [
      style.fontSize,
      style.lineHeight,
      style.letterSpacing,
      style.wordSpacing,
      style.baselineShift,
      style.rasterPixelRatio,
      style.opacity,
      style.outlineWidth,
      style.shadowOffsetX,
      style.shadowOffsetY,
      style.decorationThickness,
      style.decorationOffset,
    ];
    assert.equal(
      styles.every((record) => scalarOffsets.every((offset) => Number.isFinite(record.getFloat32(offset, true)))),
      true,
      'all emitted style scalars are finite, including canonical absent-field zeros',
    );
    assert.equal(
      [
        style.fontStackHandle,
        style.materialId,
        style.foregroundRgba,
        style.decorationRgba,
        style.decorationFlags,
        style.outlineRgba,
        style.shadowRgba,
        ...scalarOffsets,
      ].every((offset) => spanStyle.getUint32(offset, true) === 0),
      true,
      'every unstated scalar and packed style field remains bitwise zero',
    );
    const languageBytes = (styleRecord) =>
      bytes.subarray(
        styleRecord.getUint32(style.languageOffset, true),
        styleRecord.getUint32(style.languageOffset, true) + styleRecord.getUint16(style.languageLength, true),
      );
    assert.deepEqual(Array.from(languageBytes(rootStyle)), Array.from(new TextEncoder().encode('en-US')));
    assert.deepEqual(Array.from(languageBytes(spanStyle)), Array.from(new TextEncoder().encode('fr')));
    const feature = textShaperAbi.layouts.feature;
    const features = styles.map((styleRecord) => {
      assert.equal(styleRecord.getUint16(style.featureCount, true), 1);
      return new DataView(
        bytes.buffer,
        bytes.byteOffset + styleRecord.getUint32(style.featuresOffset, true),
        feature.size,
      );
    });
    assert.deepEqual(
      features.map((featureView) => ({
        tag: featureView.getUint32(feature.tag, true),
        value: featureView.getUint32(feature.value, true),
        start: featureView.getUint32(feature.start, true),
        end: featureView.getUint32(feature.end, true),
      })),
      [
        { tag: 0x6b65_726e, value: 2, start: 0, end: sourceText.length },
        { tag: 0x6c69_6761, value: 1, start: 1, end: 4 },
      ],
    );
    assert.equal(
      features.every((featureView, index) => {
        const start = featureView.getUint32(feature.start, true);
        const end = featureView.getUint32(feature.end, true);
        return (
          start >= styles[index].getUint32(style.textStart, true) && end <= styles[index].getUint32(style.textEnd, true)
        );
      }),
      true,
      'each feature range stays within its owning style range',
    );

    shapeGlyphEngine(glyphEngine);
    assert.equal(acceptedPublications, 1, 'the same producer state passes the Wasm publication path');
    const changedSpanStyle = {
      language: 'fr',
      features: [{ tag: 'liga' }],
      color: '#3366cc',
    };
    text.update({
      text: {
        text: sourceText,
        spans: [{ start: 1, end: 4, style: changedSpanStyle }],
      },
    });
    changedSpanStyle.color = '#ff0000';
    assert.equal(text.measure().lineCount > 0, true);
    const sparseStyleBytes = capture.bytes();
    const sparseStyles = readRecords(
      sparseStyleBytes,
      request.styleMutationsOffset,
      request.styleMutationCount,
      textShaperAbi.layouts.engineStyleMutation,
    );
    assert.equal(sparseStyles.length, 1, 'one changed span emits one retained style upsert');
    assert.equal(sparseStyles[0].getUint32(style.foregroundRgba, true), 0xffcc_6633, 'caller mutation is isolated');
    shapeGlyphEngine(glyphEngine);
    assert.equal(acceptedPublications, 2);
    const sparseMeasurement = text.measure();
    const requestsBeforeEqualUpdate = capture.count;

    text.update({
      text: {
        text: sourceText,
        spans: [
          {
            start: 1,
            end: 4,
            style: { language: 'fr', features: [{ tag: 'liga' }], color: '#3366cc' },
          },
        ],
      },
    });
    assert.deepEqual(text.measure(), sparseMeasurement, 'an equal normalized batch reuses its prepared measurement');
    assert.equal(capture.count, requestsBeforeEqualUpdate, 'an equal normalized batch does not reprepare Rust state');
    shapeGlyphEngine(glyphEngine);
    assert.equal(acceptedPublications, 3);

    text.update({
      flow: {
        regions: [
          { region: region('left', transforms[0], 0, 80), exclusions: [exclusion('left-hole', 24, 34)] },
          { region: region('right', transforms[1], 80, 160), exclusions: [exclusion('right-hole', 100, 110)] },
        ],
      },
    });
    assert.equal(text.measure().lineCount > 0, true);
    const movedBytes = capture.bytes();
    const movedRegions = readRecords(
      movedBytes,
      request.regionsOffset,
      request.regionCount,
      textShaperAbi.layouts.engineRegion,
    );
    const movedExclusions = readRecords(
      movedBytes,
      request.exclusionsOffset,
      request.exclusionCount,
      textShaperAbi.layouts.engineExclusion,
    );
    assert.deepEqual(
      movedRegions.map((value) => value.getUint32(textShaperAbi.layouts.engineRegion.id, true)),
      regionIds,
      'region identity is independent of a child exclusion update',
    );
    assert.deepEqual(
      movedRegions.map((value) => value.getUint32(textShaperAbi.layouts.engineRegion.geometryRevision, true)),
      [1, 1],
      'unchanged region geometry retains its per-entity revision',
    );
    assert.deepEqual(
      movedExclusions.map((value) => value.getUint32(textShaperAbi.layouts.engineExclusion.id, true)),
      exclusionIds,
      'exclusion identity is keyed independently of geometry',
    );
    assert.deepEqual(
      movedExclusions.map((value) => value.getUint32(textShaperAbi.layouts.engineExclusion.geometryRevision, true)),
      [2, 1],
      'only the moved exclusion advances its geometry revision',
    );
    shapeGlyphEngine(glyphEngine);
    assert.equal(acceptedPublications, 4);
    assert.equal(transformTables[3], transformTables[0], 'paint and exclusion edits reuse the complete table');
    assert.equal(Object.isFrozen(transformTables[0]), true);
    text.update({
      flow: {
        regions: [
          { region: region('right', transforms[1], 80, 160), exclusions: [exclusion('right-hole', 100, 110)] },
          { region: region('left', transforms[0], 0, 80), exclusions: [exclusion('left-hole', 24, 34)] },
        ],
      },
    });
    assert.equal(text.measure().lineCount > 0, true);
    const reorderedBytes = capture.bytes();
    const reorderedRegions = readRecords(
      reorderedBytes,
      request.regionsOffset,
      request.regionCount,
      textShaperAbi.layouts.engineRegion,
    );
    const reorderedExclusions = readRecords(
      reorderedBytes,
      request.exclusionsOffset,
      request.exclusionCount,
      textShaperAbi.layouts.engineExclusion,
    );
    assert.deepEqual(
      reorderedRegions.map((value) => value.getUint32(textShaperAbi.layouts.engineRegion.id, true)),
      [regionIds[1], regionIds[0]],
      'region order remains flow order without becoming entity identity',
    );
    assert.deepEqual(
      reorderedRegions.map((value) => value.getUint32(textShaperAbi.layouts.engineRegion.geometryRevision, true)),
      [1, 1],
      'reordering retains unchanged region revisions',
    );
    assert.deepEqual(
      reorderedExclusions.map((value) => value.getUint32(textShaperAbi.layouts.engineExclusion.id, true)),
      [exclusionIds[1], exclusionIds[0]],
      'exclusion identity remains stable across region reordering',
    );
    assert.deepEqual(
      reorderedExclusions.map((value) => value.getUint32(textShaperAbi.layouts.engineExclusion.geometryRevision, true)),
      [1, 2],
      'reordering retains each exclusion revision by key',
    );
    shapeGlyphEngine(glyphEngine);
    assert.equal(acceptedPublications, 5);
    assert.notEqual(transformTables[4], transformTables[3], 'ordered flow handle changes rebuild the table');
    assert.deepEqual(
      transformTables[4].slice(1).map((entry) => entry.binding),
      transformTables[0]
        .slice(1)
        .map((entry) => entry.binding)
        .reverse(),
    );
    const reorderedFlow = {
      regions: [
        { region: region('right', transforms[1], 80, 160), exclusions: [exclusion('right-hole', 100, 110)] },
        { region: region('left', transforms[0], 0, 80), exclusions: [exclusion('left-hole', 24, 34)] },
      ],
    };
    text.update({ flow: { regions: [reorderedFlow.regions[0]] } });
    const oneRegionBytes = capture.bytes();
    const oneRegion = readRecords(
      oneRegionBytes,
      request.regionsOffset,
      request.regionCount,
      textShaperAbi.layouts.engineRegion,
    );
    const oneExclusion = readRecords(
      oneRegionBytes,
      request.exclusionsOffset,
      request.exclusionCount,
      textShaperAbi.layouts.engineExclusion,
    );
    assert.deepEqual(
      oneRegion.map((value) => value.getUint32(textShaperAbi.layouts.engineRegion.id, true)),
      [regionIds[1]],
    );
    assert.deepEqual(
      oneExclusion.map((value) => value.getUint32(textShaperAbi.layouts.engineExclusion.id, true)),
      [exclusionIds[1]],
    );
    const acceptedRegionRevision = oneRegion[0].getUint32(textShaperAbi.layouts.engineRegion.geometryRevision, true);
    const acceptedExclusionRevision = oneExclusion[0].getUint32(
      textShaperAbi.layouts.engineExclusion.geometryRevision,
      true,
    );
    const acceptedOneRegion = text.measure();
    assert.throws(
      () => text.update({ text: 'bad\ud800text', flow: reorderedFlow }),
      (error) => error instanceof GlyphEngineStatusError && error.statusCode === 'invalid-request',
      'a failed semantic preparation cannot commit the expanded flow maps',
    );
    const requestsAfterRejectedFlow = capture.count;
    assert.deepEqual(text.measure(), acceptedOneRegion, 'preflight rejection preserves the accepted one-region layout');
    assert.equal(
      capture.count,
      requestsAfterRejectedFlow,
      'cached measurement needs no request after preflight rejection',
    );
    text.update({ flow: reorderedFlow });
    const regrownBytes = capture.bytes();
    const regrownRegions = readRecords(
      regrownBytes,
      request.regionsOffset,
      request.regionCount,
      textShaperAbi.layouts.engineRegion,
    );
    const regrownExclusions = readRecords(
      regrownBytes,
      request.exclusionsOffset,
      request.exclusionCount,
      textShaperAbi.layouts.engineExclusion,
    );
    assert.deepEqual(
      regrownRegions.map((value) => value.getUint32(textShaperAbi.layouts.engineRegion.id, true)),
      [regionIds[1], regionIds[0]],
      'a removed keyed region regains its stable identity after count growth',
    );
    assert.deepEqual(
      regrownExclusions.map((value) => value.getUint32(textShaperAbi.layouts.engineExclusion.id, true)),
      [exclusionIds[1], exclusionIds[0]],
      'a removed keyed exclusion regains its stable identity after count growth',
    );
    assert.equal(
      regrownRegions[0].getUint32(textShaperAbi.layouts.engineRegion.geometryRevision, true),
      acceptedRegionRevision,
      'the surviving region keeps its accepted revision',
    );
    assert.equal(
      regrownExclusions[0].getUint32(textShaperAbi.layouts.engineExclusion.geometryRevision, true),
      acceptedExclusionRevision,
      'the surviving exclusion keeps its accepted revision',
    );
    const fresh = planner.createText({
      ...options,
      text: {
        text: sourceText,
        spans: [{ start: 1, end: 4, style: { language: 'fr', features: [{ tag: 'liga' }], color: '#3366cc' } }],
      },
      flow: reorderedFlow,
    });
    try {
      assert.deepEqual(text.measure(), fresh.measure(), 'regrown warm layout matches a freshly prepared paragraph');
    } finally {
      fresh.dispose();
    }
    shapeGlyphEngine(glyphEngine);
    text.update({ flow: undefined });
    text.update({ flow: reorderedFlow });
    const restoredBytes = capture.bytes();
    const restoredRegions = readRecords(
      restoredBytes,
      request.regionsOffset,
      request.regionCount,
      textShaperAbi.layouts.engineRegion,
    );
    const restoredExclusions = readRecords(
      restoredBytes,
      request.exclusionsOffset,
      request.exclusionCount,
      textShaperAbi.layouts.engineExclusion,
    );
    assert.deepEqual(
      restoredRegions.map((value) => value.getUint32(textShaperAbi.layouts.engineRegion.id, true)),
      [regionIds[1], regionIds[0]],
    );
    assert.equal(
      restoredRegions[0].getUint32(textShaperAbi.layouts.engineRegion.geometryRevision, true) > acceptedRegionRevision,
      true,
      'ordinary geometry clears flow revision ownership before the keyed region returns',
    );
    assert.equal(
      restoredExclusions[0].getUint32(textShaperAbi.layouts.engineExclusion.geometryRevision, true) >
        acceptedExclusionRevision,
      true,
      'ordinary geometry clears flow exclusion ownership before the keyed exclusion returns',
    );
    text.update({ text: sourceText });
    assert.equal(
      text.measure().lineCount > 0,
      true,
      'the package-authored style removal passes Wasm and returns a measurement',
    );
    const removalBytes = capture.bytes();
    const removalStyles = readRecords(removalBytes, request.styleMutationsOffset, request.styleMutationCount, style);
    assert.equal(removalStyles.length, 1);
    assert.equal(removalStyles[0].getUint8(style.opcode), textShaperAbi.engine.styleMutationOpcodes.remove);
    const removalRecord = new Uint8Array(removalBytes.buffer, removalStyles[0].byteOffset, style.size);
    assert.equal(
      removalRecord.every(
        (value, index) =>
          index === style.opcode ||
          (index >= style.styleId && index < style.styleId + 4) ||
          (index >= style.paragraphId && index < style.paragraphId + 4) ||
          value === 0,
      ),
      true,
      'remove records zero every field outside their opcode and identities',
    );
    shapeGlyphEngine(glyphEngine);
    const mutableStyle = {
      fontSize: 18,
      features: [{ tag: 'kern', value: 2, start: 0, end: sourceText.length }],
    };
    text.update({ style: mutableStyle });
    mutableStyle.features[0].value = 7;
    const ownedStyleBytes = capture.bytes();
    const ownedStyle = readRecords(ownedStyleBytes, request.styleMutationsOffset, request.styleMutationCount, style)[0];
    assert.equal(
      new DataView(
        ownedStyleBytes.buffer,
        ownedStyleBytes.byteOffset + ownedStyle.getUint32(style.featuresOffset, true),
        feature.size,
      ).getUint32(feature.value, true),
      2,
      'later feature mutation cannot change the prepared style bytes',
    );
    const requestsBeforeEqualStyle = capture.count;
    text.update({ style: { fontSize: 18, features: [{ tag: 'kern', value: 2, start: 0, end: sourceText.length }] } });
    assert.equal(capture.count, requestsBeforeEqualStyle, 'caller mutation cannot change the retained style snapshot');
    shapeGlyphEngine(glyphEngine);
    const inheritedInvalidStyle = Object.create({ features: [{ tag: 'bad' }] });
    assert.throws(() => text.update({ style: inheritedInvalidStyle }), /feature 0 tag/u);
    let colorReads = 0;
    text.update({
      style: {
        get color() {
          colorReads += 1;
          return '#3366cc';
        },
      },
    });
    assert.equal(colorReads > 0, true, 'the authored style getter is evaluated during validation and ownership');
    const getterStyleBytes = capture.bytes();
    const getterStyle = readRecords(
      getterStyleBytes,
      request.styleMutationsOffset,
      request.styleMutationCount,
      style,
    )[0];
    assert.equal(getterStyle.getUint32(style.foregroundRgba, true), 0xffcc_6633);
    shapeGlyphEngine(glyphEngine);
    const stableTransforms = transformTables.at(-1);
    assert.throws(() => text.update({ style: { fontSize: -1 } }), /fontSize/);
    duringAccept = () => assert.throws(() => text.update({ text: 'reentrant' }), /borrow|publication|mutation/);
    targetControl.requestCheckpoint();
    shapeGlyphEngine(glyphEngine);
    assert.equal(
      transformTables.at(-1),
      stableTransforms,
      'invalid setters and checkpoints preserve the complete table',
    );
    duringAccept = undefined;

    const sharedMaterial = handleState.createMaterialBinding();
    const foreignHandleState = createGlyphHandleState(glyphEngine, {
      integration: 'test.render-planner-foreign-material',
    });
    const foreignMaterial = foreignHandleState.createMaterialBinding();
    const retainedMaterial = handleState._retainOpaqueBinding;
    const materialAcquisitions = [];
    handleState._retainOpaqueBinding = function (binding, kind) {
      if (kind === 'material') materialAcquisitions.push(binding);
      return retainedMaterial.call(this, binding, kind);
    };
    try {
      text.update({
        material: sharedMaterial,
        text: {
          text: sourceText,
          spans: [{ start: 1, end: 4, material: sharedMaterial }],
        },
        inlineObjects: [
          inlineObject(1, sharedMaterial, inlineResources[0]),
          inlineObject(3, sharedMaterial, inlineResources[1]),
        ],
      });
      assert.deepEqual(materialAcquisitions, [sharedMaterial], 'one source binding acquires one resolved lease');
      const publicationsBeforeSharedMaterial = acceptedPublications;
      const repeatedBytes = capture.bytes();
      const repeatedStyles = readRecords(
        repeatedBytes,
        request.styleMutationsOffset,
        request.styleMutationCount,
        style,
      );
      const repeatedObjects = readRecords(
        repeatedBytes,
        request.inlineObjectsOffset,
        request.inlineObjectCount,
        textShaperAbi.layouts.engineInlineObject,
      );
      const repeatedMaterialIds = [
        ...repeatedStyles.map((record) => record.getUint32(style.materialId, true)),
        ...repeatedObjects.map((record) => record.getUint32(textShaperAbi.layouts.engineInlineObject.materialId, true)),
      ];
      assert.equal(new Set(repeatedMaterialIds).size, 1, 'root, span, and inline records keep one material identity');
      shapeGlyphEngine(glyphEngine);
      assert.equal(acceptedPublications, publicationsBeforeSharedMaterial + 1);

      text.update({
        style: { fontSize: 19 },
        material: sharedMaterial,
        text: {
          text: sourceText,
          spans: [{ start: 1, end: 4, material: sharedMaterial }],
        },
        inlineObjects: [
          inlineObject(1, sharedMaterial, inlineResources[0]),
          inlineObject(3, sharedMaterial, inlineResources[1]),
        ],
      });
      assert.deepEqual(
        materialAcquisitions,
        [sharedMaterial, sharedMaterial],
        'the old and desired text revisions each own one lease for the same binding',
      );
      sharedMaterial.dispose();
      assert.equal(sharedMaterial.disposed, true, 'disposing the caller binding does not dispose resolved owners');
      assert.equal(text.measure().lineCount > 0, true);
      shapeGlyphEngine(glyphEngine);
      assert.equal(acceptedPublications, publicationsBeforeSharedMaterial + 2);

      assert.throws(
        () =>
          text.update({
            text: { text: sourceText, spans: [{ start: 1, end: 4, material: foreignMaterial }] },
          }),
        /material binding must be live and owned by this Glyph handle state/u,
      );
      assert.throws(() => text.update({ material: sharedMaterial }), /material binding must be live and owned/u);
      assert.equal(foreignMaterial.disposed, false, 'failed candidate cleanup leaves the foreign owner alive');
      assert.equal(text.measure().lineCount > 0, true, 'the prior desired revision remains usable after failure');
      shapeGlyphEngine(glyphEngine);
      assert.equal(
        acceptedPublications,
        publicationsBeforeSharedMaterial + 2,
        'rejected inputs leave the accepted frame unchanged and require no renderer publication',
      );
      text.dispose();
      shapeGlyphEngine(glyphEngine);
      assert.throws(
        () => handleState._resolveOpaqueBinding('material', repeatedMaterialIds[0]),
        /unknown material binding/u,
        'the material registration is released when its resolved text owner dies',
      );
    } finally {
      handleState._retainOpaqueBinding = retainedMaterial;
      if (!sharedMaterial.disposed) sharedMaterial.dispose();
      foreignMaterial.dispose();
      foreignHandleState.dispose();
    }
  } finally {
    stopObservingDirty();
    registration.dispose();
    text.dispose();
    planner.dispose();
    fontBinding.dispose();
    for (const binding of [...transforms, ...inlineMaterials, ...inlineResources]) binding.dispose();
    codec.dispose();
    handleState.dispose();
    glyphEngine.dispose();
    font.dispose();
  }
});

test(
  'retained style identities survive restyle, shrink, regrow, replay, and empty spans',
  { concurrency: false },
  async () => {
    const font = await fixtureFont();
    let capture;
    let glyphEngine;
    let handleState;
    let codec;
    let fontBinding;
    let planner;
    let registration;
    let stopObservingDirty;
    let originalId;
    let text;
    let nextOwner;
    let styleMints = 0;
    try {
      capture = captureNextMeasureRequest();
      try {
        glyphEngine = await fixtureEngine();
      } finally {
        capture.restore();
      }
      handleState = createGlyphHandleState(glyphEngine, { integration: 'test.render-planner-style-identities' });
      codec = handleState.installCodec(threeCodecDescriptor);
      fontBinding = handleState.bindFontStack(createFontStack(font));
      let rejectNext = false;
      planner = handleState.createRootPlanner({
        codec,
        capabilitySetIndex: 0,
        target: () => ({
          delivery: 'borrowed',
          accept() {
            if (rejectNext) {
              rejectNext = false;
              throw new Error('deliberate retained style replay');
            }
            return { accepted: true };
          },
          dispose() {},
        }),
        limits: {
          maxParagraphs: 2,
          maxClusters: 64,
          maxLines: 16,
          maxRegions: 1,
          maxExclusions: 1,
          maxInlineObjects: 1,
          maxSlotsPerBand: 4,
          maxOutputBytes: 1_048_576,
        },
        requestCapacity: 65_536,
        resultCapacity: 1_048_576,
        textCapacity: 1_024,
      });
      registration = registerGlyphShapeParticipant(glyphEngine, {
        stage: () => stageRenderPlanner(planner),
        accepted() {},
        rejected() {},
      });
      stopObservingDirty = observeRenderPlannerDirty(planner, () => registration.invalidate());
      const readStyleMutations = () => {
        const bytes = capture.bytes();
        const request = textShaperAbi.layouts.engineUpdateRequest;
        const record = textShaperAbi.layouts.engineStyleMutation;
        const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const offset = header.getUint32(request.styleMutationsOffset, true);
        const count = header.getUint32(request.styleMutationCount, true);
        return Array.from({ length: count }, (_value, index) => {
          const mutation = new DataView(bytes.buffer, bytes.byteOffset + offset + index * record.size, record.size);
          return {
            opcode: mutation.getUint8(record.opcode),
            styleId: mutation.getUint32(record.styleId, true),
          };
        });
      };
      const readStyleForegrounds = () => {
        const bytes = capture.bytes();
        const request = textShaperAbi.layouts.engineUpdateRequest;
        const record = textShaperAbi.layouts.engineStyleMutation;
        const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const offset = header.getUint32(request.styleMutationsOffset, true);
        const count = header.getUint32(request.styleMutationCount, true);
        return Array.from({ length: count }, (_value, index) =>
          new DataView(bytes.buffer, bytes.byteOffset + offset + index * record.size, record.size).getUint32(
            record.foregroundRgba,
            true,
          ),
        );
      };
      const span = (start, end, color) => ({ start, end, style: { color } });
      const initialSpans = [span(0, 2, '#aa0000'), span(2, 4, '#00aa00')];
      originalId = GlyphIdScope.prototype.id;
      GlyphIdScope.prototype.id = function (kind, name) {
        if (kind === 'style') styleMints += 1;
        return originalId.call(this, kind, name);
      };
      text = planner.createText({ font: fontBinding, text: { text: 'abcd', spans: initialSpans } });
      initialSpans[0].style.color = '#ff00ff';
      const initial = readStyleMutations();
      const styleIds = initial.map(({ styleId }) => styleId);
      assert.equal(styleMints, 3, 'root and two non-empty span identities are minted once');
      assert.equal(readStyleForegrounds()[1], 0xff00_00aa, 'nested caller mutation cannot change retained RGBA bytes');
      assert.deepEqual(
        initial.map(({ opcode }) => opcode),
        [
          textShaperAbi.engine.styleMutationOpcodes.upsert,
          textShaperAbi.engine.styleMutationOpcodes.upsert,
          textShaperAbi.engine.styleMutationOpcodes.upsert,
        ],
      );
      const initialMeasurement = text.measure();
      initialSpans[0].style.color = '#aa0000';
      shapeGlyphEngine(glyphEngine);

      text.update({ text: { text: 'abcd', spans: [span(0, 2, '#0000aa'), initialSpans[1]] } });
      assert.deepEqual(readStyleMutations(), [
        { opcode: textShaperAbi.engine.styleMutationOpcodes.upsert, styleId: styleIds[1] },
      ]);
      assert.equal(styleMints, 3, 'restyling reuses its retained canonical identity');
      assert.deepEqual(text.measure(), initialMeasurement, 'paint-only restyling preserves shaped metrics');
      shapeGlyphEngine(glyphEngine);

      text.update({ text: { text: 'abcd', spans: [span(0, 2, '#0000aa')] } });
      assert.deepEqual(readStyleMutations(), [
        { opcode: textShaperAbi.engine.styleMutationOpcodes.remove, styleId: styleIds[2] },
      ]);
      assert.equal(styleMints, 3, 'shrink removes the retained high-water identity without reminting');
      shapeGlyphEngine(glyphEngine);

      text.update({ text: { text: 'abcd', spans: [span(0, 2, '#0000aa'), span(2, 4, '#00aa00')] } });
      assert.deepEqual(readStyleMutations(), [
        { opcode: textShaperAbi.engine.styleMutationOpcodes.upsert, styleId: styleIds[2] },
      ]);
      assert.equal(styleMints, 3, 'regrowth restores the same style identity');
      shapeGlyphEngine(glyphEngine);

      text.update({
        text: {
          text: 'abcd',
          spans: [span(0, 2, '#0000aa'), { start: 2, end: 2, style: { color: '#ffffff' } }, span(2, 4, '#00aa00')],
        },
      });
      assert.equal(
        readStyleMutations().every(
          ({ opcode, styleId }) =>
            opcode !== textShaperAbi.engine.styleMutationOpcodes.upsert || styleIds.includes(styleId),
        ),
        true,
        'empty spans do not create an engine style identity',
      );
      assert.equal(styleMints, 3, 'empty spans do not allocate retained identities');
      assert.deepEqual(text.measure(), initialMeasurement, 'empty spans preserve the prepared measurement');
      shapeGlyphEngine(glyphEngine);

      text.update({
        text: {
          text: 'abcd',
          spans: [span(0, 2, '#0000aa'), span(2, 3, '#00aa00'), span(3, 4, '#aa00aa')],
        },
      });
      const grownStyleMutations = readStyleMutations();
      assert.equal(grownStyleMutations.length, 2, 'the new high-water slot emits one additional style mutation');
      const newSlotId = grownStyleMutations[1].styleId;
      assert.deepEqual(
        grownStyleMutations.map(({ styleId }) => styleId),
        [styleIds[2], newSlotId],
        'growth updates the retained span and assigns the new high-water slot its own wire identity',
      );
      assert.equal(styleMints, 4, 'growth into one unused style slot mints exactly one identity');
      assert.equal(styleIds.includes(newSlotId), false, 'the new slot identity was not used by an earlier style');
      shapeGlyphEngine(glyphEngine);

      rejectNext = true;
      text.update({
        text: {
          text: 'abcd',
          spans: [span(0, 2, '#0000aa'), span(2, 3, '#00aa00'), span(3, 4, '#bb00bb')],
        },
      });
      assert.deepEqual(readStyleMutations(), [
        { opcode: textShaperAbi.engine.styleMutationOpcodes.upsert, styleId: newSlotId },
      ]);
      assert.throws(() => shapeGlyphEngine(glyphEngine), /deliberate retained style replay/u);
      text.update({ style: { color: '#223344' } });
      assert.equal(styleMints, 4, 'replay reuses the newly grown slot and all earlier style identities');
      assert.deepEqual(text.measure(), initialMeasurement, 'replay preserves the prepared layout');
      shapeGlyphEngine(glyphEngine);

      text.update({
        text: {
          text: 'wxyz',
          spans: [span(0, 2, '#0000aa'), span(2, 3, '#00aa00'), span(3, 4, '#bb00bb')],
        },
      });
      assert.deepEqual(readStyleMutations(), [], 'text changes reuse unchanged style slots across the new text value');
      const changedTextMeasurement = text.measure();
      shapeGlyphEngine(glyphEngine);
      assert.deepEqual(
        text.measure(),
        changedTextMeasurement,
        'the warm query matches the published changed-text result',
      );
      assert.equal(styleMints, 4, 'changed text with unchanged spans does not mint style identities');

      assert.throws(
        () => text.update({ text: { text: 'x', spans: [span(0, 2, '#0000aa')] } }),
        /outside the text/u,
        'reused spans are still checked against newly shortened text',
      );
      assert.deepEqual(
        text.measure(),
        changedTextMeasurement,
        'invalid shortened text leaves the accepted query intact',
      );
      shapeGlyphEngine(glyphEngine);

      text.dispose();
      nextOwner = planner.createText({ font: fontBinding, text: { text: 'xy', spans: [span(0, 2, '#445566')] } });
      const newOwnerIds = readStyleMutations().map(({ styleId }) => styleId);
      assert.equal(styleMints, 6, 'a distinct retained owner mints only its root and first span identities');
      assert.equal(new Set([...styleIds, newSlotId, ...newOwnerIds]).size, 6, 'style IDs remain paragraph-scoped');
      shapeGlyphEngine(glyphEngine);
    } finally {
      if (originalId !== undefined) GlyphIdScope.prototype.id = originalId;
      stopObservingDirty?.();
      registration?.dispose();
      text?.dispose();
      nextOwner?.dispose();
      planner?.dispose();
      fontBinding?.dispose();
      codec?.dispose();
      handleState?.dispose();
      glyphEngine?.dispose();
      font.dispose();
    }
  },
);

test('style-clean text edits do not consume the setter preparation style-mutation limit', async () => {
  const font = await fixtureFont();
  const glyphEngine = await fixtureEngine();
  const handleState = createGlyphHandleState(glyphEngine, { integration: 'test.render-planner-style-limits' });
  const codec = handleState.installCodec(threeCodecDescriptor);
  const fontBinding = handleState.bindFontStack(createFontStack(font));
  let acceptedPublications = 0;
  const transformTables = [];
  const sharedTransform = handleState.createTransformBinding();
  let targetControl;
  let reject = false;
  let replacement;
  let recycledTransform;
  let recycledText;
  const planner = handleState.createRootPlanner({
    codec,
    capabilitySetIndex: 0,
    target: (control) => {
      targetControl = control;
      return {
        delivery: 'borrowed',
        accept: (candidate) => {
          transformTables.push(candidate.transforms);
          if (reject) throw new Error('transform target rejected');
          acceptedPublications += 1;
          return { accepted: true };
        },
        dispose() {},
      };
    },
    limits: {
      maxParagraphs: 3,
      maxClusters: 5,
      maxLines: 5,
      maxRegions: 3,
      maxExclusions: 1,
      maxInlineObjects: 1,
      maxSlotsPerBand: 1,
      maxOutputBytes: 1_048_576,
    },
    requestCapacity: 65_536,
    resultCapacity: 1_048_576,
    textCapacity: 64,
  });
  const registration = registerGlyphShapeParticipant(glyphEngine, {
    stage: () => stageRenderPlanner(planner),
    accepted() {},
    rejected(error) {
      throw error;
    },
  });
  const stopObservingDirty = observeRenderPlannerDirty(planner, () => registration.invalidate());
  const first = planner.createText({
    font: fontBinding,
    text: {
      text: 'abc',
      spans: [
        { start: 0, end: 1, style: { color: '#ff0000' } },
        { start: 1, end: 2, style: { color: '#00ff00' } },
      ],
    },
  });
  const second = planner.createText({ font: fontBinding, text: 'd' });
  const third = planner.createText({ font: fontBinding, text: 'e' });

  try {
    shapeGlyphEngine(glyphEngine);
    assert.equal(acceptedPublications, 1);

    // Two span removals and this root paint update consume three slots in this setter preparation.
    first.update({ text: 'abc', style: { color: '#ff0000' } });
    second.update({
      // This independent setter preparation carries one root update and one span upsert.
      style: { color: '#00ff00' },
      text: {
        text: 'd',
        spans: [{ start: 0, end: 1, style: { color: '#0000ff' } }],
      },
    });
    assert.doesNotThrow(
      () => third.update({ text: 'f' }),
      'a text-only edit emits no style record in its setter preparation',
    );
    shapeGlyphEngine(glyphEngine);
    assert.equal(acceptedPublications, 2);
    assert.equal(transformTables[1], transformTables[0], 'ordinary edits retain the complete transform table');
    first.update({ transform: sharedTransform });
    third.update({ transform: sharedTransform });
    shapeGlyphEngine(glyphEngine);
    const sharedTable = transformTables.at(-1);
    assert.notEqual(sharedTable, transformTables[0]);
    assert.equal(sharedTable.find((entry) => entry.instanceIds?.length === 2) !== undefined, true);
    reject = true;
    targetControl.requestCheckpoint();
    assert.throws(() => shapeGlyphEngine(glyphEngine), /transform target rejected/);
    assert.equal(transformTables.at(-1), sharedTable);
    reject = false;
    shapeGlyphEngine(glyphEngine);
    assert.equal(transformTables.at(-1), sharedTable, 'renderer rejection preserves transform authority');
    third.dispose();
    shapeGlyphEngine(glyphEngine);
    const removedTable = transformTables.at(-1);
    assert.notEqual(removedTable, sharedTable);
    assert.equal(
      removedTable.every((entry) => entry.instanceIds?.length === 1),
      true,
    );
    replacement = planner.createText({ font: fontBinding, text: 'g', transform: sharedTransform });
    shapeGlyphEngine(glyphEngine);
    assert.notEqual(transformTables.at(-1), removedTable);
    assert.equal(transformTables.at(-1).find((entry) => entry.instanceIds?.length === 2) !== undefined, true);
    const sharedEntry = transformTables.at(-1).find((entry) => entry.instanceIds?.length === 2);
    first.dispose();
    second.dispose();
    replacement.dispose();
    shapeGlyphEngine(glyphEngine);
    assert.deepEqual(transformTables.at(-1), [], 'empty publication clears transform membership');
    sharedTransform.dispose();
    recycledTransform = handleState.createTransformBinding();
    recycledText = planner.createText({ font: fontBinding, text: 'h', transform: recycledTransform });
    shapeGlyphEngine(glyphEngine);
    const recycledEntry = transformTables.at(-1)[0];
    assert.equal(recycledEntry.transformIndex, sharedEntry.transformIndex, 'the freed transform ordinal is reused');
    assert.notEqual(recycledEntry.binding, sharedEntry.binding, 'recycling resolves the new binding identity');
  } finally {
    stopObservingDirty();
    registration.dispose();
    first.dispose();
    second.dispose();
    third.dispose();
    replacement?.dispose();
    recycledText?.dispose();
    planner.dispose();
    recycledTransform?.dispose();
    sharedTransform.dispose();
    fontBinding.dispose();
    codec.dispose();
    handleState.dispose();
    glyphEngine.dispose();
    font.dispose();
  }
});

test('base-order publication admits swaps and preserves pending order across semantic preparation', async () => {
  const font = await fixtureFont();
  const glyphEngine = await fixtureEngine();
  const handleState = createGlyphHandleState(glyphEngine, { integration: 'test.render-planner-order-ownership' });
  const codec = handleState.installCodec(threeCodecDescriptor);
  const fontBinding = handleState.bindFontStack(createFontStack(font));
  let acceptedPublications = 0;
  const planner = handleState.createRootPlanner({
    codec,
    capabilitySetIndex: 0,
    target: () => ({
      delivery: 'borrowed',
      accept: () => {
        acceptedPublications += 1;
        return { accepted: true };
      },
      dispose() {},
    }),
    limits: {
      maxParagraphs: 4,
      maxClusters: 16,
      maxLines: 16,
      maxRegions: 4,
      maxExclusions: 1,
      maxInlineObjects: 1,
      maxSlotsPerBand: 1,
      maxOutputBytes: 1_048_576,
    },
    requestCapacity: 65_536,
    resultCapacity: 1_048_576,
    textCapacity: 64,
  });
  const registration = registerGlyphShapeParticipant(glyphEngine, {
    stage: () => stageRenderPlanner(planner),
    accepted() {},
    rejected(error) {
      throw error;
    },
  });
  const stopObservingDirty = observeRenderPlannerDirty(planner, () => registration.invalidate());
  const first = planner.createText({ font: fontBinding, order: 10, text: 'alpha' });
  const second = planner.createText({ font: fontBinding, order: 20, text: 'beta' });
  let duplicate;
  let replacement;
  let formerOrderReuse;

  try {
    shapeGlyphEngine(glyphEngine);
    assert.equal(acceptedPublications, 1);

    first.updateOrder(20, 0, 0);
    first.update({ text: 'alpha moved' });
    second.updateOrder(10, 0, 0);
    assert.equal(first.measure().glyphCount, 11, 'the semantic setter prepares before the order swap publishes');
    shapeGlyphEngine(glyphEngine);
    assert.equal(acceptedPublications, 2, 'the complete unique swap publishes as one transaction');

    first.updateOrder(30, 0, 0);
    second.updateOrder(30, 0, 0);
    first.update({ text: 'pending duplicate' });
    assert.equal(first.measure().glyphCount, 17, 'duplicate desired order does not block independent preparation');
    assert.throws(
      () => shapeGlyphEngine(glyphEngine),
      /retained text order 30 is already in use/,
      'only the complete publication rejects a duplicate final order',
    );
    assert.equal(acceptedPublications, 2, 'a rejected final order preserves the last accepted renderer state');
    assert.equal(first.measure().glyphCount, 17, 'publication rejection retains current prepared content');
    second.updateOrder(40, 0, 0);
    shapeGlyphEngine(glyphEngine);
    assert.equal(acceptedPublications, 3, 'repairing the final order retries the retained preparation');

    duplicate = planner.createText({ font: fontBinding, order: 30, text: 'duplicate creation' });
    assert.equal(duplicate.measure().glyphCount, 18, 'creation prepares at an unobservable temporary lifecycle order');
    assert.throws(
      () => shapeGlyphEngine(glyphEngine),
      /retained text order 30 is already in use/,
      'the complete final set still rejects duplicate created order before serialization',
    );
    duplicate.dispose();

    first.dispose();
    replacement = planner.createText({ font: fontBinding, order: 30, text: 'replacement' });
    assert.equal(replacement.measure().glyphCount, 11, 'removal and same-order creation prepare atomically');
    replacement.updateOrder(50, 0, 0);
    replacement.update({ text: 'replacement moved' });
    assert.equal(replacement.measure().glyphCount, 17, 'an ordinary setter preserves pending lifecycle intent');
    shapeGlyphEngine(glyphEngine);
    assert.equal(acceptedPublications, 4);

    replacement.updateOrder(60, 0, 0);
    const beforeRejectedPreparation = replacement.measure();
    assert.throws(
      () => replacement.update({ text: 'bad\ud800text' }),
      (error) => error instanceof GlyphEngineStatusError && error.statusCode === 'invalid-request',
    );
    assert.equal(
      replacement.measure(),
      beforeRejectedPreparation,
      'a rejected preparation retains both measurement and pending order intent',
    );
    shapeGlyphEngine(glyphEngine);
    assert.equal(acceptedPublications, 5, 'the pending order publishes after preparation rollback');

    formerOrderReuse = planner.createText({ font: fontBinding, order: 30, text: 'former order reused' });
    assert.equal(formerOrderReuse.measure().glyphCount, 19, 'the former order prepares after the pending move commits');
    shapeGlyphEngine(glyphEngine);
    assert.equal(
      acceptedPublications,
      6,
      'reusing the former order proves Rust installed the recovered paragraph at its pending order',
    );
  } finally {
    stopObservingDirty();
    registration.dispose();
    first.dispose();
    second.dispose();
    duplicate?.dispose();
    replacement?.dispose();
    formerOrderReuse?.dispose();
    planner.dispose();
    fontBinding.dispose();
    codec.dispose();
    handleState.dispose();
    glyphEngine.dispose();
    font.dispose();
  }
});
