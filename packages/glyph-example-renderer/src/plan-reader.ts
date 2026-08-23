import { TextEngineRenderPlanView, textShaperAbi, type TextEnginePublication } from '@pmndrs/glyph/core';

import type { ExampleDraw, ExampleDrawList, ExampleTableSnapshot } from './draw-list.js';

const drawLayout = textShaperAbi.layouts.engineDraw;

/** Copies one table's records into host-owned bytes. */
function snapshot(
  view: TextEngineRenderPlanView,
  name: 'resources' | 'buffers' | 'patches' | 'primitives' | 'retirements' | 'diagnostics',
): ExampleTableSnapshot {
  const table = view.table(name);
  const byteLength = table.count * table.stride;
  const records = byteLength === 0 ? new Uint8Array(0) : view.bytes(table.offset, byteLength).slice();
  return { count: table.count, stride: table.stride, records };
}

function decodeDraw(view: TextEngineRenderPlanView, offset: number): ExampleDraw {
  return {
    id: view.u32(offset + drawLayout.id),
    programId: view.u32(offset + drawLayout.programId),
    programVariant: view.u16(offset + drawLayout.programVariant),
    flags: view.u16(offset + drawLayout.flags),
    materialId: view.u32(offset + drawLayout.materialId),
    clipId: view.u32(offset + drawLayout.clipId),
    depthKey: view.u32(offset + drawLayout.depthKey),
    transformId: view.u32(offset + drawLayout.transformId),
    primitiveStart: view.u32(offset + drawLayout.primitiveStart),
    primitiveCount: view.u32(offset + drawLayout.primitiveCount),
    bufferStart: view.u32(offset + drawLayout.bufferStart),
    bufferCount: view.u32(offset + drawLayout.bufferCount),
    resourceStart: view.u32(offset + drawLayout.resourceStart),
    resourceCount: view.u32(offset + drawLayout.resourceCount),
    orderToken: view.u32(offset + drawLayout.orderToken),
    indirectBufferId: view.u32(offset + drawLayout.indirectBufferId),
    indirectOffset: view.u32(offset + drawLayout.indirectOffset),
  };
}

/**
 * Reads one borrowed publication into host-owned memory.
 *
 * The engine's bytes expire at the next Wasm call, so a retained host must copy before
 * it does anything else. `readDrawList` is that copy, written once here so the cost and
 * the hazard are visible rather than folded into a renderer.
 */
export function readDrawList(
  publication: TextEnginePublication,
  view: TextEngineRenderPlanView = new TextEngineRenderPlanView(),
): ExampleDrawList {
  view.bind(publication);
  const draws = view.table('draws');
  const decoded: ExampleDraw[] = [];
  for (let index = 0; index < draws.count; index += 1) decoded.push(decodeDraw(view, view.record(draws, index)));
  return {
    engineRevision: publication.engineRevision,
    planRevision: publication.planRevision,
    publicationGeneration: publication.publicationGeneration,
    draws: decoded,
    resources: snapshot(view, 'resources'),
    buffers: snapshot(view, 'buffers'),
    patches: snapshot(view, 'patches'),
    primitives: snapshot(view, 'primitives'),
    retirements: snapshot(view, 'retirements'),
    diagnostics: snapshot(view, 'diagnostics'),
  };
}
