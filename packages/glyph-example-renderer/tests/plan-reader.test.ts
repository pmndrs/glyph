import { textShaperAbi, type TextEnginePublication } from '@pmndrs/glyph/core';
import { describe, expect, test } from 'vitest';

import { readDrawList } from '../src/plan-reader.js';

const result = textShaperAbi.layouts.engineResult;
const draw = textShaperAbi.layouts.engineDraw;

/** Every table the plan carries, so the ownership proof covers more than the draw table. */
const TABLES = [
  {
    name: 'resources',
    record: textShaperAbi.layouts.engineResource,
    offset: result.resourcesOffset,
    count: result.resourceCount,
  },
  {
    name: 'buffers',
    record: textShaperAbi.layouts.engineBuffer,
    offset: result.buffersOffset,
    count: result.bufferCount,
  },
  {
    name: 'patches',
    record: textShaperAbi.layouts.enginePatch,
    offset: result.patchesOffset,
    count: result.patchCount,
  },
  {
    name: 'primitives',
    record: textShaperAbi.layouts.enginePrimitive,
    offset: result.primitivesOffset,
    count: result.primitiveCount,
  },
  { name: 'draws', record: draw, offset: result.drawsOffset, count: result.drawCount },
  {
    name: 'retirements',
    record: textShaperAbi.layouts.engineRetirement,
    offset: result.retirementsOffset,
    count: result.retirementCount,
  },
  {
    name: 'diagnostics',
    record: textShaperAbi.layouts.engineDiagnostic,
    offset: result.diagnosticsOffset,
    count: result.diagnosticCount,
  },
] as const;

const align = (value: number, to: number) => Math.ceil(value / to) * to;

/**
 * Builds a publication shaped like the engine's, with EVERY table populated.
 *
 * An all-empty publication would let the ownership assertions pass over zero-length arrays and prove
 * nothing, so each table carries records whose bytes are distinguishable from zero.
 */
function publication(rows: number): TextEnginePublication {
  const placed = TABLES.map((table) => ({ ...table, at: 0 }));
  let cursor: number = result.size;
  for (const table of placed) {
    cursor = align(cursor, table.record.alignment);
    table.at = cursor;
    cursor += rows * table.record.size;
  }
  const memoryBuffer = new ArrayBuffer(cursor);
  const view = new DataView(memoryBuffer);
  const bytes = new Uint8Array(memoryBuffer);
  view.setUint32(result.byteLength, cursor, true);
  for (const table of placed) {
    view.setUint32(table.offset, table.at, true);
    view.setUint32(table.count, rows, true);
    bytes.fill(0xa5, table.at, table.at + rows * table.record.size);
  }
  for (let index = 0; index < rows; index += 1) {
    const record = placed.find((entry) => entry.name === 'draws')!.at + index * draw.size;
    view.setUint32(record + draw.id, 100 + index, true);
    view.setUint32(record + draw.clipId, 7, true);
    view.setUint32(record + draw.orderToken, 900 - index, true);
    view.setUint32(record + draw.indirectBufferId, 42, true);
    view.setUint16(record + draw.programVariant, 3, true);
  }
  return {
    bytes,
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
    primitiveCount: rows,
    patchCount: rows,
    drawCount: rows,
  };
}

describe('render-plan reader', () => {
  test('decodes the draw table the engine published', () => {
    const list = readDrawList(publication(2));
    expect(list.draws.map((entry) => entry.id)).toEqual([100, 101]);
    expect(list.draws.map((entry) => entry.orderToken)).toEqual([900, 899]);
    expect(list.draws[0]!.clipId).toBe(7);
    expect(list.draws[0]!.programVariant).toBe(3);
    expect(list.draws[0]!.indirectBufferId).toBe(42);
    expect(list.planRevision).toBe(5);
  });

  test('owns every byte it returns, so a host may retain it across a Wasm call', () => {
    // A publication is valid only until the next Wasm call. A retained host that keeps a view into
    // engine memory reads freed or reallocated bytes on the next frame, so the reader must copy.
    // Every table is non-empty here: an empty one would satisfy these assertions vacuously.
    const source = publication(3);
    const list = readDrawList(source);
    const snapshots = [list.resources, list.buffers, list.patches, list.primitives, list.retirements, list.diagnostics];
    for (const table of snapshots) {
      expect(table.count).toBe(3);
      expect(table.records.byteLength).toBe(3 * table.stride);
      expect(table.records.buffer).not.toBe(source.memoryBuffer);
      expect(table.records.every((byte) => byte === 0xa5)).toBe(true);
    }
    new Uint8Array(source.memoryBuffer).fill(0xff);
    expect(list.draws[0]!.id).toBe(100);
    for (const table of snapshots) expect(table.records.every((byte) => byte === 0xa5)).toBe(true);
  });
});
