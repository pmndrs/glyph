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

import { GlyphIdScope, registeredGlyphIdCount } from '../../dist/internal/glyph-id.js';

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
  stableGlyphId: { id: id.buffer('test.lifecycle-churn/stable-glyph'), scalar: 'u32', lanes: ['stableGlyphId'] },
  placementSlot: { id: id.buffer('test.lifecycle-churn/placement-slot'), scalar: 'u32', lanes: ['placementSlot'] },
});
const MAX_PARAGRAPHS = 8;

/** A headless config with a small paragraph limit, so a leak of pending entries is reached in a few cycles. */
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
    commands: {
      limits: {
        maxParagraphs: MAX_PARAGRAPHS,
        maxClusters: 65_536,
        maxLines: 65_536,
        maxRegions: 65_536,
        maxExclusions: 65_536,
        maxInlineObjects: 65_536,
        maxSlotsPerBand: 32,
        maxOutputBytes: 64 * 1024 * 1024,
      },
    },
    encode: ({ ids }) => ({
      descriptor: {
        capabilitySets: [capabilitySet],
        programs: [
          createRasterCodecProgram(msdfCodec, {
            namespace: 'lifecycle-churn-test',
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

function textState(font, text) {
  return {
    font,
    transform: { paragraph: true },
    style: { fontSize: 16, lineHeight: 1.5, letterSpacing: 0, color: [0, 0, 0, 1] },
    layout: { wrap: 'none', align: 'start', overflow: 'visible' },
    constraints: { width: { mode: 'exact', size: 120 }, height: { mode: 'unconstrained' } },
    text,
  };
}

let handle;
let face;
let font;

before(async () => {
  await glyph.init();
  handle = glyph.handle('test:lifecycle-churn', defineHeadlessConfig());
  face = glyph.fontFace(new Blob([gunzipSync(await readFile(fontUrl))], { type: 'model/gltf-binary' }), {
    family: 'LifecycleChurn',
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

/** One generation of labels replaced by the next, read but never published, the way a hidden UI churns. */
function churnUnpublished(root, generations, labelsPerGeneration) {
  let labels = [];
  for (let generation = 0; generation < generations; generation++) {
    for (const label of labels) label.dispose();
    labels = Array.from({ length: labelsPerGeneration }, (_, index) =>
      root.services.createText(textState(font, `label ${generation}.${index}`)),
    );
    for (const label of labels) assert.ok(label.measure().lineCount >= 1);
  }
  for (const label of labels) label.dispose();
}

test('disposing measured texts that were never published releases their pending entries', () => {
  const root = handle('lifecycle-churn:pending');
  try {
    // A published generation first, so the churn also runs beside a removal that waits for a publication.
    const published = Array.from({ length: MAX_PARAGRAPHS / 2 }, (_, index) =>
      root.services.createText(textState(font, `published ${index}`)),
    );
    glyph.shape();
    for (const label of published) label.dispose();
    churnUnpublished(root, 4 * MAX_PARAGRAPHS, MAX_PARAGRAPHS / 2);
    glyph.shape();
  } finally {
    root.dispose();
  }
});

test('disposing an unprepared text releases its pending entry', () => {
  const root = handle('lifecycle-churn:unprepared');
  try {
    for (let cycle = 0; cycle < 4 * MAX_PARAGRAPHS; cycle++) {
      root.services.createText(textState(font, `unprepared ${cycle}`)).dispose();
    }
    glyph.shape();
  } finally {
    root.dispose();
  }
});

test('100k text create and dispose cycles keep the glyph ID registry bounded', () => {
  const root = handle('lifecycle-churn:ids');
  try {
    churnUnpublished(root, 2, MAX_PARAGRAPHS);
    glyph.shape();
    const settled = registeredGlyphIdCount();
    const cycles = 100_000;
    const labelsPerGeneration = MAX_PARAGRAPHS / 2;
    let peak = settled;
    for (let generation = 0; generation < cycles / labelsPerGeneration; generation++) {
      churnUnpublished(root, 1, labelsPerGeneration);
      // Every hundredth generation is also published, so retirement through publication is exercised too.
      if (generation % 100 === 0) {
        const shown = root.services.createText(textState(font, `shown ${generation}`));
        glyph.shape();
        shown.dispose();
        glyph.shape();
      }
      peak = Math.max(peak, registeredGlyphIdCount());
    }
    // The last generation's removals wait for an engine request; this publication carries them.
    glyph.shape();
    assert.equal(registeredGlyphIdCount(), settled, 'every disposed text returns its IDs');
    assert.ok(peak - settled <= 16 * MAX_PARAGRAPHS, `registry grew by ${peak - settled} during the churn`);
  } finally {
    root.dispose();
  }
});

test('two names whose hashes collide receive distinct, stable IDs', () => {
  // FNV-1a maps both canonical names to one 32-bit value; the Labs churn met this pair at iteration 29.
  const first = 'paragraph/1077174259/column/0';
  const second = 'paragraph/2378884470/column/0';
  const scope = new GlyphIdScope();
  const other = new GlyphIdScope();
  try {
    const a = scope.id('region', first);
    const b = scope.id('region', second);
    assert.notEqual(a, b);
    assert.equal(scope.id('region', first), a);
    assert.equal(scope.id('region', second), b);
    assert.equal(other.id('region', second), b, 'another scope resolves the same name to the same ID');
    scope.release(a, 'region');
    assert.equal(scope.id('region', second), b, 'releasing the colliding name keeps the other one');
    assert.equal(scope.id('region', first), a, 'a released name hashes to its free home slot again');
  } finally {
    scope.dispose();
    other.dispose();
  }
});
