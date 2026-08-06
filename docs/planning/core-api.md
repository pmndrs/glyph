---
type: API Specification
title: Core text API
description: Canonical API and rationale for loading fonts, grouping same-technique fallbacks, editing paragraphs, synchronizing shaping, and producing renderer-ready glyph batches.
documentation_type: reference
tags: [api, fonts, shaping, paragraphs, batching, rendering, async]
status: stable
sources:
  - id: decision-register
    resource: decision-register.md
    title: Accepted architectural decisions
  - id: engine-contract
    resource: engine-integration-contract.md
    title: Engine integration contract
  - id: extraction-plan
    resource: engine-integration-boundary.md
    title: Renderer-neutral extraction plan
  - id: three-api
    resource: three-api.md
    title: Three.js text API
  - id: current-api
    resource: api-shapes.md
    title: Existing API migration fixture
  - id: current-shaper
    resource: ../../packages/text/src/shaper.ts
    title: Current synchronous shaper
  - id: current-paragraph
    resource: ../../packages/text/src/paragraph.ts
    title: Current paragraph implementation
  - id: current-raster
    resource: ../../packages/text/src/raster.ts
    title: Current raster transaction contract
generated:
  by: openai-codex/gpt-5.6
  at: '2026-08-06T16:07:26Z'
---

# Core text API

This is the canonical public API and the authority for implementation.

```ts
fontFile
  -> bakeFont()                    // optional build-time work
  -> runtime.loadFont()            // explicit asynchronous loading
  -> runtime.createFontGroup()     // fallback fonts, exactly one technique
  -> runtime.createParagraphBatch()// one intentional render phase
  -> paragraph.text = next         // cheap desired-state mutation
  -> runtime.update()              // synchronous synchronization point
     // or runtime.updateAsync()   // asynchronous synchronization point
  -> PreparedGlyphBatch[]          // core-partitioned GPU instance data
  -> GlyphSubmission[]             // core-authored draw order
  -> engine upload and draw        // thin target wiring
```

## The complete API

```ts
interface TextRuntime {
  readonly current: TextRuntimeRevision;
  readonly hasPendingChanges: boolean;
  readonly isPreparing: boolean;

  loadFont<Technique extends AnyRasterTechnique>(
    request: LoadedFontRequest<Technique>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<LoadedFont<Technique>>;

  createFontGroup<Technique extends AnyRasterTechnique>(options: FontGroupOptions<Technique>): FontGroup<Technique>;

  createParagraphBatch<Technique extends AnyRasterTechnique>(
    options: ParagraphBatchOptions<Technique>,
  ): ParagraphBatch<Technique>;

  update(): TextRuntimeRevision;

  updateAsync(options?: AsyncTextUpdateOptions): Promise<TextUpdateOutcome>;
  updateAsync(callback: TextUpdateCallback): void;
  updateAsync(options: AsyncTextUpdateOptions, callback: TextUpdateCallback): void;

  subscribe(listener: (revision: TextRuntimeRevision) => void): () => void;
  dispose(): void;
}

interface TextRuntimeOptions {
  readonly registry?: FontRegistry;
  readonly shaper?: RuntimeShaper;
  readonly async?: Readonly<{
    readonly worker?: TextPreparationWorker;
    readonly createWorker?: () => TextPreparationWorker;
  }>;
}

declare function createTextRuntime(options?: TextRuntimeOptions): Promise<TextRuntime>;
```

Runtime options provision capabilities. They do not choose whether every update is synchronous or asynchronous. That
choice belongs to each `update()` or `updateAsync()` call.

## Bake and load explicitly

```ts
import { rasterBake } from '@pmndrs/text';
import { bakeFont } from '@pmndrs/text/bake';
import mtsdfBaker from '@pmndrs/text/raster/mtsdf/baker';

await bakeFont({
  input: new URL('./Inter-Regular.ttf', import.meta.url),
  output: new URL('./Inter.font.glb', import.meta.url),
  font: { fontFaceIndex: 0 },
  rasters: [
    rasterBake(mtsdfBaker, {
      packaging: { artifact: 'embedded', pages: 'embedded' },
      options: undefined,
    }),
  ],
});
```

Baking produces font metrics, glyph records, and technique resources before the application runs. Runtime fallback may
perform the same bake in a Worker, but loading remains explicit in either case.

```ts
import { createTextRuntime } from '@pmndrs/text';
import { mtsdf } from '@pmndrs/text/raster/mtsdf';

const runtime = await createTextRuntime({
  async: {
    createWorker: () => new Worker(new URL('./text-worker.js', import.meta.url)),
  },
});

const inter = await runtime.loadFont({
  input: { baked: '/fonts/Inter.font.glb' },
  raster: { technique: mtsdf },
});
```

```ts
interface LoadedFont<Technique extends AnyRasterTechnique> {
  readonly font: RegisteredFont;
  readonly technique: Technique;
  readonly raster: RegisteredRaster<RasterKindOf<Technique>>;
  readonly data: RasterDataOf<Technique>;
}
```

`loadFont()` completes after shaping data and the selected technique data are decoded into renderer-neutral CPU state. It
does not create textures, buffers, pipelines, materials, meshes, entities, or scene objects.

## Group fallback fonts under one technique

A font group is the complete set of fonts that may shape one paragraph. Its order defines fallback precedence.

```ts
const noto = await runtime.loadFont(notoMtsdfRequest);
const amiri = await runtime.loadFont(amiriMtsdfRequest);
const iconMtsdf = await runtime.loadFont(iconMtsdfRequest);

const uiFonts = runtime.createFontGroup({
  fonts: [inter, noto, amiri, iconMtsdf],
  fallback: [inter, noto, amiri],
});
```

```ts
interface FontGroupOptions<Technique extends AnyRasterTechnique> {
  readonly fonts: readonly [LoadedFont<Technique>, ...LoadedFont<Technique>[]];
  readonly fallback?: readonly LoadedFont<Technique>[];
}

interface FontGroup<Technique extends AnyRasterTechnique> {
  readonly technique: Technique;
  readonly fonts: readonly LoadedFont<Technique>[];
  readonly fallback: readonly LoadedFont<Technique>[];
  has(font: LoadedFont<Technique>): boolean;
}
```

Every member must use the same technique. Different fonts may require different atlas, curve, or other GPU resources, so
one font group does not promise one draw. It promises that one technique can render every resolved glyph.

```ts
runtime.createFontGroup({
  fonts: [interMtsdf, iconBitmap],
  // Throws: MTSDF and Bitmap are different techniques.
});
```

A renderer that combines Bitmap and Slug data is a new technique with its own artifacts, instance schema, resource
bindings, and shader. It is not a font group that mixes the existing Bitmap and Slug techniques.

## Create an intentional paragraph batch

A paragraph batch contains paragraphs that the application permits core to order and submit as one render phase.

```ts
const worldText = runtime.createParagraphBatch({
  fonts: uiFonts,
  capacity: {
    paragraphs: 1_000,
    glyphs: 20_000,
    overflow: 'chunk',
  },
});
```

```ts
interface ParagraphBatchOptions<Technique extends AnyRasterTechnique> {
  readonly fonts: FontGroup<Technique>;
  readonly capacity?: Readonly<{
    readonly paragraphs?: number;
    readonly glyphs?: number;
    readonly resources?: readonly Readonly<{
      readonly font: LoadedFont<Technique>;
      readonly glyphs: number;
    }>[];
    readonly overflow?: 'grow' | 'chunk' | 'error';
  }>;
}

interface ParagraphBatch<Technique extends AnyRasterTechnique> {
  readonly runtime: TextRuntime;
  readonly fonts: FontGroup<Technique>;
  readonly current: PreparedParagraphBatchRevision<Technique>;
  readonly paragraphCount: number;
  readonly hasPendingChanges: boolean;

  add(properties: ParagraphProperties<Technique>): Paragraph<Technique>;
  has(paragraph: Paragraph<Technique>): boolean;
  subscribe(listener: (revision: PreparedParagraphBatchRevision<Technique>) => void): () => void;
  dispose(): void;
}
```

Create another paragraph batch when text must be rendered in another phase, even if it uses the same font group.

```ts
const overlayText = runtime.createParagraphBatch({
  fonts: uiFonts,
  capacity: { paragraphs: 100, glyphs: 2_000, overflow: 'grow' },
});
```

Core never merges `worldText` and `overlayText`. The application may place non-text draws between them or give them
different depth, stencil, clipping, compositing, lifetime, or render-pass policies.

## Everything added is a paragraph

A paragraph is one independently shaped and laid-out sequence. A multiline block, a one-line label, and a font-backed
icon use the same API.

```ts
const body = worldText.add({
  primaryFont: inter,
  text: 'A paragraph can resolve glyphs through every font in its group.',
  contentBox: {
    width: { mode: 'at-most', size: 480 },
    wrap: 'word',
  },
});

const label = worldText.add({
  primaryFont: inter,
  text: 'Player 1',
});

const icon = worldText.add({
  primaryFont: iconMtsdf,
  text: '\uf013',
});
```

`iconMtsdf` must belong to `uiFonts`. A Bitmap icon cannot appear inline in an MTSDF paragraph batch. Supporting both
resource types in one paragraph requires a technique expressly designed to render both.

```ts
interface ParagraphProperties<Technique extends AnyRasterTechnique> {
  readonly primaryFont: LoadedFont<Technique>;
  readonly text: string;
  readonly spans?: readonly ParagraphSpan<Technique>[];
  readonly contentBox?: ParagraphContentBox;
  readonly style?: ParagraphStyle;
  readonly paint?: GlyphPaintInput;
  readonly order?: number;
}

interface ParagraphSpan<Technique extends AnyRasterTechnique> {
  readonly start: number;
  readonly end: number;
  readonly font?: LoadedFont<Technique>;
  readonly style?: ParagraphStyle;
  readonly paint?: GlyphPaintInput;
}
```

The primary font and every explicit span font must belong to the paragraph batch's font group. Missing glyphs resolve
through that group's fallback order during shaping.

## Mutate handles; synchronize later

`add()` returns the retained interface for that paragraph. Setters change desired state and mark the paragraph dirty; they
do not shape immediately.

```ts
interface Paragraph<Technique extends AnyRasterTechnique> {
  readonly batch: ParagraphBatch<Technique>;
  readonly disposed: boolean;
  readonly committed: PreparedParagraph | undefined;

  primaryFont: LoadedFont<Technique>;
  text: string;
  spans: readonly ParagraphSpan<Technique>[];
  contentBox: ParagraphContentBox;
  style: ParagraphStyle;
  paint: GlyphPaintInput;
  order: number;

  set(properties: Partial<ParagraphProperties<Technique>>): void;
  setSpan(index: number, span: ParagraphSpan<Technique>): void;
  removeSpan(index: number): void;

  snapshotGlyphs(): GlyphSnapshot;
  setGlyphOrigins(update: GlyphOriginUpdate): void;
  clearGlyphOriginOverrides(): void;

  dispose(): void;
}
```

```ts
label.text = 'First value';
label.text = 'Second value';
label.text = 'Player 2';
label.contentBox = { width: { mode: 'exact', size: 320 } };
```

Those mutations create one dirty paragraph. The next synchronization shapes only `Player 2` with the final content box.

Nested configuration values are immutable snapshots. Replace `paragraph.contentBox` or call `paragraph.set()`; mutating
`paragraph.contentBox.width.size` is not observable and is unsupported.

Creation and disposal are staged in the same way:

```ts
const pending = worldText.add({ primaryFont: inter, text: 'Not shaped yet' });
pending.dispose();

runtime.update(); // coalesces the add and removal to no work
```

## Synchronize now

```ts
label.text = 'Ready for this frame';
body.contentBox = { width: { mode: 'at-most', size: 360 }, wrap: 'word' };

const revision = runtime.update();
```

```ts
interface TextRuntimeRevision {
  readonly revision: number;
  readonly paragraphBatches: readonly PreparedParagraphBatchRevision<AnyRasterTechnique>[];
}
```

`update()` snapshots every currently dirty paragraph across every paragraph batch in the runtime, performs the required
shaping and layout synchronously, updates prepared glyph batches, publishes one atomic runtime revision, and returns it.
When nothing is dirty it returns `runtime.current` without allocating or notifying subscribers.

All data required by synchronous shaping must have been loaded already. Invalid input, missing data, capacity failure, or
preparation failure throws before publication and leaves the prior revision current.

## Synchronize asynchronously

The same runtime can choose Worker preparation for any update.

```ts
label.text = 'Prepare this away from the caller';
const outcome = await runtime.updateAsync();

if (outcome.status === 'published') {
  useRevision(outcome.value);
}
```

Promise-free callback form:

```ts
label.text = 'Avoid a Promise for this hot path';

runtime.updateAsync({ signal: controller.signal }, (result) => {
  if (!result.ok) {
    handleUpdateError(result.error);
    return;
  }

  if (result.value.status === 'published') {
    publish(result.value.value);
  }
});
```

```ts
interface AsyncTextUpdateOptions {
  readonly signal?: AbortSignal;
  readonly priority?: 'background' | 'normal' | 'urgent';
  readonly onProgress?: (progress: TextUpdateProgress) => void;
}

interface TextUpdateProgress {
  readonly revision: number;
  readonly preparedParagraphs: number;
  readonly totalParagraphs: number;
  readonly stagedGlyphs: number;
}

type TextUpdateCallback = (result: TextUpdateResult) => void;

type TextUpdateResult =
  | { readonly ok: true; readonly value: TextUpdateOutcome }
  | { readonly ok: false; readonly error: TextPreparationError };

type TextUpdateOutcome =
  | { readonly status: 'published'; readonly value: TextRuntimeRevision }
  | { readonly status: 'superseded'; readonly revision: number; readonly byRevision: number }
  | { readonly status: 'aborted'; readonly revision: number; readonly reason?: unknown };

interface TextPreparationError {
  readonly kind: 'preparation';
  readonly cause: unknown;
}
```

The callback form constructs no public Promise and runs exactly once asynchronously. Supersession and cancellation are
handled synchronization outcomes, not errors. The Promise resolves them and the callback returns them through its `ok`
branch. The Promise rejects only for an actual preparation failure; the callback reports the same failure through its
`error` branch.

An asynchronous executor may stream completed paragraph work into unpublished staging storage and report bounded progress
through `onProgress`. Streaming never publishes a partial runtime or paragraph-batch revision; every affected batch becomes
current together only after the complete synchronization succeeds.

Both forms snapshot dirty state when called. Later property mutations remain dirty for the next synchronization:

```ts
label.text = 'A';
const preparingA = runtime.updateAsync();

label.text = 'B'; // pending for the next update; not folded into A
```

A newer synchronization supersedes any older asynchronous candidate that has not published:

```ts
label.text = 'A';
const preparingA = runtime.updateAsync();

label.text = 'B';
runtime.update(); // publishes B before returning

const outcomeA = await preparingA;
// { status: 'superseded', revision: A, byRevision: B }
```

`B` is the correct final state. The superseded result only explains why the older request did not publish; callers may
ignore it when they do not need update diagnostics.

## Dirty state selects the work

```ts
type ParagraphDirtyChannel = 'text' | 'font' | 'features' | 'content-box' | 'paint' | 'origins' | 'order';
```

```ts
const WorkByChannel = {
  text: 'shape-layout-partition',
  font: 'shape-layout-partition',
  features: 'shape-layout-partition',
  'content-box': 'reflow-and-boundary-reshape',
  paint: 'rewrite-instance-paint',
  origins: 'rewrite-instance-origins',
  order: 'rebuild-submission-plan',
} as const;
```

Core keeps a dirty set rather than scanning every paragraph. Repeated writes to the same field coalesce. Paint, origin,
and order changes do not reshape text.

## Core produces real glyph batches

One paragraph can resolve glyphs through several fonts. Those fonts use one technique but may bind different GPU
resources. Core partitions and packs them before the renderer sees the revision.

```ts
interface PreparedParagraphBatchRevision<Technique extends AnyRasterTechnique> {
  readonly paragraphBatch: ParagraphBatch<Technique>;
  readonly revision: number;
  readonly technique: Technique;
  readonly paragraphs: readonly PreparedParagraph[];
  readonly glyphBatches: readonly PreparedGlyphBatch<Technique>[];
  readonly submissions: readonly GlyphSubmission[];
}

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

interface GlyphBatchKey {
  readonly technique: RasterTechniqueId;
  readonly fontResource: FontResourceId;
  readonly pipelineVariant: number;
  readonly chunk: number;
}

interface GlyphSubmission {
  readonly batch: GlyphBatchKey;
  readonly start: number;
  readonly count: number;
  readonly order: number;
}
```

Given the resolved font sequence `Inter -> Noto -> Inter`, core may retain one Inter buffer and one Noto buffer while
emitting three ordered submissions:

```ts
revision.submissions = [
  { batch: interBatch.key, start: 0, count: 8, order: 0 },
  { batch: notoBatch.key, start: 0, count: 3, order: 1 },
  { batch: interBatch.key, start: 8, count: 5, order: 2 },
];
```

The renderer does not inspect glyphs to rediscover technique, font-resource, capacity, or ordering boundaries.

## Core retains canonical instance storage

Core must retain paragraph input, shaping/layout results, glyph allocation metadata, shaped origins, and optional origin
overrides. It also owns one canonical packed CPU representation for each prepared glyph batch.

```ts
interface PreparedGlyphBatch<Technique extends AnyRasterTechnique> {
  readonly storage: GlyphBatchStorageOf<Technique>;
  readonly dirtyRanges: readonly GlyphRange[];
}
```

The technique defines the canonical structure-of-arrays fields and writes changed slots into them. Those arrays are the
portable synchronization boundary. They remain available for multiple targets, late attachment, inspection, Worker result
integration, target recovery, and deterministic tests.

An integration synchronizes only `dirtyRanges`. When its engine layout matches, this is a direct range copy or upload. When
its layout differs, it maps only those canonical fields and ranges into its own interleaved or technique-specific buffer.
The integration still performs no shaping, sorting, font-resource partitioning, slot allocation, or submission planning.

This CPU copy deliberately decouples core publication from inaccessible or in-flight GPU memory. The target owns its engine
buffers, upload commands, double/triple buffering, frame publication, fences, and retirement.

## Move glyphs without reshaping

```ts
const snapshot = label.snapshotGlyphs();
const x = snapshot.displayedX.slice();
const y = snapshot.displayedY.slice();

simulateGlyphs(x, y, delta);

label.setGlyphOrigins({
  topology: snapshot.topology,
  start: 0,
  x,
  y,
});

runtime.update(); // writes origins only
```

Clear the override to return to the current shaped positions:

```ts
label.clearGlyphOriginOverrides();
runtime.update();
```

Reshaping updates the authoritative target positions. The application may snapshot them again and interpolate from its
current displayed positions.

## Three.js is a separate public surface

Three.js applications use `FontLoader`, `TextGroup`, and `Text` from `@pmndrs/text/three`. That integration owns these core
objects privately and synchronizes them during Three's render lifecycle; it never asks an application to create core
paragraphs and wrap them in adapter objects.

See the authoritative [Three.js text API](three-api.md). The mapping is intentionally direct:

```ts
FontLoader -> cached TextRuntime/shaper initialization + loaded fonts
TextGroup  -> FontGroup + ParagraphBatch + Three renderer target
Text       -> desired paragraph state + late-bound Paragraph + Object3D transform
```

## Implement another engine

The engine consumes already partitioned storage and an ordered submission plan:

```ts
for (const glyphBatch of revision.glyphBatches) {
  const gpuBatch = target.ensureBatch({
    key: glyphBatch.key,
    technique: glyphBatch.technique,
    font: glyphBatch.font,
    capacity: glyphBatch.capacity,
    storage: glyphBatch.storage,
  });

  gpuBatch.upload(glyphBatch.dirtyRanges);
  gpuBatch.setCount(glyphBatch.instanceCount);
}

for (const submission of revision.submissions) {
  target.draw(submission.batch, submission.start, submission.count);
}
```

Core owns shaping, fallback, layout, sorting, resource partitioning, slot allocation, overflow chunking, instance packing,
dirty ranges, and the text-local submission plan. The engine owns transforms, visibility, scene composition, GPU objects,
render-pass placement, command encoding, frame publication, fences, and resource retirement.

## Dispose

```ts
worldText.dispose();
overlayText.dispose();
runtime.dispose();
```

Targets release GPU resources only after their engine knows no in-flight frame still references them.

## Why these boundaries exist

```ts
const Decisions = {
  oneParagraphAPI: 'A label or icon is still a paragraph.',
  sameTechniqueFontGroups: 'Fallback needs multiple fonts; one shader technique must render the result.',
  explicitParagraphBatches: 'Only the application knows where text render phases must remain separate.',
  coreOwnedPhysicalBatching: 'Every target would otherwise duplicate grouping, sorting, packing, and dirty tracking.',
  handleOwnedMutation: 'Repeated writes debounce naturally before a synchronization call.',
  perUpdateScheduling: 'The same runtime must switch between immediate and Worker preparation.',
  canonicalCpuStorage: 'Every target synchronizes exact dirty ranges from one stable portable representation.',
  orderedSubmissions: 'Fallback font runs can require multiple GPU submits while preserving glyph order.',
} as const;
```

The old public `createParagraphEngine()` path, runtime-wide sync/Worker mode, mutation callback passed to `update()`, mixed-
technique logical batch, and renderer-owned glyph repartitioning are explicitly not part of this API.
