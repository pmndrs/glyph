import { textShaperAbi, type TextEnginePublication } from '@pmndrs/glyph/core';
import { describe, expect, test } from 'vitest';

import { readDrawList } from '../src/plan-reader.js';

const result = textShaperAbi.layouts.engineResult;
const draw = textShaperAbi.layouts.engineDraw;

/** Builds a publication shaped like the engine's, backed by a plain buffer. */
function publication(drawCount: number): TextEnginePublication {
  const tableOffset = Math.ceil(result.size / draw.alignment) * draw.alignment;
  const byteLength = tableOffset + drawCount * draw.size;
  const memoryBuffer = new ArrayBuffer(byteLength);
  const view = new DataView(memoryBuffer);
  view.setUint32(result.byteLength, byteLength, true);
  view.setUint32(result.drawsOffset, tableOffset, true);
  view.setUint32(result.drawCount, drawCount, true);
  for (let index = 0; index < drawCount; index += 1) {
    const record = tableOffset + index * draw.size;
    view.setUint32(record + draw.id, 100 + index, true);
    view.setUint32(record + draw.clipId, 7, true);
    view.setUint32(record + draw.orderToken, 900 - index, true);
    view.setUint16(record + draw.programVariant, 3, true);
  }
  return {
    bytes: new Uint8Array(memoryBuffer),
    memoryBuffer,
    memoryGrew: false,
    engineRevision: 4,
    planRevision: 5,
    requiredBaseRevision: 0,
    publicationGeneration: 6,
    outputSlot: 0,
    flags: 0,
    policyHandle: 0,
    capabilitySet: 0,
    semanticViewCount: 0,
    primitiveCount: 0,
    patchCount: 0,
    drawCount,
  };
}

describe('render-plan reader', () => {
  test('decodes the draw table the engine published', () => {
    const list = readDrawList(publication(2));
    expect(list.draws.map((entry) => entry.id)).toEqual([100, 101]);
    expect(list.draws.map((entry) => entry.orderToken)).toEqual([900, 899]);
    expect(list.draws[0]!.clipId).toBe(7);
    expect(list.draws[0]!.programVariant).toBe(3);
    expect(list.planRevision).toBe(5);
  });

  test('owns every byte it returns, so a host may retain it across a Wasm call', () => {
    // A publication is valid only until the next Wasm call. A retained host that keeps a
    // view into engine memory reads freed or reallocated bytes on the next frame, so the
    // reader must copy. This test is the standing proof that it does.
    const source = publication(1);
    const list = readDrawList(source);
    for (const table of [list.resources, list.buffers, list.patches, list.primitives, list.retirements, list.diagnostics]) {
      expect(table.records.buffer).not.toBe(source.memoryBuffer);
    }
    new Uint8Array(source.memoryBuffer).fill(0xff);
    expect(list.draws[0]!.id).toBe(100);
  });
});
