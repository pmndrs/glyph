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
    instance: () => ({}),
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
    renderer: () => ({
      decode: () => ({ result: undefined, commit: () => undefined, discard: () => undefined }),
      syncTransforms: () => undefined,
      dispose: () => undefined,
    }),
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
