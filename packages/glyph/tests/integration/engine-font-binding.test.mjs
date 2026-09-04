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

const fontUrl = new URL('../../../../apps/benchmarks/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);
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

function captureNextMeasureRequest() {
  const originalInstantiate = WebAssembly.instantiate;
  let latestRequest;
  WebAssembly.instantiate = async (source, imports) => {
    const instance = await originalInstantiate(source, imports);
    const exports = { ...instance.exports };
    const measure = exports[textShaperAbi.functions.measureParagraph];
    assert.equal(typeof measure, 'function', 'instrumented shaper must export measure_paragraph');
    exports[textShaperAbi.functions.measureParagraph] = (...arguments_) => {
      const [, pointer, length] = arguments_;
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
      maxParagraphs: 1,
      maxClusters: 64,
      maxLines: 16,
      maxRegions: 2,
      maxExclusions: 2,
      maxInlineObjects: 2,
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
  const region = (transform, inlineStart, inlineEnd) => ({
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
  const exclusion = (inlineStart, inlineEnd) => ({
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
        { region: region(transforms[0], 0, 80), exclusions: [exclusion(20, 30)] },
        { region: region(transforms[1], 80, 160), exclusions: [exclusion(100, 110)] },
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
    assert.equal(text.measure().lineCount > 0, true);
    const bytes = capture.bytes();
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
    text.update({ text: sourceText });
    assert.equal(
      text.measure().lineCount > 0,
      true,
      'the package-authored style removal passes Wasm and returns a measurement',
    );
    const removalBytes = capture.bytes();
    const removalStyles = readRecords(removalBytes, request.styleMutationsOffset, request.styleMutationCount, style);
    assert.equal(removalStyles.length, 2);
    assert.equal(removalStyles[0].getUint8(style.opcode), textShaperAbi.engine.styleMutationOpcodes.upsert);
    assert.equal(removalStyles[1].getUint8(style.opcode), textShaperAbi.engine.styleMutationOpcodes.remove);
    const removalRecord = new Uint8Array(removalBytes.buffer, removalStyles[1].byteOffset, style.size);
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
