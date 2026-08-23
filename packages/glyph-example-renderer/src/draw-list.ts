/**
 * Device-neutral structures copied out of one borrowed render-plan publication.
 *
 * Every field here is owned by the caller. That is the point of this package: a
 * `TextEnginePublication` is valid only until the next Wasm call, so a retained host
 * cannot hold the engine's bytes across a frame. Copying is currently the host's
 * problem, and this module is what that problem looks like in practice.
 */

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

/** An owned copy of one plan table, kept opaque where this example does not decode it. */
export interface ExampleTableSnapshot {
  readonly count: number;
  readonly stride: number;
  /** Owned bytes. Never aliases the engine's Wasm memory. */
  readonly records: Uint8Array;
}

/** One publication, copied into host-owned memory and safe to retain across frames. */
export interface ExampleDrawList {
  readonly engineRevision: number;
  readonly planRevision: number;
  readonly publicationGeneration: number;
  readonly draws: readonly ExampleDraw[];
  readonly resources: ExampleTableSnapshot;
  readonly buffers: ExampleTableSnapshot;
  readonly patches: ExampleTableSnapshot;
  readonly primitives: ExampleTableSnapshot;
  readonly retirements: ExampleTableSnapshot;
  readonly diagnostics: ExampleTableSnapshot;
}
