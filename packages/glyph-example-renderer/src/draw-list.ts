import {
  textShaperAbi,
  type TextEnginePatchRecord,
  type TextEngineRenderPlanView,
  type TextEngineRetirementRecord,
} from '@pmndrs/glyph/core';

import type { ExampleTableSnapshot } from './snapshot.js';

const drawLayout = textShaperAbi.layouts.engineDraw;

/** One draw the engine wants issued, decoded from the plan's `draws` table. */
export interface ExampleDraw {
  readonly id: number;
  readonly programId: number;
  readonly programVariant: number;
  readonly flags: number;
  readonly materialId: number;
  /** Scissor or clip group the host applies. A UI host maps this onto its own clip rects. */
  readonly clipId: number;
  readonly depthKey: number;
  readonly transformId: number;
  readonly primitiveStart: number;
  readonly primitiveCount: number;
  readonly bufferStart: number;
  readonly bufferCount: number;
  readonly resourceStart: number;
  readonly resourceCount: number;
  /** Stable sort key for correct transparency order across every draw in a publication. */
  readonly orderToken: number;
  readonly indirectBufferId: number;
  readonly indirectOffset: number;
}

/**
 * One frame's render plan, safe to hold forever.
 *
 * Ownership comes from `TextEngineSession.retain`, which copies the whole encoded
 * result once and brands it; every field here is either a decode of that copy or a
 * view into it, and nothing aliases the engine's Wasm memory.
 */
export interface ExampleDrawList {
  readonly engineRevision: number;
  readonly planRevision: number;
  readonly publicationGeneration: number;
  readonly draws: readonly ExampleDraw[];
  /** Dirty ranges: what changed on which retained buffer, not whole arrays. */
  readonly patches: readonly TextEnginePatchRecord[];
  /**
   * Storage to release, each naming `(kind, id, generation)` and the acknowledged
   * publication generation that makes release safe.
   */
  readonly retirements: readonly TextEngineRetirementRecord[];
  readonly resources: ExampleTableSnapshot;
  readonly buffers: ExampleTableSnapshot;
  readonly primitives: ExampleTableSnapshot;
  readonly diagnostics: ExampleTableSnapshot;
}

/** Decode one row of the `draws` table. */
export function decodeDraw(view: TextEngineRenderPlanView, offset: number): ExampleDraw {
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
