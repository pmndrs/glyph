---
type: Implementation Plan
title: Renderer-neutral core and engine integration
description: Implementation and proof plan for technique-declared paragraph batches, ordered font stacks, synchronized updates, core-owned glyph batching, and thin engine targets.
documentation_type: explanation
tags: [planning, api, shaping, batching, threejs, typegpu, wayfare]
status: draft
sources:
  - id: core-api
    resource: core-api.md
    title: Canonical core text API
  - id: engine-contract
    resource: engine-integration-contract.md
    title: Engine integration contract
  - id: three-api
    resource: three-api.md
    title: Three.js text API
  - id: roadmap
    resource: ../roadmap/roadmap.md
    title: Canonical implementation order
  - id: decision-register
    resource: decision-register.md
    title: Architectural decisions
  - id: current-api
    resource: api-shapes.md
    title: Existing API migration fixture
  - id: wayfare
    resource: https://github.com/iwoplaza/wayfare
    title: Wayfare engine proof target
  - id: typegpu-shader-canvas
    resource: https://github.com/AlexJWayne/typegpu-shader-canvas
    title: Raw TypeGPU proof target
generated:
  by: openai-codex/gpt-5.6
  at: '2026-08-06T16:07:26Z'
---

# Renderer-neutral core and engine integration

## Outcome

Replace the current one-Three-object/one-paragraph ownership model with this pipeline:

```ts
LoadedFont[]
  -> Font | FontStack            // one logical font selection
  -> ParagraphBatch[]            // application-declared render phases
  -> Paragraph handles           // desired-state mutation
  -> TextRuntime.update*()       // one synchronization point
  -> PreparedGlyphBatch[]        // core partitions and packs
  -> GlyphSubmission[]           // core preserves draw order
  -> engine target               // storage, GPU upload, transform, submit
```

The [core API](core-api.md) is the public authority. The [engine contract](engine-integration-contract.md) is the exact
integration boundary. This document owns implementation order and proof.

## Settled invariants

```ts
const Invariants = {
  explicitBakeAndLoad: true,
  everyTextUnitIsAParagraph: true,
  fontStackMayResolveThroughMultipleFonts: true,
  paragraphBatchDeclaresOneTechnique: true,
  oneParagraphBatchIsOneIntentionalRenderPhase: true,
  oneParagraphBatchMayProduceManyGlyphBatchesAndSubmissions: true,
  paragraphHandlesOwnDesiredStateMutation: true,
  runtimeUpdateIsTheSynchronizationPoint: true,
  syncOrAsyncIsChosenPerUpdate: true,
  coreOwnsSortingPartitioningPackingAndDirtyRanges: true,
  coreRetainsCanonicalCpuInstanceStorage: true,
  targetsOwnTransformsGpuLifetimeAndSceneComposition: true,
} as const;
```

The following shapes are rejected:

```ts
const Rejected = {
  separatePublicParagraphEngine: true,
  labelsOrIconsAsDifferentTextKinds: true,
  runtimeWideSyncOrWorkerMode: true,
  editCallbackPassedToUpdate: true,
  fontStackContainingSeveralTechniques: true,
  logicalMixedTechniqueBatchRepartitionedByEveryRenderer: true,
  rendererOwnedGlyphSortingAndBatching: true,
  targetOwnedCanonicalGlyphStorage: true,
} as const;
```

## Why each public object exists

### `TextRuntime`

Owns loaded-font identity, the synchronous shaper, optional asynchronous executor, dirty paragraph registry, cross-batch
shape aggregation, revision numbers, supersession, and atomic publication.

```ts
paragraphA.text = nextA;
paragraphB.contentBox = nextB;
runtime.update();
```

Both paragraphs shape at one synchronization point even when they belong to different paragraph render phases.

### `FontStack`

Defines one immutable logical font selection. Its first concrete font is primary and later fonts resolve missing glyphs in
order. Every concrete font must use the same technique. A single `LoadedFont` already satisfies the same selection contract.

```ts
const uiFont = createFontStack(interMtsdf, notoMtsdf, amiriMtsdf);
```

Different font resources may still require different glyph buffers and submits. Core produces those divisions.

### `ParagraphBatch`

Declares where the application permits core to order and submit text together. It is not a promise of one draw.

```ts
const worldText = runtime.createParagraphBatch({ technique: mtsdf });
const overlayText = runtime.createParagraphBatch({ fonts });
```

Core does not merge these phases. The engine may place particles, meshes, post-processing, or UI work between them.

### `Paragraph`

Owns one desired text/layout/paint state and one stable identity. A multiline block, one-line label, and font-backed icon are
all paragraphs.

```ts
paragraph.text = nextText;
paragraph.contentBox = nextBox;
paragraph.paint = nextPaint;
```

Repeated setters before the next runtime update coalesce naturally.

### `PreparedGlyphBatch` and `GlyphSubmission`

These are the concrete rendering outputs. Core groups compatible glyph instances into stable storage and separately emits
the ordered ranges that must be drawn.

```ts
for (const batch of revision.glyphBatches) upload(batch.dirtyRanges);
for (const submission of revision.submissions) draw(submission);
```

## Ownership boundary

| Layer               | Owns                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Baking              | reduced font data, glyph records, technique artifacts, deterministic packaging                                      |
| Loading             | validation, decoding, registered font and technique identity                                                        |
| Text runtime        | dirty aggregation, sync/async scheduling, shaping calls, supersession, atomic publication                           |
| Font stack          | one immutable ordered missing-glyph policy over same-technique concrete fonts                                       |
| Paragraph batch     | declared technique, application render phase, capacity policy, paragraph order domain                               |
| Paragraph           | font selection, desired source, spans, content box, style, paint, order, glyph-origin overrides                     |
| Core batch compiler | fallback runs, layout, resource partitioning, stable slots, overflow chunks, canonical CPU instances, dirty ranges  |
| Technique           | instance schema, resource compatibility, instance writing, shader/data meaning                                      |
| Engine target       | engine buffers, dirty-range synchronization, transforms, visibility, pass placement, upload, submission, retirement |

## Current system versus target

| Current V1 behavior                                     | Target behavior                                                                                 |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `Text` combines paragraph, raster, and Three ownership  | Paragraph state and batch compilation live in core; Three is one target                         |
| Property changes can prepare one `Text` immediately     | Handle setters only mark desired state dirty                                                    |
| Async behavior follows object/runtime lifecycle         | Every synchronization chooses `update()` or `updateAsync()`                                     |
| One paragraph stages one raster-owned Three draw object | One paragraph batch produces resource-compatible glyph storage and an ordered multi-submit plan |
| Renderer raster modules decide glyph grouping           | Core and technique modules decide grouping and populate canonical CPU instance storage          |
| React/Three lifecycle defines publication boundaries    | Runtime revision and target stage/commit define publication independently of any engine         |
| Existing `Paragraph` is a separately callable subsystem | Paragraph implementation remains internal to the one retained handle API                        |

The migration must preserve shaping, layout, paint, raster validation, transactional failure, and disposal behavior while
moving Three-specific ownership behind the target boundary.

## Implementation sequence

### 1. Extract desired-state paragraphs

- Add stable `Paragraph` handles owned by a `ParagraphBatch`.
- Move public text, span, content-box, style, paint, order, and glyph-origin mutation onto handle setters.
- Treat nested option records as immutable replacement values.
- Track dirty handles once with channel bitsets; do not scan every paragraph.
- Coalesce add followed by dispose before synchronization to no work.

Proof:

```ts
paragraph.text = 'A';
paragraph.text = 'B';
paragraph.text = 'C';
runtime.update();

expect(shapeInputs).toEqual(['C']);
```

### 2. Implement fonts and same-technique font stacks

- Keep a single loaded font valid anywhere text accepts a font selection.
- Create immutable non-empty stacks whose first font is primary and later fonts resolve missing glyphs in order.
- Reject duplicate logical membership where ambiguous and any different technique identity.
- Require every paragraph to own a font selection and validate it against its batch's declared technique.
- Reuse the renderer-neutral `txt` and `span` composer for imperative literals and React nested-text flattening.
- Pass all changed paragraphs through Unicode analysis and batched shaping with font-slot identity intact.
- Prove missing glyph fallback across at least Latin, Arabic, and CJK cases.

Proof:

```ts
expect(() => createFontStack(interMtsdf, iconBitmap)).toThrow('mixed-technique-font-stack');
```

### 3. Implement runtime synchronization

- `update()` snapshots every current dirty handle and completes synchronously.
- `updateAsync()` snapshots the same state and uses the asynchronous executor.
- Implement Promise and callback overloads without constructing a Promise in callback form.
- Stream completed Worker results into unpublished staging storage with optional progress while retaining atomic publication.
- Return the current revision without allocation for a no-op synchronous update.
- Let a newer synchronization supersede an unpublished older asynchronous generation. Resolve supersession and
  cancellation as handled outcomes; reject only actual preparation failures.
- Publish every affected paragraph batch atomically or none of them.
- Keep writes after a snapshot dirty for the next synchronization.

Proof:

```ts
paragraph.text = 'A';
const old = runtime.updateAsync();
paragraph.text = 'B';
const current = runtime.update();

await expect(old).resolves.toMatchObject({ status: 'superseded' });
expect(currentParagraph(current).text).toBe('B');
```

### 4. Compile physical glyph batches in core

- Sort paragraphs by finite application order and stable insertion order.
- Resolve every glyph to one same-technique font resource.
- Allocate stable instance slots by technique/resource/pipeline variant/chunk.
- Support grow, chunk, and error overflow policies.
- Pack technique-specific instance attributes once.
- Compute coalesced dirty ranges per storage channel.
- Emit a submission list that preserves paragraph and technique compositing order across resource changes.
- Never make targets inspect glyphs to choose a batch.

Proof:

```ts
expect(resolveFonts('Inter -> Noto -> Inter')).toProduce({
  glyphBatches: ['Inter', 'Noto'],
  submissions: ['Inter[0..8]', 'Noto[0..3]', 'Inter[8..13]'],
});
```

### 5. Add canonical CPU instance storage

- Define one canonical structure-of-arrays instance contract per technique.
- Let core and the technique populate and retain those arrays.
- Report exact coalesced dirty ranges for every changed glyph batch.
- Let matching targets copy or upload ranges 1:1 and different engine layouts map only those ranges.
- Allow several targets and late attachment to consume the same prepared storage without reshaping.
- Prove targets never regroup, resort, or reinterpret submission boundaries while synchronizing their buffers.

### 6. Rebuild the Three.js public surface over hidden core objects

- Keep Three.js applications on `FontLoader`, `TextGroup`, and transform-bearing `Text`; never expose a core runtime,
  paragraph batch, paragraph handle, prepared revision, or target adapter to ordinary Three users.
- Make the Three `FontLoader` lazily initialize and cache the core shaper on its first load while preserving explicit
  callback/Promise loading and Three `LoadingManager` behavior.
- Make each `TextGroup` declare one technique and own one explicit scene render phase backed by a core paragraph batch and
  renderer target. Require every `Text` to carry a same-technique `Font` or `FontStack`. Make an ungrouped `Text` own an
  implicit batch of one derived from that selection.
- Keep `Text` unbound until allocation or scene attachment. Reconcile direct and nested scene membership before the first
  shaping call so resident text renders in the first observing frame.
- Treat movement between batches as an atomic removal of the old paragraph allocation plus allocation of retained desired
  state in the destination; do not add a movable core paragraph contract.
- Make `TextGroup` an `Object3D`, not a Group, so Three naturally carries the nearest real ancestor Group's `groupOrder`
  through it. Map `TextGroup.renderOrder` plus the core submission ordinal onto the physical draw objects' secondary
  render orders; do not add a hidden Group or an inheritance API.
- Let Three own sync/async core calls, dirty-range mapping, transform updates, and publication during the render lifecycle.
  The application calls only `renderer.render(scene, camera)`.
- Bind a group to one renderer target lifetime and require separate groups for separate scenes, render phases, or renderers.
- Keep existing TSL technique shaders and WebGPU/WebGL2 parity while removing Three-owned glyph grouping, sorting,
  partitioning, slot allocation, and submission-plan computation.

### 7. Rebuild React Three Fiber binding

- Let declarative components create retained `Text` and `TextGroup` objects without exposing core handles.
- Let R3F reconciliation update desired state; Three's matrix/render lifecycle performs the same group synchronization as
  the imperative API.
- Preserve nested spans as paragraph data, not independent render objects.
- Preserve Suspense for loading only; warm shaping does not require a readiness Promise.
- Make synchronous versus asynchronous synchronization an integration policy selectable per frame/update.

### 8. Prove raw TypeGPU

Build the smallest application in `AlexJWayne/typegpu-shader-canvas` that proves:

- explicit baked artifact loading;
- one same-technique `FontStack` with ordered missing-glyph resolution;
- more than one paragraph in one paragraph batch;
- core-owned canonical instance storage and exact dirty ranges;
- at least two physical font-resource batches and ordered submissions;
- one synchronous update and one asynchronous update;
- no Three.js import or Three-derived adapter logic.

### 9. Prove Wayfare

Build the smallest application in `iwoplaza/wayfare` that proves the same contract through Wayfare's entity, transform,
render-pass, and frame lifecycle. The Wayfare adapter may own scene integration but must not reshape, repartition, resort, or
recompute canonical packing, batch membership, or submission order.

### 10. Verify all techniques

Run Bitmap, MTSDF, and Slug independently through:

```ts
await proveHeadlessCore();
await proveThree({ backends: ['webgpu', 'webgl2'] });
await proveRawTypeGpu();
await proveWayfare();
```

No test combines techniques inside one font stack or paragraph batch. A technique-specific proof may use several fonts and
must verify the minimum draw count and exact submission order implied by those resources.

## Performance evidence

Measure separately:

```ts
interface CoreBatchMetrics {
  dirtyParagraphs: number;
  shapedParagraphs: number;
  shapedGlyphs: number;
  layoutMilliseconds: number;
  partitionMilliseconds: number;
  packedGlyphs: number;
  packedBytes: number;
  dirtyRangeCount: number;
  glyphBatchCount: number;
  submissionCount: number;
  capacityGrowths: number;
  overflowChunks: number;
}
```

The proof must distinguish semantic CPU state, canonical packed CPU storage, target-owned CPU/staging storage, decoded technique resources, GPU
resources, draw count, and submission count. It must show that warm handle mutations do not allocate per setter and that
callback-form asynchronous updates do not allocate a public Promise.

## Exit gates

- The README and exported declarations match the [core API](core-api.md).
- One public paragraph-handle API covers multiline text, labels, and font-backed icons.
- A same-technique `FontStack` shapes one paragraph across multiple concrete fonts exactly.
- Mixed-technique font stacks and paragraph additions fail before shaping.
- Repeated handle writes coalesce before synchronization.
- Sync and async calls alternate on one runtime without copying runtime state or font registrations.
- No-op `update()` is allocation-free.
- Newer synchronization prevents stale async publication.
- Core, not the engine, owns glyph sorting, resource partitioning, slot allocation, packing, dirty ranges, and submissions.
- Core retains canonical packed CPU storage and targets synchronize only reported dirty ranges into their own buffers.
- Separate paragraph batches remain separate render phases.
- Three.js, raw TypeGPU, and Wayfare execute the same core output for Bitmap, MTSDF, and Slug.
- Full repository checks, package-size gates, and documentation validation pass.
