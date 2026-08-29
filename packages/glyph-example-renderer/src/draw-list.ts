import {
  type RenderPlanBufferRecord,
  type RenderPlanDrawRecord,
  type RenderPlanPatchRecord,
  type RenderPlanPrimitiveRecord,
  type RenderPlanResourceRecord,
  type RenderPlanRetirementRecord,
} from '@pmndrs/glyph/core';

import type { ExampleTableSnapshot } from './snapshot.js';

/** One portable resource lifecycle row decoded from a render plan. */
export type ExampleResourceRecord = RenderPlanResourceRecord;
/** One renderer-neutral geometry row decoded from a render plan. */
export type ExamplePrimitiveRecord = RenderPlanPrimitiveRecord;

/** One draw the engine wants issued, decoded from the plan's `draws` table. */
export type ExampleDraw = RenderPlanDrawRecord;

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
  readonly bufferRecords: readonly RenderPlanBufferRecord[];
  readonly primitiveRecords: readonly ExamplePrimitiveRecord[];
  /** Dirty ranges: what changed on which renderer buffer, not whole arrays. */
  readonly patches: readonly RenderPlanPatchRecord[];
  /**
   * Storage to release, each naming `(kind, id, generation)` and the acknowledged
   * publication generation that makes release safe.
   */
  readonly retirements: readonly RenderPlanRetirementRecord[];
  readonly resources: ExampleTableSnapshot;
  readonly buffers: ExampleTableSnapshot;
  readonly primitives: ExampleTableSnapshot;
  readonly diagnostics: ExampleTableSnapshot;
}
