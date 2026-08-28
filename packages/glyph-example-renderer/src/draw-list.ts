import {
  textShaperAbi,
  type TextEngineBufferRecord,
  type TextEnginePatchRecord,
  type TextEngineRenderPlanReader,
  type TextEngineRetirementRecord,
} from '@pmndrs/glyph/core';

import type { ExampleTableSnapshot } from './snapshot.js';

const drawLayout = textShaperAbi.layouts.engineDraw;
const primitiveLayout = textShaperAbi.layouts.enginePrimitive;

export interface ExampleResourceRecord {
  readonly id: number;
  readonly generation: number;
  readonly techniqueId: number;
  readonly resourceKind: number;
  readonly referenceId: number;
  readonly action: number;
}

export interface ExamplePrimitiveRecord {
  readonly id: number;
  readonly techniqueId: number;
  readonly programId: number;
  readonly programVariant: number;
  readonly kind: number;
  readonly recordCount: number;
  readonly recordIndex: number;
  readonly resourceId: number;
  readonly resourceGeneration: number;
}

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
 * One decoded frame, safe to hold after target acceptance. Borrowed byte fields are copied
 * while the target callback is active; scalar records are decoded directly.
 */
export interface ExampleDrawList {
  readonly engineRevision: number;
  readonly planRevision: number;
  readonly publicationGeneration: number;
  readonly draws: readonly ExampleDraw[];
  readonly resourceRecords: readonly ExampleResourceRecord[];
  readonly bufferRecords: readonly TextEngineBufferRecord[];
  readonly primitiveRecords: readonly ExamplePrimitiveRecord[];
  /** Dirty ranges: what changed on which renderer buffer, not whole arrays. */
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
export function decodeDraw(view: TextEngineRenderPlanReader, offset: number): ExampleDraw {
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

/** Decode one primitive row without assigning meaning to its wire kind. */
export function decodePrimitive(view: TextEngineRenderPlanReader, offset: number): ExamplePrimitiveRecord {
  return {
    id: view.u32(offset + primitiveLayout.id),
    techniqueId: view.u32(offset + primitiveLayout.techniqueId),
    programId: view.u32(offset + primitiveLayout.programId),
    programVariant: view.u16(offset + primitiveLayout.programVariant),
    kind: view.u16(offset + primitiveLayout.kind),
    recordCount: view.u16(offset + primitiveLayout.recordCount),
    recordIndex: view.u32(offset + primitiveLayout.recordIndex),
    resourceId: view.u32(offset + primitiveLayout.resourceId),
    resourceGeneration: view.u32(offset + primitiveLayout.resourceGeneration),
  };
}
