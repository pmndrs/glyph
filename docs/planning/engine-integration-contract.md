---
type: API Reference
title: Engine integration contract
description: Exact storage, batching, ordering, transform, publication, and lifetime boundary between core text preparation and an engine renderer.
documentation_type: reference
tags: [api, engine, rendering, batching, storage, revisions]
status: stable
sources:
  - id: core-api
    resource: core-api.md
    title: Canonical core text API
  - id: current-layout
    resource: ../../packages/text/src/layout.ts
    title: Current paragraph layout contract
  - id: current-paint
    resource: ../../packages/text/src/paint.ts
    title: Current glyph paint contract
  - id: current-raster
    resource: ../../packages/text/src/raster.ts
    title: Current raster transaction contract
  - id: current-text
    resource: ../../packages/text/src/text.ts
    title: Current Three.js text lifecycle
  - id: extraction-plan
    resource: engine-integration-boundary.md
    title: Renderer-neutral extraction plan
  - id: three-api
    resource: three-api.md
    title: Three.js text API
generated:
  by: openai-codex/gpt-5.6
  at: '2026-08-06T16:07:26Z'
---

# Engine integration contract

An engine integration receives already partitioned glyph storage and an ordered submission plan.

This is the low-level contract implemented privately by the [Three.js API](three-api.md). Three users do not receive or
stage these values directly; `FontLoader`, `TextGroup`, and `Text` own the corresponding core objects and target lifecycle.

```ts
type EngineInput<Technique extends AnyRasterTechnique> = PreparedParagraphBatchRevision<Technique>;
```

It must not shape text, resolve fallback, lay out lines, regroup glyphs by resource, sort paragraphs, allocate core slots,
or reinterpret submission order.

## Attach to one paragraph batch

```ts
interface ParagraphBatch<Technique extends AnyRasterTechnique> {
  readonly current: PreparedParagraphBatchRevision<Technique>;

  attach<TargetRevision extends ParagraphBatchTargetRevision>(
    target: ParagraphBatchTarget<Technique, TargetRevision>,
  ): ParagraphBatchAttachment<TargetRevision>;
}
```

One attachment represents one engine's resources for one intentional paragraph render phase. A paragraph batch may be
attached to more than one target. They share core's canonical CPU arrays while each target owns its engine-specific buffers
and GPU lifetime.

```ts
interface ParagraphBatchAttachment<TargetRevision extends ParagraphBatchTargetRevision> {
  readonly current: TargetRevision | undefined;
  readonly candidate: ParagraphBatchTargetStage<TargetRevision> | undefined;

  commit(): TargetRevision | undefined;
  dispose(): void;
}
```

Targets may attach before or after the first update. Attaching later stages the current prepared storage and submission
plan without reshaping.

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

An integration whose buffers have the same layout can synchronize exact ranges directly:

```ts
for (const range of batch.dirtyRanges) {
  gpuOrigins.upload(batch.storage.origins, range);
  gpuFontSizes.upload(batch.storage.fontSizes, range);
  gpuGlyphRecords.upload(batch.storage.glyphRecords, range);
  gpuPaintIndices.upload(batch.storage.paintIndices, range);
}
```

An integration with interleaved or otherwise different engine storage maps only the dirty ranges:

```ts
for (const range of batch.dirtyRanges) {
  mapMtsdfRangeToInterleavedEngineBuffer(batch.storage, engineBuffer, range);
}
```

This mapping is an engine-layout synchronization step, not text batching. The integration does not inspect paragraph glyphs
to choose resources, slots, order, or draw boundaries.

## Retain canonical CPU state

Core retains enough state to reshape, reflow, rebuild a target, and address stable instance slots:

```ts
interface CoreRetainedParagraphState {
  readonly input: ParagraphProperties<AnyRasterTechnique>;
  readonly layout: ParagraphLayout;
  readonly allocations: GlyphAllocationTable;
  readonly shapedOrigins: GlyphOrigins;
  readonly originOverrides?: GlyphOriginOverrides;
}
```

Core's canonical arrays are the CPU shadow of renderable instance state. Targets own any engine-specific CPU staging or GPU
copies. This separation lets core publish independently of inaccessible or in-flight GPU memory and lets several targets
consume the same prepared revision.

## Read one prepared paragraph batch

```ts
interface PreparedParagraphBatchRevision<Technique extends AnyRasterTechnique> {
  /** Stable author-declared render-phase identity. */
  readonly paragraphBatch: ParagraphBatch<Technique>;

  /** Monotonic within this paragraph batch. */
  readonly revision: number;

  /** Every font in this revision uses this technique. */
  readonly technique: Technique;

  /** Sorted authoring and layout views for inspection, measurement, and transforms. */
  readonly paragraphs: readonly PreparedParagraph[];

  /** Resource-compatible instance storage populated by core. */
  readonly glyphBatches: readonly PreparedGlyphBatch<Technique>[];

  /** Ordered ranges the target must submit. */
  readonly submissions: readonly GlyphSubmission[];

  readonly delta: PreparedParagraphBatchDelta;
}
```

```ts
interface PreparedParagraph {
  readonly paragraph: Paragraph<AnyRasterTechnique>;
  readonly insertionOrder: number;
  readonly order: number;
  readonly topology: number;
  readonly layout: ParagraphLayout;
  readonly paint: GlyphPaint;
  readonly fontSlots: readonly PreparedFontSlot[];
  readonly origins: PreparedGlyphOrigins;
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
  readonly chunk: number;
  readonly capacity: number;
  readonly instanceCount: number;
  readonly storage: GlyphBatchStorageOf<Technique>;
  readonly dirtyRanges: readonly GlyphRange[];
}
```

```ts
interface GlyphBatchKey {
  readonly technique: RasterTechniqueId;
  readonly fontResource: FontResourceId;
  readonly pipelineVariant: number;
  readonly chunk: number;
}

interface GlyphRange {
  readonly start: number;
  readonly count: number;
}
```

One key represents compatible GPU storage, not necessarily one submit. Capacity overflow creates another `chunk` instead
of reallocating an existing fixed chunk. Grow mode may replace storage with a larger capacity. Error mode preserves the
prior revision and reports capacity failure.

Different techniques can never appear in one `PreparedParagraphBatchRevision`. Different font resources normally produce
different `GlyphBatchKey` values even when they use the same technique. A technique may opt two fonts into one key only if
it actually creates a shared GPU resource capable of addressing both.

## Execute the ordered submission plan

```ts
interface GlyphSubmission {
  readonly batch: GlyphBatchKey;
  readonly start: number;
  readonly count: number;
  readonly order: number;
}
```

Core sorts paragraphs by ascending finite `paragraph.order`, then stable insertion order, and preserves the technique's
required glyph compositing order. It segments the resulting sequence whenever the resource key changes.

```ts
// Resolved font sequence: Inter -> Noto -> Inter
revision.submissions = [
  { batch: interBatch.key, start: 0, count: 8, order: 0 },
  { batch: notoBatch.key, start: 0, count: 3, order: 1 },
  { batch: interBatch.key, start: 8, count: 5, order: 2 },
];
```

The target may reuse one bound buffer for multiple submissions, but it cannot merge or reorder ranges unless its documented
depth/compositing policy proves the result equivalent.

The application creates separate paragraph batches when another engine draw must occur between text phases:

```ts
drawWorld();
drawParagraphBatch(worldTextAttachment);
drawParticles();
drawParagraphBatch(overlayTextAttachment);
drawUi();
```

Core never composes separate paragraph batches with non-text scene objects.

## Upload without regrouping

```ts
function stageRevision(revision: PreparedParagraphBatchRevision<MyTechnique>) {
  for (const batch of revision.glyphBatches) {
    const gpu = ensureGpuBatch(batch.key, batch.font, batch.capacity, batch.storage);

    for (const range of batch.dirtyRanges) {
      gpu.upload(range);
    }

    gpu.setCount(batch.instanceCount);
  }

  return revision.submissions;
}
```

An integration that loops through every paragraph glyph to choose a resource or sort key is violating this contract.

## Compose paragraph transforms

Core positions glyphs in paragraph-local space. The engine owns the transform for each paragraph handle.

```ts
for (const prepared of revision.paragraphs) {
  const matrix = engine.transformFor(prepared.paragraph);
  target.updateParagraphTransform(prepared.paragraph, matrix);
}
```

The target may repeat a matrix per glyph, use one transform index per instance, store a transform table, or create separate
draws. Core does not shape a 3D transform. A transform change does not require reshaping unless an integration deliberately
feeds a transformed content constraint back into the paragraph API.

## Stage and commit safely

```ts
interface ParagraphBatchTarget<
  Technique extends AnyRasterTechnique,
  TargetRevision extends ParagraphBatchTargetRevision,
> {
  readonly technique: Technique;

  stage(
    previous: TargetRevision | undefined,
    next: PreparedParagraphBatchRevision<Technique>,
    options?: { readonly signal?: AbortSignal },
  ): ParagraphBatchTargetUpdate<TargetRevision>;

  dispose(): void;
}

interface ParagraphBatchTargetRevision {
  readonly sourceRevision: number;
  readonly submissions: readonly GlyphSubmission[];
  dispose(): void;
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

```ts
function beforeRender() {
  const next = attachment.commit();
  if (next !== undefined) live = next;

  for (const submission of live?.submissions ?? []) {
    draw(submission.batch, submission.start, submission.count);
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
  readonly instanceSlotAllocation: true;
  readonly capacityChunking: true;
  readonly techniqueInstancePacking: true;
  readonly dirtyRanges: true;
  readonly glyphSubmissionOrder: true;
}

interface EngineOwns {
  readonly paragraphTransforms: true;
  readonly visibilityAndCulling: true;
  readonly sceneComposition: true;
  readonly gpuResources: true;
  readonly renderPassPlacement: true;
  readonly commandEncoding: true;
  readonly framePublication: true;
  readonly fencesAndRetirement: true;
}
```

## Failure contract

```ts
type CoreUpdateFailure =
  | 'invalid-paragraph-input'
  | 'font-outside-group'
  | 'mixed-technique-font-stack'
  | 'capacity-exceeded'
  | 'preparation-failed'
  | 'aborted'
  | 'superseded';

type TargetFailure =
  | 'unsupported-technique'
  | 'unsupported-instance-schema'
  | 'gpu-resource-failed'
  | 'engine-limit-exceeded'
  | 'allocation-failed'
  | 'aborted'
  | 'superseded';
```

Core failure leaves the prior runtime and paragraph-batch revisions current. Target failure leaves the prior target revision
live. Neither boundary exposes a partially prepared generation.

## Integration checklist

```ts
const IntegrationMust = {
  acceptOneTechniquePerParagraphBatch: true,
  synchronizeCanonicalDirtyRanges: true,
  uploadOnlyCoreReportedDirtyRanges: true,
  executeCoreSubmissionOrder: true,
  resolveTransformsFromParagraphHandles: true,
  stageBeforeMutatingLiveResources: true,
  commitAtASafeFrameBoundary: true,
  retireAfterGpuCompletion: true,
  avoidGlyphRegroupingAndResorting: true,
} as const;
```
