import {
  type TextEngineBufferRecord,
  type TextEngineDrawRecord,
  type TextEnginePatchRecord,
  type TextEnginePrimitiveRecord,
  type TextEngineResourceRecord,
  type TextEngineRetirementRecord,
} from '@pmndrs/glyph/core';

import type { ExampleTableSnapshot } from './snapshot.js';

/** One portable resource lifecycle row decoded from a render plan. */
export type ExampleResourceRecord = TextEngineResourceRecord;
/** One renderer-neutral geometry row decoded from a render plan. */
export type ExamplePrimitiveRecord = TextEnginePrimitiveRecord;

/** One draw the engine wants issued, decoded from the plan's `draws` table. */
export type ExampleDraw = TextEngineDrawRecord;

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
