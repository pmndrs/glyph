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
  - id: raster-technique
    resource: raster-technique-api.md
    title: Raster technique and engine resource API
  - id: three-api
    resource: three-api.md
    title: Three.js text API
  - id: typegpu-api
    resource: typegpu-api.md
    title: TypeGPU raster programs and text engine
  - id: gpucat-integration
    resource: gpucat-integration.md
    title: External gpucat integration fitness plan
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
  by: anthropic-claude/opus-5
  at: '2026-08-07T13:26:50Z'
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
  -> PreparedGlyphRun[]          // core preserves order and resolved variants
  -> engine target               // storage, compatible draws, transform, submit
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
  oneParagraphBatchMayProduceManyGlyphBatchesAndRuns: true,
  paragraphHandlesOwnDesiredStateMutation: true,
  runtimeUpdateIsTheSynchronizationPoint: true,
  syncOrAsyncIsChosenPerUpdate: true,
  coreOwnsSortingPartitioningPackingAndDirtyRanges: true,
  coreRetainsCanonicalCpuInstanceStorage: true,
  coreVariantsAreOpaqueRenderIntent: true,
  rasterArtifactsAndCpuDataAreEngineNeutral: true,
  engineTargetsRealizeGpuResources: true,
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
  rendererOwnedShapingOrResourcePartitioning: true,
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
const overlayText = runtime.createParagraphBatch({ technique: mtsdf });
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

### `PreparedGlyphBatch` and `PreparedGlyphRun`

These are the concrete rendering outputs. Core groups compatible glyph instances into stable storage and separately emits
the ordered variant-bearing ranges the integration compiles into draws.

```ts
for (const batch of revision.glyphBatches) {
  upload(isAdjacentTargetRevision ? batch.dirtyRanges : liveSubmissionRanges(batch.key));
}
for (const draw of program.compileRuns(revision.glyphRuns)) draw(draw);
```

## Ownership boundary

| Layer               | Owns                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Baking              | reduced font data, glyph records, technique artifacts, deterministic packaging                                      |
| Loading             | validation, decoding, registered font and technique identity                                                        |
| Text runtime        | dirty aggregation, sync/async scheduling, shaping calls, supersession, atomic publication                           |
| Font stack          | one immutable ordered missing-glyph policy over same-technique concrete fonts                                       |
| Paragraph batch     | declared technique, application render phase, capacity policy, paragraph order domain                               |
| Paragraph           | batch-owned handle, font leases, desired source, spans, content box, style, paint, order, glyph-origin overrides    |
| Core batch compiler | fallback runs, layout, resource partitioning, stable slots, canonical CPU instances, dirty ranges, ordered variants |
| Technique           | artifact decoding, resource selection/bindings, canonical instance schema and writing, data meaning                 |
| Raster shader       | reusable backend implementation of canonical Bitmap, MTSDF, or Slug evaluation                                      |
| Raster program      | shader composition, variant compatibility, resources, pipelines, and final draw compilation                         |
| Engine target       | engine buffers, dirty-range synchronization, transforms, visibility, pass placement, encoding, retirement           |

## Current system versus target

| Merged v0 behavior                                                       | Target v1 behavior                                                                              |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `Text` combines paragraph, raster, and Three ownership                   | Paragraph state and batch compilation live in core; Three is one target                         |
| Property changes can prepare one `Text` immediately                      | Handle setters only mark desired state dirty                                                    |
| Async behavior follows object/runtime lifecycle                          | Every synchronization chooses `update()` or `updateAsync()`                                     |
| One paragraph stages one raster-owned Three draw object                  | One paragraph batch produces resource-compatible storage and ordered variant-bearing glyph runs |
| Renderer raster modules decide glyph grouping                            | Core and technique modules decide grouping and populate canonical CPU instance storage          |
| Raster modules combine CPU decode, Three textures, TSL, and draw objects | Portable techniques end at CPU data/bindings; engine targets realize GPU resources and draws    |
| React/Three lifecycle defines publication boundaries                     | Runtime revision and target stage/commit define publication independently of any engine         |
| Existing `Paragraph` is a separately callable subsystem                  | Paragraph implementation remains internal to the one retained handle API                        |

The migration must preserve shaping, layout, paint, raster validation, transactional failure, and disposal behavior while
moving Three-specific ownership behind the target boundary.

## Implementation sequence

### 1. Extract desired-state paragraphs

- Add stable `Paragraph` handles owned by a `ParagraphBatch`.
- Move public text, span, content-box, style, paint, order, and glyph-origin mutation onto handle setters.
- Treat nested option records as immutable replacement values.
- Track dirty handles once with channel bitsets; do not scan every paragraph.
- Coalesce add followed by dispose before synchronization to no work.
- Keep every core paragraph handle permanently owned by its creating batch. Recreate desired state elsewhere through an
  immutable snapshot plus destination `add()`, never handle transfer.
- Make batch disposal cascade through owned paragraphs and attachments without disposing the runtime or fonts; make
  runtime disposal the explicit outer cascade root.

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
- Lease every selected concrete font for the retained paragraph lifetime and make early font disposal fail rather than
  publishing missing-glyph substitutions.
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
- Treat capacity as glyph-instance slots per physical resource buffer; paragraph handles have no capacity limit.
- Name the non-resizing policy `fixed`. Detect its overflow during synchronization after exact shaping, preserve the prior
  revision, and require render-loop adapters to retain and report the typed failure without throwing from rendering.
- Latch an unchanged failed batch generation after reporting it once. Exclude that generation from later runtime updates
  until relevant mutation so unrelated batches and explicit replacements can publish without retry churn.
- Let a caller change paragraph-batch capacity explicitly while preserving the batch, every paragraph handle, and every
  attachment. Reuse compatible semantic caches, stage canonical and target replacement storage transactionally, and retire
  old buffers only after publication and engine fences.
- Default explicit batches to lazy 4,096-glyph chunks and support explicit `size` plus `grow`, `chunk`, or `fixed` policy.
- Pack technique-specific instance attributes once.
- Compute coalesced dirty ranges per storage channel.
- Emit glyph runs that preserve paragraph, variant, and technique compositing order across resource changes.
- Never make targets inspect glyphs to choose a batch.

Proof:

```ts
expect(resolveFonts('Inter -> Noto -> Inter')).toProduce({
  glyphBatches: ['Inter', 'Noto'],
  glyphRuns: ['Inter[0..8]', 'Noto[0..3]', 'Inter[8..13]'],
});
```

### 5. Add canonical CPU instance storage

- Define one canonical structure-of-arrays instance contract per technique.
- Let core and the technique populate and retain those arrays.
- Report exact coalesced adjacent-revision dirty ranges for every changed glyph batch.
- Let matching targets copy or upload the selected ranges 1:1 and different engine layouts map only those ranges.
- Initialize a late or gapped target from the live ranges already named by the current glyph-run plan.
- Allow several targets and late attachment to consume the same prepared storage without reshaping.
- Prove targets never reshape, repartition physical storage, or change non-equivalent glyph-run order while synchronizing.

### 5a. Split portable techniques from engine raster programs

- Keep every baker free of runtime engine imports.
- Move artifact validation, external resource resolution, CPU page/table decoding, coverage checks, glyph-resource
  selection, and canonical instance packing into a renderer-neutral `RasterTechnique`.
- Expose the technique-authored `binding` on every prepared glyph batch so targets receive the exact page/buffer selection
  instead of rediscovering it from glyph IDs.
- Move Three textures, attributes, TSL materials, scene objects, and renderer disposal into Three raster targets.
- Permit an optional `RasterProgram` seam when multiple engines share a shader/resource backend such as TypeGPU and raw
  WebGPU interop; do not require an artificial universal shader interface in core.
- Permit an optional package-owned `/three/typegpu` experiment only for capabilities the exact-version bridge proves. At the
  reviewed versions it is nullary WGSL injection, WebGPU-only, and not a complete Slug/Bitmap resource bridge. Keep
  Three-owned accessors, materials, pipeline state, and lifecycle in that adapter; neither core nor the portable technique
  imports TypeGPU or TSL.
- Retain decoded CPU page/table bytes through loaded-font lifetime so several targets and late attachment need no refetch or
  decode.

Proof:

```ts
expect(mtsdfBaker).not.toImportAnyRenderer();
expect(mtsdfTechnique).not.toImportAnyRenderer();
expect(threeMtsdfTarget.technique).toBe(mtsdfTechnique);
expect(typeGpuMtsdfProgram.technique).toBe(mtsdfTechnique);
expect(typeGpuThreeMtsdfProgram.technique).toBe(mtsdfTechnique);
```

### 5b. Expose the canonical ordered command hierarchy

Status: implemented. The admitted Rust plan is projected into the borrowed hierarchy in
`packages/glyph/src/glyph-config.ts` and the render-planner mapper, with lazy indexable sequences and opaque stable
identities. Three and the example renderer no longer reconstruct raw plan tables or receive numeric plan IDs.

Do this before implementing `GlyphConfig.decode` or migrating any renderer. Rust already determines grouping, batching,
instance membership, and logical order. The TypeScript boundary must preserve that result instead of exposing raw plan
tables and requiring every renderer to reconstruct the same hierarchy.

The semantic contract is:

```ts
interface TypedGroup {
  readonly children: readonly TypedGroupChild[];
}

type TypedGroupChild = TypedBatch | TypedRootInstance;

interface TypedBatch {
  readonly kind: 'batch';
  readonly identity: BatchIdentity;
  readonly instances: readonly TypedInstanceSpan[];
}

interface TypedRootInstance {
  readonly kind: 'instance';
  readonly identity: InstanceIdentity;
  readonly transform: TransformIdentity | undefined;
}

interface TypedInstanceSpan {
  readonly identity: InstanceSpanIdentity;
  readonly kind: 'glyph' | 'decoration' | 'inline-object' | 'clip' | 'codec';
  readonly recordIndex: number;
  readonly recordCount: number;
  readonly logicalOrder: number;
}
```

`TypedGroup.children` is the Rust-authored draw order. Batches and root instances remain interleaved exactly where Rust
placed them. `TypedBatch.instances` is the Rust-authored ordered span range for that batch. Neither decoder nor renderer
sorts, groups, reparses, or validates these semantic decisions.

The array notation above defines the readable semantic shape, not permission to allocate a second object graph. The
production surface must use a borrowed, read-only, indexable sequence with `length`, `at(index)`, and iteration, backed
directly by the contiguous plan memory. Accessing one child or instance projects that record lazily. The built-in hot path
uses indexed loops; custom decoder code may use the iterable surface. No preparatory scan, table-to-map conversion,
generator-per-record allocation, or copied scalar record is allowed.

Opaque identities are the only retained mapping:

- `BatchIdentity` associates one batch node with the renderer/config payload needed to bind it;
- `InstanceIdentity` associates one root instance with its renderer/config payload;
- `InstanceSpanIdentity` associates one span with its internal primitive descriptor; and
- `TransformIdentity` associates an optional authored transform with its host binding.

The engine may intern those identities lazily from numeric wire IDs, but numeric IDs never cross the public decoder or
renderer boundary. Identity metadata stores only a plan reference plus an offset/index needed for lazy access; it does not
copy a plan record. Accepted publications retain the identities needed for incremental updates. Rejected publications
discard candidate-only identity and buffer-overlay state. Borrowed plan access expires when the synchronous publication
callback settles. An asynchronous or cross-realm target receives one explicit owned command-buffer copy instead.

The trust boundary is mechanical, not semantic. The Wasm bridge checks ABI version, framing, alignment, and bounds or
uses generated layout types. Once the Rust plan is admitted, its kinds, ranges, order, and relationships are trusted.
A contradiction is an engine bug. Do not add adapter-specific recovery validation for trusted Rust output.

Implement and prove this layer in this order:

1. Generate or pin the Rust/TypeScript layout contract for group children, batch instance spans, root instances, and
   transforms. Keep the raw table/offset vocabulary package-internal.
2. Add the borrowed lazy sequence and opaque identity interner. Constructing a `TypedCommandBuffer` may read table
   descriptors and counts but must not visit records.
3. Project `TypedGroup.children` in one ordered pass. A batch child lazily exposes only its own instance range; a root
   instance exposes only its identity and optional transform.
4. Add focused probes showing that `children.at(0)` reads only child zero, batch instances are not visited until requested,
   interleaving is preserved, and repeated live wire identities reuse the same opaque objects.
5. Prove rejection does not commit candidate buffer/identity overlays, acceptance does, and an expired borrowed view cannot
   be consumed after publication.

### 5c. Bind the hierarchy through `GlyphConfig.decode`

Status: implemented. `packages/glyph/src/core/create-engine.ts` owns renderer-neutral schema binding, resolver leases,
stable accepted overlays, default decoding, and settlement. Both `ThreeConfig` and `defineExampleConfig()` wire
`defaultDecoder`; their renderers consume `BorrowedBoundCommandBuffer` and retain only accepted host state. Three keeps its
separate transform synchronizer, R3F injects only the selected handle at construction, and the paired live examples prove
both public Three entry paths over shared assets.

Only after 5b is stable, add the config-facing decoder and renderer payload schema:

- `GlyphConfig.encode` selects the `Codec` that produces the Rust plan;
- the package-internal mapper exposes the trusted borrowed `TypedCommandBuffer` hierarchy above;
- required `GlyphConfig.decode` receives that hierarchy and returns the config's inferred bound hierarchy;
- `defaultDecoder` performs the common binding path and remains explicitly wired in built-in configs so an advanced
  integration can replace or wrap it type-safely;
- the config schema infers the renderer's batch, root-instance, instance-span, transform, resource, and `drawRoot` payload
  types; and
- `resolve` creates or acquires renderer resources only when a resource command requires it, returning a staged lease that
  the boundary commits or disposes transactionally.

`decode` is a whole-publication hook, not a per-command functor and not the Rust-layout reader. Its useful customization
space is renderer-specific binding: selecting a host batch/root payload, adding derived renderer metadata, changing
resource binding strategy, or returning a renderer-optimized lazy facade with the same hierarchy. It must not create or
attach Three meshes. The renderer's `prepare` transaction owns host objects and attachment; the host renderer later owns
actual rendering.

The bound result preserves the same tree:

```ts
interface BoundGroup<Schema extends GlyphSchema> {
  readonly drawRoot: Schema['drawRoot'];
  readonly children: BorrowedSequence<BoundBatch<Schema> | BoundRootInstance<Schema>>;
}

interface BoundBatch<Schema extends GlyphSchema> {
  readonly kind: 'batch';
  readonly value: Schema['batch'];
  readonly instances: BorrowedSequence<BoundInstanceSpan<Schema>>;
}

interface BoundRootInstance<Schema extends GlyphSchema> {
  readonly kind: 'instance';
  readonly value: Schema['instance'];
  readonly transform: Schema['transform'] | undefined;
}
```

The exact helper/type names in this illustrative bound form are not approval to rename settled Glyph concepts. Before
publishing them, infer the associated types from one `defineGlyphConfig`/schema helper and verify that a non-Three config
does not import or imitate Three classes.

Prove the integration in this order:

1. Implement package-internal publication/resource machinery and `defaultDecoder` over the 5b hierarchy.
2. Migrate the example renderer first. It must consume the bound hierarchy without Three concepts and without reading raw
   plan tables; this is the abstraction fitness test.
3. Migrate `ThreeTextRenderPlanExecutor` to renderer preparation over bound batches/root instances. Remove its duplicate
   plan decoding, numeric-ID lookup, semantic validation, and hierarchy reconstruction only after parity tests pass.
4. Preserve Three's transform-only side path so matrix/visibility/render-order changes do not call `shape`, Rust, or the
   decoder.
5. Thread the selected immutable handle through optional R3F context solely into `Text`/`TextGroup` construction. R3F then
   uses the same Three traversal/publication path; it does not gain another decoder or runtime.
6. Put imperative Three and R3F hello-world examples side by side over the same assets and root selector. The imperative
   example proves `handle.createText()`; the React example proves default-handle and provider construction.
7. Restrict raw plan readers and internal mapper helpers to package-internal entry points after every built-in adapter and
   proof package uses the typed hierarchy.

Exit evidence:

- one fixture produces the same ordered group/batch/root-instance/span hierarchy in the example and Three adapters;
- neither adapter imports raw plan-table readers or sees numeric IDs;
- custom decode type tests infer exact config payloads and reject a foreign renderer payload;
- injected failure at each resolve/decode/prepare phase preserves the previous committed group and disposes every
  candidate-only lease exactly once;
- repeated accepted publications reuse retained renderer objects where identities remain live; and
- package graph checks prove the canonical mapper/publication helpers are renderer-neutral.

### 6. Rebuild the Three.js public surface over hidden core objects

- Keep Three.js applications on `FontLoader`, `TextGroup`, and transform-bearing `Text`; never expose a core runtime,
  paragraph batch, paragraph handle, prepared revision, or target adapter to ordinary Three users.
- Make the Three `FontLoader` lazily initialize and cache the core shaper on its first load while preserving explicit
  callback/Promise loading and Three `LoadingManager` behavior.
- Make each `TextGroup` declare one technique and own one explicit scene render phase backed by a core paragraph batch and
  renderer target. Require every `Text` to carry a same-technique `Font` or `FontStack`. Make an ungrouped `Text` own an
  implicit batch of one derived from that selection.
- Keep `Text` unbound until scene attachment. Reconcile direct and nested scene membership before the first
  shaping call so resident text renders in the first observing frame.
- Treat movement between batches as an atomic removal of the old paragraph allocation plus allocation of retained desired
  state in the destination; do not add a movable core paragraph contract.
- Let `Text` own desired state and font leases independently of membership. Disposing a populated `TextGroup` unbinds all
  member text and retires group resources without disposing children or fonts; each live compatible `Text` can bind fresh
  membership in another group. Treat a disposed group that remains in the scene graph as a terminal non-rendering boundary,
  never as permission to fall through into an ancestor group or implicit standalone batch.
- Make `TextGroup` an `Object3D`, not a Group, so Three naturally carries the nearest real ancestor Group's `groupOrder`
  through it. Map `TextGroup.renderOrder` plus the program draw ordinal onto the physical draw objects' secondary
  render orders; do not add a hidden Group or an inheritance API.
- Let Three own sync/async core calls, dirty-range mapping, transform updates, and publication during the render lifecycle.
  The application calls only `renderer.render(scene, camera)`.
- Expose explicit capacity changes on `TextGroup` and standalone `Text` while preserving their identities and hidden
  paragraph handles. Reject `TextGroup.clone()` and `copy()` because recursive scene copying cannot safely duplicate batch
  membership, external refs, subscriptions, and renderer resources.
- Bind a group to one renderer target lifetime. Require separate groups for simultaneous scene placements, intentional
  render phases, or different renderers; ordinary Three reparenting may move one group between scenes.
- Export each canonical technique shader and let custom programs compose final TSL output without rewriting Bitmap,
  MTSDF, or Slug. Keep the optional `TextEffect` helper at the Three layer; core carries only generic variants.
- Remove Three-owned shaping, source sorting, resource partitioning, and slot allocation. Retain Three-owned variant
  compatibility, final draw compilation, materials, and render-list integration.

### 7. Rebuild React Three Fiber binding

- Let declarative components create retained `Text` and `TextGroup` objects without exposing core handles.
- Let R3F reconciliation update desired state; Three's matrix/render lifecycle performs the same group synchronization as
  the imperative API.
- Preserve nested spans as paragraph data, not independent render objects.
- Preserve Suspense for loading only; warm shaping does not require a readiness Promise.
- Do not add a per-frame synchronous/asynchronous switch to the binding. The [Three API](three-api.md) settled that the
  standard Three target is synchronous by construction, so a target returning `pending` cannot offer the
  same-observing-frame guarantee and is not accepted by the standard `TextGroup` binding. Choosing `update()` versus
  `updateAsync()` remains a core runtime decision available to applications that drive core directly.

### 8. Implement and prove the package-owned TypeGPU subpath

Implement the complete [TypeGPU API](typegpu-api.md), then build the smallest application in
`AlexJWayne/typegpu-shader-canvas` that proves:

- explicit baked artifact loading;
- one same-technique `FontStack` with ordered missing-glyph resolution;
- more than one paragraph in one paragraph batch;
- caller-owned `TgpuRoot`, device, render pass, queue submission, and frame loop;
- reusable typed Bitmap, MTSDF, and Slug shaders plus program-owned resources, variants, pipelines, and draw compilation;
- core-owned canonical instance storage, adjacent dirty ranges, and current live glyph-run ranges;
- at least two physical raster-resource batches and ordered variant-bearing glyph runs;
- one program that batches several parameterized variants into one draw and one program that deliberately splits them;
- paragraph transforms, visibility, and effect parameters without reshaping;
- one synchronous update and one asynchronous update;
- no Three.js import or Three-derived adapter logic.

### 8a. Falsify or narrow the TypeGPU-to-Three bridge

Start from the reviewed baseline `three@0.185.1`, `typegpu@0.11.9`, and `@typegpu/three@0.11.0`: `toTSL()` accepts a nullary
closure, injects resolved WGSL through Three's WebGPU builder, has no forced-WebGL2 route, and has not carried Slug's
sampleable resources. Build a minimal exact-version fixture before adapting text. Only if that fixture proves real Bitmap
and Slug resources, dependent loads, vertex work, structured results, and every promised backend should the experiment
inspect parity and measure transfer/graph/compilation cost. Otherwise narrow the optional package subpath to the pure
WebGPU math it actually supports; native TSL remains authoritative for Three.

### 9. Prove Wayfare

First inspect and pin `iwoplaza/wayfare` source to establish its public device, pass, resource, transform, and lifecycle
hooks; no current document treats compatibility as already proven. Then build the smallest application that proves the
same contract. The Wayfare adapter may own scene integration but must not reshape, repartition physical storage, resort
source text, or recompute canonical packing. Reuse a TypeGPU program only if the pinned source and execution proof establish
compatible WebGPU device/pass interop; otherwise implement a Wayfare-native program against the same semantic raster ABI.

### 10. Prove an external gpucat package

Implement the [gpucat fitness plan](gpucat-integration.md) in an isolated package that installs packed public core and
technique artifacts. Prove typed buffer/texture realization, dirty-range uploads, transforms, ordered instanced draws,
resource disposal, and Bitmap/MTSDF/Slug output without changing core or importing private source. Treat canonical Slug
shader reuse as its own gate: a failed shader-sharing experiment may require a gpucat-native program, but not a core API.

### 11. Verify all techniques

Run Bitmap, MTSDF, and Slug independently through:

```ts
await proveHeadlessCore();
await proveThree({ backends: ['webgpu', 'webgl2'] });
await proveRawTypeGpu();
await proveWayfare();
await proveGpucatExternalPackage();
```

No test combines techniques inside one font stack or paragraph batch. A technique-specific proof may use several fonts and
must verify exact core glyph-run order and the minimum draw count permitted by its program compatibility.

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
  glyphRunCount: number;
  compiledDrawCount: number;
  capacityGrowths: number;
  overflowChunks: number;
}
```

The proof must distinguish semantic CPU state, canonical packed CPU storage, target-owned CPU/staging storage, decoded technique resources, GPU
resources, glyph-run count, and compiled draw count. It must show that warm handle mutations do not allocate per setter and that
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
- Core owns source sorting, resource partitioning, slot allocation, packing, dirty ranges, resolved variants, and ordered
  glyph runs. Programs own variant compatibility and final draw compilation.
- Core retains canonical packed CPU storage. Targets synchronize adjacent dirty ranges, or current live glyph-run ranges
  when first attached or recovering across a revision gap, into their own buffers.
- Separate paragraph batches remain separate render phases.
- Explicit capacity changes preserve batch, paragraph, attachment, and Three object identities; core and Three batch
  cloning remain unsupported.
- Three.js, raw TypeGPU, Wayfare, and the external gpucat package execute the same core output for Bitmap, MTSDF, and Slug.
- Core, portable techniques, and bakers import no Three.js, TypeGPU, Wayfare, or gpucat code; maintained subpaths and
  external integrations pass a
  packed-public-package test without deep imports.
- Full repository checks, package-size gates, and documentation validation pass.
