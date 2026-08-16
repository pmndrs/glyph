---
type: API Reference
title: Engine integration contract
description: Exact storage, batching, ordering, transform, publication, and lifetime boundary between core text preparation and an engine renderer.
documentation_type: reference
tags: [api, engine, rendering, batching, storage, revisions]
status: deprecated
sources:
  - id: core-api
    resource: core-api.md
    title: Canonical core text API
  - id: raster-technique
    resource: raster-technique-api.md
    title: Raster technique and engine resource API
  - id: current-layout
    resource: ../../packages/glyph/src/layout.ts
    title: Current paragraph layout contract
  - id: current-paint
    resource: ../../packages/glyph/src/paint.ts
    title: Current glyph paint contract
  - id: current-raster
    resource: ../../packages/glyph/src/raster.ts
    title: Current raster transaction contract
  - id: current-text
    resource: ../../packages/glyph/src/three/text.ts
    title: Current Three.js text lifecycle
  - id: extraction-plan
    resource: engine-integration-boundary.md
    title: Renderer-neutral extraction plan
  - id: three-api
    resource: three-api.md
    title: Three.js text API
  - id: typegpu-api
    resource: typegpu-api.md
    title: TypeGPU raster programs and text engine
generated:
  by: openai-codex/gpt-5.6
  at: '2026-08-15T15:53:27Z'
---

> Historical design record. The Rust command buffer superseded the target preparation and TypeScript storage contract
> described below. Use [the current package reference](../packages/glyph.md) and
> [Rust layout-engine design](rust-layout-engine.md) for the blessed integration boundary.

# Engine integration contract

An engine integration receives already partitioned glyph storage and ordered, variant-bearing glyph runs.

This is the low-level contract implemented privately by the [Three.js API](three-api.md). Three users do not receive or
stage these values directly; `FontLoader`, `TextGroup`, and `Text` own the corresponding core objects and target lifecycle.

```ts
type EngineInput<Technique extends AnyRasterTechnique, Variant = undefined> = PreparedParagraphBatchRevision<
  Technique,
  Variant
>;
```

It must not shape text, resolve fallback, lay out lines, repartition glyphs by resource, sort paragraphs, or allocate core
slots. It must compile the ordered runs into engine draws, preserving order unless its documented compositing policy proves
another ordering equivalent.

## Attach to one paragraph batch

```ts
interface ParagraphBatch<Technique extends AnyRasterTechnique, Variant = undefined> {
  readonly current: PreparedParagraphBatchRevision<Technique, Variant>;

  subscribe(observer: ParagraphBatchObserver<Technique, Variant>): () => void;

  attach<TargetRevision extends ParagraphBatchTargetRevision>(
    target: ParagraphBatchTarget<Technique, Variant, TargetRevision>,
  ): ParagraphBatchAttachment<Technique, Variant, TargetRevision>;
}

interface ParagraphBatchObserver<Technique extends AnyRasterTechnique, Variant = undefined> {
  next(revision: PreparedParagraphBatchRevision<Technique, Variant>): void;
  complete(): void;
}
```

One attachment represents one engine's resources for one intentional paragraph render phase. A paragraph batch may be
attached to more than one target. They share core's canonical CPU arrays while each target owns its engine-specific buffers
and GPU lifetime.

```ts
interface ParagraphBatchAttachment<
  Technique extends AnyRasterTechnique,
  Variant,
  TargetRevision extends ParagraphBatchTargetRevision,
> {
  readonly source: PreparedParagraphBatchRevision<Technique, Variant>;
  readonly current: TargetRevision | undefined;
  readonly candidate: ParagraphBatchTargetStage<TargetRevision> | undefined;
  readonly error: ParagraphBatchTargetError | undefined;

  prepare(): void;
  commit(): TargetRevision | undefined;
  retry(): void;
  dispose(): void;
}

interface ParagraphBatchTargetError {
  readonly kind: 'target-failed';
  readonly sourceRevision: number;
  readonly cause: unknown;
}
```

Targets may attach before or after the first update. Attachment and later source publication update `source` synchronously,
but do not call `target.stage()`. The observing engine calls `prepare()` at its own render boundary; a late attachment then
prepares current storage and glyph runs without reshaping. Repeated `prepare()` calls are no-ops while the current source
revision is already staged, pending, or committed.

`attach()` is the standard lifecycle coordinator, not a privileged preparation operation. Its behavior can be implemented
entirely with `current`, `subscribe()`, and the target interfaces in this document: subscription synchronously records the
current revision, records every later publication, and completes when the batch is disposed. `prepare()` is the explicit
policy boundary that calls `target.stage(current, source)`. The method belongs on the
batch because that retained relationship terminates with the batch and technique compatibility can be rejected at the
call. An integration needing different publication policy may subscribe directly and build its own coordinator; it does
not receive access to private shaping or allocation state by doing so.

A synchronous throw from `target.stage()` during `prepare()` or rejection of its pending `ready` Promise becomes
`attachment.error`. It does
not roll back the published core revision, replace `attachment.current`, or escape through `attachment.commit()`. A later
success clears the error. Engine adapters decide how to surface that retained target failure to their own users.
`retry()` clears no live state and marks the current source revision eligible for one new attempt; the target is called by
the owner's next `prepare()`, never by `retry()` itself. It is a no-op while an attempt for that revision is already pending.

Ownership is one-way. Disposing an attachment releases only that target's staged/live engine resources; it does not dispose
the source paragraph batch, paragraphs, or fonts. Disposing the source `ParagraphBatch` invalidates every owned paragraph
handle and notifies every attachment to cancel staging and begin target retirement. GPU objects remain alive only as long
as required by the engine's in-flight-frame fences, but no disposed source can publish another target revision.

An integration must not transfer a core `Paragraph` handle between batches. An engine-level retained object such as
Three.js `Text` owns its desired-state snapshot independently, creates a new destination paragraph, and lets disposal remove
the source handle. This adapter ownership is what permits scene-object reuse without weakening core batch ownership.

For explicit capacity replacement, `ParagraphBatch.setCapacity(capacity)` changes the requested allocation without changing
the paragraph batch, any paragraph handle, or any attachment. Core may reuse semantic shaping and layout caches, stages new
canonical capacity-bound storage, and publishes it atomically while the source revision remains live. Existing attachments
record the replacement source. A failed resize preserves the live revision and every identity. Each engine stages the
replacement when that attachment's owner next calls `prepare()`.

## Consume canonical CPU storage

```ts
interface MtsdfGlyphBatchStorage {
  readonly origins: Float32Array;
  readonly fontSizes: Float32Array;
  readonly glyphRecords: Uint32Array;
  readonly paintIndices: Uint32Array;
}
```

Each technique defines one canonical structure-of-arrays storage contract. Core owns these arrays and updates them before
publishing the prepared revision.

An integration whose buffers have the same layout can synchronize an adjacent revision's exact ranges directly:

```ts
for (const range of batch.dirtyRanges) {
  gpuOrigins.upload(batch.storage.origins, range);
  gpuFontSizes.upload(batch.storage.fontSizes, range);
  gpuGlyphRecords.upload(batch.storage.glyphRecords, range);
  gpuPaintIndices.upload(batch.storage.paintIndices, range);
}
```

An integration with interleaved or otherwise different engine storage maps the same selected ranges:

```ts
for (const range of batch.dirtyRanges) {
  mapMtsdfRangeToInterleavedEngineBuffer(batch.storage, engineBuffer, range);
}
```

This mapping is an engine-layout synchronization step, not text batching. The integration does not inspect paragraph glyphs
to choose resources, slots, source order, or variant boundaries; it derives final draws from the provided runs.

## Retain canonical CPU state

Core retains enough state to reshape, reflow, rebuild a target, and address stable instance slots:

```ts
interface CoreRetainedParagraphState {
  readonly input: ParagraphProperties<AnyRasterTechnique>;
  readonly layout: ParagraphLayout;
  readonly allocationsByBatch: ReadonlyMap<GlyphBatchKey, readonly GlyphRange[]>;
  readonly shapedX: Float32Array;
  readonly shapedY: Float32Array;
  readonly overrideX?: Float32Array;
  readonly overrideY?: Float32Array;
}
```

Core's canonical arrays are the CPU shadow of renderable instance state. Targets own any engine-specific CPU staging or GPU
copies. This separation lets core publish independently of inaccessible or in-flight GPU memory and lets several targets
consume the same prepared revision.

## Read one prepared paragraph batch

```ts
interface PreparedParagraphBatchRevision<Technique extends AnyRasterTechnique, Variant = undefined> {
  /** Stable author-declared render-phase identity. */
  readonly paragraphBatch: ParagraphBatch<Technique, Variant>;

  /** Contiguous and monotonic within this paragraph batch. */
  readonly revision: number;

  /** Every font in this revision uses this technique. */
  readonly technique: Technique;

  /** Sorted authoring and layout views for inspection, measurement, and transforms. */
  readonly paragraphs: readonly PreparedParagraph[];

  /** Resource-compatible instance storage populated by core. */
  readonly glyphBatches: readonly PreparedGlyphBatch<Technique>[];

  /** Ordered core-authored ranges the target compiles into engine draws. */
  readonly glyphRuns: readonly PreparedGlyphRun<Variant>[];
}
```

```ts
interface PreparedParagraph {
  readonly paragraph: Paragraph<AnyRasterTechnique>;
  readonly insertionOrder: number;
  readonly order: number;
  readonly topology: GlyphTopology;
  readonly rasterPixelRatio: number;
  readonly layout: ParagraphLayout;
  readonly paint: PreparedGlyphPaint;
  readonly fontSlots: readonly PreparedFontSlot[];
  readonly origins: PreparedGlyphOrigins;
}

interface PreparedGlyphPaint {
  readonly paintIndices: Uint16Array;
  readonly palette: readonly PreparedLinearPaint[];
}

interface PreparedLinearPaint {
  readonly color: readonly [number, number, number, number];
  readonly outline?: { readonly color: readonly [number, number, number, number]; readonly width: number };
  readonly shadow?: {
    readonly color: readonly [number, number, number, number];
    readonly offset: readonly [number, number];
  };
}

interface PreparedGlyphOrigins {
  readonly shapedX: Float32Array;
  readonly shapedY: Float32Array;
  readonly displayedX: Float32Array;
  readonly displayedY: Float32Array;
}

interface PreparedFontSlot {
  readonly slot: number;
  readonly font: LoadedFont<AnyRasterTechnique>;
}
```

Paragraph-local coordinates originate at the content-box top-left. Positive X points right, positive Y points down,
clusters index UTF-16 code units, glyph IDs are local to their font slot, and paint values are linear RGBA.

## Read physical glyph batches

```ts
interface PreparedGlyphBatch<Technique extends AnyRasterTechnique> {
  readonly key: GlyphBatchKey;
  readonly technique: Technique;
  readonly font: LoadedFont<Technique>;
  readonly capacity: number;
  readonly instanceCount: number;
  readonly binding: RasterBindingOf<Technique>;
  readonly storage: GlyphBatchStorageOf<Technique>;
  readonly dirtyRanges: readonly GlyphRange[];
}
```

```ts
interface GlyphBatchKey {
  readonly technique: RasterTechniqueId;
  readonly resource: RasterResourceId;
  readonly pipelineVariant: number;
  readonly generation: number;
  readonly chunk: number;
}

interface GlyphRange {
  readonly start: number;
  readonly count: number;
}
```

`dirtyRanges` transforms the immediately preceding paragraph-batch revision into this revision. It is not a timeless
description of every live slot. If `previous?.sourceRevision === next.revision - 1`, a target uploads those deltas. If
`previous` is absent or names an older revision, the target initializes every live range referenced by `next.glyphRuns`.
It may coalesce overlapping or adjacent upload ranges for the same physical batch without changing glyph-run order. This
makes late attachment, a superseded pending stage, and recovery after a skipped revision correct without retaining a
private core change journal.

A paragraph-batch revision number increments only when that batch publishes changed prepared content. Runtime no-ops,
failed preparation, superseded candidates, and updates that publish only other batches do not advance it. Therefore numeric
adjacency means the target has the exact canonical predecessor required by `dirtyRanges`.

Published canonical arrays remain readable through the next paragraph-batch publication. `stage()` therefore consumes or
copies every selected CPU range synchronously before returning. A pending target update may await allocation, compilation,
queue completion, or another engine operation, but it must not retain a canonical typed-array view and read it later after
`stage()` returns. This keeps core's one canonical CPU shadow reusable without forcing immutable full-buffer snapshots.

`binding` is the technique-authored renderer-neutral selection of pages, tables, buffers, or other values from
`font.data`. The target uses it to realize GPU resources; it never re-derives resource selection from glyph IDs.

Core interns and freezes each `GlyphBatchKey` for the lifetime of its physical batch. The identical key object appears in
the prepared batch, every referencing run, and adjacent revisions until that physical batch retires, so targets may use it
as a `Map` key. Its branded technique/resource IDs and numeric pipeline/generation/chunk fields form the deterministic diagnostic
tuple; integrations never construct keys themselves.

`generation` is monotonic for replacement storage at the same technique/resource/pipeline/chunk position. A new overflow
chunk begins at generation zero; grow-mode replacement increments only the replaced chunk; an explicit capacity change
rebuilds all chunks and increments their generations. A retired key object and tuple never become live again.

One key represents compatible GPU storage, not necessarily one submit. Public capacity has only two settings: glyph-slot
`size` per physical resource buffer and `policy`. Explicit paragraph batches default to lazily allocated
`{ size: 4_096, policy: 'chunk' }`; standalone Three.js text defaults to `{ size: 256, policy: 'grow' }`. Paragraph handles
and metadata have no capacity limit.

Chunk overflow creates another fixed-size `chunk` instead of reallocating existing published storage. Grow mode
transactionally replaces a full buffer and doubles its capacity until the pending glyphs fit. Fixed mode treats `size` as
a hard per-buffer limit, preserves the prior revision, and reports typed `capacity-exceeded` failure after shaping reveals
the exact physical resource demand but before any target publication.

Different techniques can never appear in one `PreparedParagraphBatchRevision`. Different raster resources normally produce
different `GlyphBatchKey` values even when they use the same technique. One physical batch names exactly one `LoadedFont`;
its resource ID is runtime-unique for that font/resource selection. Targets may still share immutable GPU atlas/table
objects between physical batches when their technique binding proves the resource compatible, but core never hides several
font owners behind the singular `PreparedGlyphBatch.font` field.

## Compile ordered glyph runs into draws

```ts
interface PreparedGlyphRun<Variant = undefined> {
  readonly batch: GlyphBatchKey;
  readonly paragraph: ParagraphId;
  readonly renderVariant: Variant | undefined;
  readonly start: number;
  readonly count: number;
}
```

Array position is the only run-order value. Core sorts paragraphs by ascending finite `paragraph.order`, then stable
insertion order, and emits each paragraph's visual glyph sequence from shaping and layout. It resolves batch, paragraph,
and span variant inheritance, then segments the sequence
whenever its physical batch, paragraph, or effective variant changes.

```ts
// Resolved font sequence: Inter -> Noto -> Inter
revision.glyphRuns = [
  { batch: interBatch.key, paragraph: label.id, renderVariant: plain, start: 0, count: 8 },
  { batch: notoBatch.key, paragraph: label.id, renderVariant: warning, start: 0, count: 3 },
  { batch: interBatch.key, paragraph: label.id, renderVariant: plain, start: 8, count: 5 },
];
```

Every live glyph slot is named by exactly one run. Technique-internal multi-pass work expands inside the program's draw
compiler rather than duplicating a core run; all passes expanded from one run remain adjacent unless the program proves an
equivalent blend/depth ordering. The run list is not a one-run/one-draw prescription. The target may split a run or coalesce adjacent runs when its program
declares them compatible. A program that places variant parameters in indexed sidecar storage may render many variants in
one draw; a program whose variant changes material or pipeline state must split them. The target must preserve the provided
sequence unless its documented depth/compositing policy proves another order equivalent.

The application creates separate paragraph batches when another engine draw must occur between text phases:

```ts
drawWorld();
drawParagraphBatch(worldTextAttachment);
drawParticles();
drawParagraphBatch(overlayTextAttachment);
drawUi();
```

Core never composes separate paragraph batches with non-text scene objects.

## Upload without repartitioning glyph storage

```ts
function stageRevision(
  previous: MyTargetRevision | undefined,
  revision: PreparedParagraphBatchRevision<MyTechnique, MyVariant>,
) {
  for (const batch of revision.glyphBatches) {
    const gpu = ensureGpuBatch(batch.key, batch.font, batch.binding, batch.capacity, batch.storage);

    const ranges = rangesForTarget(batch, revision.glyphRuns, previous?.sourceRevision, revision.revision);
    for (const range of ranges) {
      gpu.upload(range);
    }

    gpu.setCount(batch.instanceCount);
  }

  return program.compileRuns(revision.glyphRuns, revision.glyphBatches);
}
```

`rangesForTarget` above names renderer policy, not another core operation: it selects `batch.dirtyRanges` for an adjacent
revision and otherwise selects that batch's ranges from `revision.glyphRuns`.

An integration that loops through every paragraph glyph to choose a resource or sort key is violating this contract.

## Compose paragraph transforms

Core positions glyphs in paragraph-local space. The engine owns the transform for each paragraph handle.

```ts
for (const prepared of revision.paragraphs) {
  const matrix = engine.transformFor(prepared.paragraph);
  target.updateParagraphTransform(prepared.paragraph, matrix);
}
```

An integration that needs a per-glyph transform index derives it without inspecting or repartitioning glyphs: scan
`revision.glyphRuns` in order and write the target-owned index for `run.paragraph` across `[run.start, run.start +
run.count)` in the storage selected by `run.batch`. Because every live slot appears in exactly one run, this is the complete
instance-to-paragraph mapping; it is target storage, not another core column.

The target may repeat a matrix per glyph, use one transform index per instance, store a transform table, or create separate
draws. Core does not shape a 3D transform. A transform change does not require reshaping unless an integration deliberately
feeds a transformed content constraint back into the paragraph API.

## Stage and commit safely

```ts
interface ParagraphBatchTarget<
  Technique extends AnyRasterTechnique,
  Variant,
  TargetRevision extends ParagraphBatchTargetRevision,
> {
  readonly technique: Technique;

  stage(
    previous: TargetRevision | undefined,
    next: PreparedParagraphBatchRevision<Technique, Variant>,
    options?: { readonly signal?: AbortSignal },
  ): ParagraphBatchTargetUpdate<TargetRevision>;

  dispose(): void;
}

interface ParagraphBatchTargetRevision {
  readonly sourceRevision: number;
  dispose(): void;
}

interface MyTargetRevision extends ParagraphBatchTargetRevision {
  readonly draws: readonly EngineDraw[];
}

type ParagraphBatchTargetUpdate<TargetRevision extends ParagraphBatchTargetRevision> =
  | {
      readonly status: 'ready';
      readonly stage: ParagraphBatchTargetStage<TargetRevision>;
    }
  | {
      readonly status: 'pending';
      readonly ready: Promise<ParagraphBatchTargetStage<TargetRevision>>;
      cancel(reason?: unknown): void;
    };

interface ParagraphBatchTargetStage<TargetRevision extends ParagraphBatchTargetRevision> {
  readonly sourceRevision: number;

  /** Synchronous and infallible after all fallible work has staged. */
  commit(): TargetRevision;

  /** Idempotently release an unpublished candidate. */
  abort(): void;
}
```

`stage()` may allocate, upload, and fail. It must not mutate the live target revision or storage used by an in-flight frame.
`commit()` only swaps staged ownership at the engine's safe frame boundary.

`previous` is always the attachment's committed target revision, never an unpublished candidate. When a newer source
revision arrives, the attachment only records it. On the owner's next `prepare()`, the coordinator cancels or aborts any
older candidate before staging the latest source. A stale pending result that resolves first is aborted and never becomes
committable. The full-range rule
above therefore covers every skipped candidate without replaying obsolete target work.

On commit, the attachment asks the prior target revision to retire only after the replacement is live; its `dispose()`
implementation may defer physical release until engine fences permit it. Disposing the attachment aborts its unpublished
candidate, retires its current target revision, and calls `target.dispose()` exactly once. Batch completion performs that
same idempotent attachment disposal path.

```ts
function beforeRender() {
  attachment.prepare();
  const next = attachment.commit();
  if (next !== undefined) live = next;

  for (const drawCall of live?.draws ?? []) {
    draw(drawCall);
  }
}
```

The target retires the previous revision only after the engine proves that no queued GPU work references it.

## Observe runtime synchronization

```ts
runtime.subscribe((runtimeRevision) => {
  for (const paragraphBatchRevision of runtimeRevision.paragraphBatches) {
    queueAttachedTargets(paragraphBatchRevision);
  }
});
```

One runtime update may change several paragraph batches. Subscribers observe all affected revisions together after shaping,
layout, partitioning, and instance writes succeed. They never observe half of a runtime synchronization.

A newer synchronous or asynchronous synchronization supersedes an unpublished asynchronous candidate. Targets must abort
stages derived from a superseded source revision.

## Ownership boundary

```ts
interface CoreOwns {
  readonly fontAndGlyphIdentity: true;
  readonly fallbackResolution: true;
  readonly unicodeShaping: true;
  readonly paragraphLayout: true;
  readonly paragraphOrdering: true;
  readonly resourcePartitioning: true;
  readonly rasterResourceBindings: true;
  readonly instanceSlotAllocation: true;
  readonly capacityChunking: true;
  readonly techniqueInstancePacking: true;
  readonly dirtyRanges: true;
  readonly orderedGlyphRuns: true;
  readonly resolvedRenderVariants: true;
}

interface EngineOwns {
  readonly paragraphTransforms: true;
  readonly visibilityAndCulling: true;
  readonly sceneComposition: true;
  readonly variantCompatibility: true;
  readonly finalDrawPlanning: true;
  readonly gpuResources: true;
  readonly renderPassPlacement: true;
  readonly commandEncoding: true;
  readonly framePublication: true;
  readonly fencesAndRetirement: true;
}
```

The portable technique decodes font raster data, selects each glyph's physical binding, and populates canonical instance
storage. The engine target realizes those bindings as textures, buffers, bind groups, pipelines, or materials. See the
[raster technique and engine resource API](raster-technique-api.md).

## Failure contract

```ts
type CoreMutationRejection = 'invalid-paragraph-input' | 'font-outside-group' | 'mixed-technique-font-stack';

type CorePreparationFailure = 'capacity-exceeded' | 'preparation-failed';

type CoreHandledOutcome = 'published' | 'aborted' | 'superseded';

type TargetFailure =
  | 'unsupported-technique'
  | 'unsupported-instance-schema'
  | 'gpu-resource-failed'
  | 'engine-limit-exceeded'
  | 'allocation-failed';
```

Mutation rejection leaves desired state unchanged. Core preparation failure leaves the prior runtime and paragraph-batch
revisions current. Target failure leaves the prior target revision live. Abortion and supersession are handled outcomes,
not failures. A core preparation failure latches the exact failed desired generation on its paragraph batch and excludes it
from later updates until relevant mutation or an explicit capacity resize, allowing other batches to publish without retry
churn. A target failure is retained only by that attachment; other targets remain independent, and `retry()` stages the
current source revision once without requiring another core publication. No boundary exposes a partially prepared
generation.

## Integration checklist

```ts
const IntegrationMust = {
  acceptOneTechniquePerParagraphBatch: true,
  consumeTechniqueAuthoredBindings: true,
  synchronizeAdjacentDirtyOrCurrentLiveRanges: true,
  executeCoreSubmissionOrder: true,
  resolveTransformsFromParagraphHandles: true,
  stageBeforeMutatingLiveResources: true,
  commitAtASafeFrameBoundary: true,
  retireAfterGpuCompletion: true,
  avoidGlyphRegroupingAndResorting: true,
} as const;
```
