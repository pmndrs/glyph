import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after, before } from 'node:test';
import { gunzipSync } from 'node:zlib';

import { glyph, msdf } from '@pmndrs/glyph';
import {
  id,
  defineGlyphConfig,
  defineGlyphSchema,
  resourceLease,
  createRasterCodecProgram,
  defineCodecBuffers,
  msdfCodec,
} from '@pmndrs/glyph/core';

import { PlanTransport } from '../../dist/internal/handle-state.js';

const fontUrl = new URL('../../../../benches/fixtures/rendering/inter-mtsdf.font.glb.gz', import.meta.url);
const capabilitySet = Object.freeze({
  capabilities: Object.freeze(['alias-vec2', 'alias-vec4', 'ordered-direct']),
  maxBufferBytes: 16 * 1024 * 1024,
  updateAlignment: 4,
  coalesceGapBytes: 128,
  rangeCallPenaltyBytes: 256,
  maxBuffersPerDraw: 8,
  maxResourcesPerDraw: 4,
  maxIndirectDraws: 0,
  fragmentationBudget: 8,
  wholeBufferThresholdBasisPoints: 7_500,
});
const system = defineCodecBuffers({
  stableGlyphId: { id: id.buffer('test.removal-lifecycle/stable-glyph'), scalar: 'u32', lanes: ['stableGlyphId'] },
  placementSlot: { id: id.buffer('test.removal-lifecycle/placement-slot'), scalar: 'u32', lanes: ['placementSlot'] },
});

/** A headless config that exposes the shared text services so tests drive controllers directly. */
function defineHeadlessConfig() {
  const schema = defineGlyphSchema({
    program: () => ({}),
    buffer: () => ({}),
    material: () => ({}),
    transform: () => ({}),
    batch: () => ({}),
    instance: (_boundary, input) => ({ recordCount: input.instance.recordCount }),
    instanceSpan: () => ({}),
  });
  return defineGlyphConfig({
    schema,
    fonts: { default: 'msdf', formats: { msdf } },
    encode: ({ ids }) => ({
      descriptor: {
        capabilitySets: [capabilitySet],
        programs: [
          createRasterCodecProgram(msdfCodec, {
            namespace: 'removal-lifecycle-test',
            system,
            capabilitySet,
            transformMode: 'direct',
            ids,
          }),
        ],
      },
    }),
    resolve: ({ payload }) => resourceLease({ payload }, () => undefined),
    renderer: ({ defaultRenderer }) =>
      defaultRenderer ?? {
        decode: () => ({ result: undefined, commit: () => undefined, discard: () => undefined }),
        syncTransforms: () => undefined,
        dispose: () => undefined,
      },
    root: {
      create: (context) => context.create({ fonts: context.fonts, services: context.services }, { boundary: {} }),
    },
  });
}

const unconstrained = { width: { mode: 'unconstrained' }, height: { mode: 'unconstrained' } };
const exact = (size) => ({ width: { mode: 'exact', size }, height: { mode: 'unconstrained' } });

function textState(font, text, constraints) {
  return {
    font,
    transform: { paragraph: true },
    style: { fontSize: 16, lineHeight: 1.5, letterSpacing: 0, color: [0, 0, 0, 1] },
    layout: { wrap: 'none', align: 'start', overflow: 'visible' },
    constraints,
    text,
  };
}

let handle;
let face;
let font;

before(async () => {
  await glyph.init();
  handle = glyph.handle('test:removal-lifecycle', defineHeadlessConfig());
  face = glyph.fontFace(new Blob([gunzipSync(await readFile(fontUrl))], { type: 'model/gltf-binary' }), {
    family: 'RemovalLifecycle',
    format: msdf,
  });
  await face.load();
  font = handle.fonts.acquire(face.msdf);
});

after(() => {
  font?.dispose();
  face?.dispose();
  handle?.dispose();
});

test('a text measured but never published disposes before the next publication', () => {
  const text = handle.services.createText(textState(font, 'popup item', exact(100)));
  assert.ok(text.measure().lineCount >= 1);
  text.dispose();
  assert.doesNotThrow(() => glyph.shape());
});

test('a text measured at two widths on a named root disposes before the next publication', () => {
  const root = handle('removal-lifecycle:two-widths');
  const text = root.services.createText(textState(font, 'popup item', exact(100)));
  const wide = text.measure();
  text.update(textState(font, 'popup item', exact(50)));
  const narrow = text.measure();
  assert.equal(wide.width, 100);
  assert.equal(narrow.width, 50);
  text.dispose();
  assert.doesNotThrow(() => glyph.shape());
  root.dispose();
});

test('a published text re-measures while a sibling removal waits for the next publication', () => {
  const root = handle('removal-lifecycle:sibling-removal');
  const a = root.services.createText(textState(font, 'Button', unconstrained));
  const intrinsic = a.measure();
  const b = root.services.createText(textState(font, 'Hover me', unconstrained));
  b.measure();
  glyph.shape();

  b.dispose();
  a.update(textState(font, 'Button', exact(intrinsic.width)));
  let measured;
  assert.doesNotThrow(() => {
    measured = a.measure();
  });
  assert.equal(measured.width, intrinsic.width);
  assert.equal(measured.lineCount, intrinsic.lineCount);

  assert.doesNotThrow(() => glyph.shape());
  assert.equal(a.measure().width, intrinsic.width);
  a.dispose();
  assert.doesNotThrow(() => glyph.shape());
  root.dispose();
});

test('canceling an unqueried creation leaves later copy queries free of lifecycle rows', (t) => {
  const root = handle('removal-lifecycle:canceled-creation');
  const source = root.services.createText(textState(font, 'retained', unconstrained));
  const destination = () => ({
    boundary: {},
    renderer: {
      decode: () => ({ result: undefined, commit: () => undefined, discard: () => undefined }),
      syncTransforms: () => undefined,
      dispose: () => undefined,
    },
  });
  let copy;
  try {
    glyph.shape();
    const inspection = source.inspect();
    const canceled = root.services.createText(textState(font, 'canceled', unconstrained));
    canceled.dispose();
    const lifecycleCounts = [];
    let publications = 0;
    const prepareParagraph = PlanTransport.prototype.prepareParagraph;
    const stageUpdate = PlanTransport.prototype.stageUpdate;
    PlanTransport.prototype.prepareParagraph = function (request, ...rest) {
      lifecycleCounts.push(request.paragraphMutations.length);
      return prepareParagraph.call(this, request, ...rest);
    };
    PlanTransport.prototype.stageUpdate = function (...arguments_) {
      publications += 1;
      return stageUpdate.apply(this, arguments_);
    };
    t.after(() => {
      PlanTransport.prototype.prepareParagraph = prepareParagraph;
      PlanTransport.prototype.stageUpdate = stageUpdate;
    });
    copy = root.services.copy(source, { kind: 'glyphs', stableIds: inspection.glyphStableIds }, destination());
    assert.deepEqual(lifecycleCounts, [], 'copy consumes durable preparation without another lifecycle request');
    assert.equal(publications, 0, 'copying cannot publish the source');
    assert.deepEqual(source.inspect().glyphStableIds, inspection.glyphStableIds);
    copy.dispose();
    const retained = root.services.createText(textState(font, 'retained sibling', unconstrained));
    const anotherCanceled = root.services.createText(textState(font, 'another canceled sibling', unconstrained));
    anotherCanceled.dispose();
    try {
      copy = root.services.copy(source, { kind: 'glyphs', stableIds: inspection.glyphStableIds }, destination());
      assert.deepEqual(lifecycleCounts, [2, 1], 'setters carry the canceled removal and new creation exactly once');
      assert.equal(publications, 0);
    } finally {
      retained.dispose();
    }
  } finally {
    copy?.dispose();
    source.dispose();
    root.dispose();
  }
});

test('copy resolves a cached glyph subset after a sibling restarts speculative identities', () => {
  const root = handle('removal-lifecycle:copy-selection');
  const source = root.services.createText(textState(font, 'ABC', unconstrained));
  let sibling;
  let copy;
  try {
    const original = source.inspect();
    sibling = root.services.createText(textState(font, 'sibling', unconstrained));
    sibling.inspect();
    copy = root.services.copy(
      source,
      { kind: 'glyphs', stableIds: [original.glyphStableIds[1]] },
      {
        boundary: {},
        renderer: {
          decode: (view) => ({
            result: [...view.displayList.value.children].reduce((sum, child) => sum + child.value.recordCount, 0),
            commit: () => undefined,
            discard: () => undefined,
          }),
          syncTransforms: () => undefined,
          dispose: () => undefined,
        },
      },
    );
    assert.equal(copy.result, 1, 'only the selected glyph must be realized');
    assert.deepEqual(source.inspect().glyphIds, original.glyphIds);
    glyph.shape();
    assert.deepEqual(source.inspect().glyphIds, original.glyphIds);
  } finally {
    copy?.dispose();
    sibling?.dispose();
    source.dispose();
    root.dispose();
  }
});

test('copy rejects a sibling identity after speculative preparation is restarted', () => {
  const root = handle('removal-lifecycle:foreign-selection');
  const source = root.services.createText(textState(font, 'A', unconstrained));
  let sibling;
  try {
    const original = source.inspect();
    sibling = root.services.createText(textState(font, 'B', unconstrained));
    const foreign = sibling.inspect().glyphStableIds[0];
    assert.notEqual(foreign, original.glyphStableIds[0], 'an exposed identity must not be recycled');
    const destination = {
      boundary: {},
      renderer: {
        decode: () => ({ result: undefined, commit: () => undefined, discard: () => undefined }),
        syncTransforms: () => undefined,
        dispose: () => undefined,
      },
    };
    assert.throws(
      () => root.services.copy(source, { kind: 'glyphs', stableIds: [foreign + 1 + 2 ** 32] }, destination),
      RangeError,
      'identity refresh must not truncate caller-authored selections',
    );
    assert.throws(() => root.services.copy(source, { kind: 'glyphs', stableIds: [foreign] }, destination), {
      statusCode: 'invalid-request',
    });
    glyph.shape();
    assert.equal(source.inspect().glyphCount, 1);
  } finally {
    sibling?.dispose();
    source.dispose();
    root.dispose();
  }
});
