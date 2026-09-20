import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { bitmap, glyph } from '@pmndrs/glyph';
import {
  bitmapCodec,
  createRasterCodecProgram,
  defineCodecBuffers,
  defineGlyphConfig,
  id,
  resourceLease,
} from '@pmndrs/glyph/core';

const fontUrl = new URL('../../../../benches/fixtures/rendering/inter-bitmap-16.font.glb', import.meta.url);
const bytes = await readFile(fontUrl);
await glyph.init();

const system = defineCodecBuffers({
  stableGlyphId: { id: id.buffer('test.indexed-program/stable-glyph'), scalar: 'u32', lanes: ['stableGlyphId'] },
  transformIndex: { id: id.buffer('test.indexed-program/transform-index'), scalar: 'u32', lanes: ['transformIndex'] },
  placementSlot: { id: id.buffer('test.indexed-program/placement-slot'), scalar: 'u32', lanes: ['placementSlot'] },
});
const directSystem = defineCodecBuffers({
  stableGlyphId: system.stableGlyphId,
  placementSlot: system.placementSlot,
});
// The bitmap technique publishes six schema buffers; each host system buffer adds one more per draw.
const BITMAP_TECHNIQUE_BUFFERS = 6;

function capabilitySet(maxBuffersPerDraw) {
  return Object.freeze({
    capabilities: Object.freeze(['alias-vec2', 'alias-vec4', 'ordered-direct']),
    maxBufferBytes: 16 * 1024 * 1024,
    updateAlignment: 4,
    coalesceGapBytes: 128,
    rangeCallPenaltyBytes: 256,
    maxBuffersPerDraw,
    maxResourcesPerDraw: 4,
    maxIndirectDraws: 0,
    fragmentationBudget: 8,
    wholeBufferThresholdBasisPoints: 7_500,
  });
}

function programOptions(transformMode, maxBuffersPerDraw, ids) {
  return {
    namespace: 'indexed-program-test',
    system: transformMode === 'indexed' ? system : directSystem,
    capabilitySet: capabilitySet(maxBuffersPerDraw),
    transformMode,
    ids,
  };
}

test('createRasterCodecProgram rejects a capability set that cannot bind every buffer of the assembled program', () => {
  const directBuffers = BITMAP_TECHNIQUE_BUFFERS + 2;
  assert.doesNotThrow(() => createRasterCodecProgram(bitmapCodec, programOptions('direct', directBuffers)));
  assert.throws(() => createRasterCodecProgram(bitmapCodec, programOptions('direct', directBuffers - 1)), {
    name: 'TypeError',
    message:
      /needs 8 buffers per draw \(6 technique buffers plus stableGlyphId, placementSlot\) but the capability set binds at most 7/,
  });
  assert.doesNotThrow(() => createRasterCodecProgram(bitmapCodec, programOptions('indexed', directBuffers + 1)));
  assert.throws(() => createRasterCodecProgram(bitmapCodec, programOptions('indexed', directBuffers)), {
    name: 'TypeError',
    message:
      /needs 9 buffers per draw \(6 technique buffers plus stableGlyphId, placementSlot, transformIndex\) but the capability set binds at most 8/,
  });
});

test('an indexed transform program built with createRasterCodecProgram publishes transform indices', async () => {
  const decodes = [];
  const config = defineGlyphConfig({
    schema: {
      program: () => ({}),
      buffer: (_batch, input) => input.declaration,
      material: () => ({}),
      transform: (_batch, transform, recordIndex) => ({ transform, recordIndex }),
      batch: (_batch, input) => ({ input }),
      instance: (_batch, input) => ({ input }),
      instanceSpan: () => ({}),
    },
    fonts: { default: 'bitmap', formats: { bitmap } },
    encode: ({ ids }) => {
      const options = programOptions('indexed', BITMAP_TECHNIQUE_BUFFERS + 3, ids);
      return {
        descriptor: {
          capabilitySets: [options.capabilitySet],
          programs: [createRasterCodecProgram(bitmapCodec, options)],
        },
      };
    },
    resolve: ({ payload }) => resourceLease({ payload }, () => undefined),
    renderer: () => ({
      decode: (view) => {
        // The borrowed display list expires with the decode call, so snapshot it here.
        const displayList = view.displayList.kind === 'replace' ? view.displayList.value : undefined;
        decodes.push({
          buffers: view.updates.buffers.map((update) => update.buffer),
          displayListKind: view.displayList.kind,
          transforms: Array.from(displayList?.transforms ?? [], (record) => ({
            recordIndex: record.recordIndex,
            value: record.value,
          })),
          children: Array.from(displayList?.children ?? [], (child) => ({
            buffers: Array.from(child.value.input.buffers),
          })),
        });
        return { result: undefined, commit: () => undefined, discard: () => undefined };
      },
      syncTransforms: () => undefined,
      dispose: () => undefined,
    }),
    root: {
      create: (context) =>
        context.create({ fonts: context.fonts, services: context.services }, { boundary: undefined }),
    },
  });
  const handle = glyph.handle('indexed-program', config);
  const face = glyph.fontFace(new Blob([bytes], { type: 'model/gltf-binary' }), {
    family: 'IndexedProgram',
    format: bitmap({ strikes: [16] }),
  });
  try {
    await face.load();
    const font = handle.fonts.acquire(face);
    const first = { name: 'first' };
    const second = { name: 'second' };
    const state = (text, transform) => ({
      font,
      text,
      transform,
      style: { fontSize: 16, lineHeight: 1.5 },
      layout: { wrap: 'word', align: 'start', overflow: 'visible' },
      constraints: { width: { mode: 'exact', size: 200 }, height: { mode: 'unconstrained' } },
    });
    const texts = [
      handle.services.createText(state('first', first)),
      handle.services.createText(state('second', second)),
    ];
    glyph.shape();
    try {
      assert.equal(decodes.length, 1);
      const [decode] = decodes;
      const transformIndexBuffers = decode.buffers.filter(
        (buffer) => buffer.kind === 'codec' && buffer.value.id === system.transformIndex.id,
      );
      assert.equal(transformIndexBuffers.length, 1);
      assert.equal(transformIndexBuffers[0].value.scalar, 'u32');
      assert.equal(decode.displayListKind, 'replace');
      assert.deepEqual(
        decode.transforms.map((record) => record.value.transform),
        [first, second],
      );
      assert.deepEqual(
        decode.transforms.map((record) => record.recordIndex),
        decode.transforms.map((record) => record.value.recordIndex),
      );
      assert.ok(decode.children.length > 0);
      for (const child of decode.children) {
        assert.ok(child.buffers.some((buffer) => buffer === transformIndexBuffers[0]));
      }
    } finally {
      for (const text of texts) text.dispose();
      font.dispose();
    }
  } finally {
    face.dispose();
    handle.dispose();
  }
});
