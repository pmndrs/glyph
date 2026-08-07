---
type: API Specification
title: Core text API
description: Canonical API and rationale for loading fonts, composing ordered same-technique font stacks, editing paragraphs, synchronizing shaping, and producing renderer-ready glyph batches.
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
  - id: raster-technique
    resource: raster-technique-api.md
    title: Raster technique and engine resource API
  - id: extraction-plan
    resource: engine-integration-boundary.md
    title: Renderer-neutral extraction plan
  - id: three-api
    resource: three-api.md
    title: Three.js text API
  - id: typegpu-api
    resource: typegpu-api.md
    title: TypeGPU raster programs and text engine
  - id: gpucat-integration
    resource: gpucat-integration.md
    title: External gpucat integration fitness plan
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
  at: '2026-08-07T01:16:02Z'
---

# Core text API

This is the canonical public API and the authority for implementation.

```ts
fontFile
  -> bakeFont()                    // optional build-time work
  -> runtime.loadFont()            // explicit asynchronous loading
  -> createFontStack()             // optional ordered missing-glyph resolution
  -> runtime.createParagraphBatch()// one intentional render phase
  -> paragraph.text = next         // cheap desired-state mutation
  -> runtime.update()              // synchronous synchronization point
     // or runtime.updateAsync()   // asynchronous synchronization point
  -> PreparedGlyphBatch[]          // core-partitioned GPU instance data
  -> PreparedGlyphRun[]            // ordered text runs with resolved render intent
  -> engine draw compiler          // compatible pipelines, effects, and final draws
```

## The complete API

```ts
interface TextRuntime {
  readonly current: TextRuntimeRevision;
  readonly hasPendingChanges: boolean;
  readonly isPreparing: boolean;
  readonly disposed: boolean;

  loadFont<Technique extends AnyRasterTechnique>(
    request: LoadedFontRequest<Technique>,
    options?: { readonly signal?: AbortSignal },
  ): Promise<LoadedFont<Technique>>;

  createParagraphBatch<Technique extends AnyRasterTechnique, Variant = undefined>(
    options: ParagraphBatchOptions<Technique, Variant>,
  ): ParagraphBatch<Technique, Variant>;

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
choice belongs to each `update()` or `updateAsync()` call. `createTextRuntime()` takes exclusive lifecycle ownership of an
injected registry, shaper, worker, or worker produced by `createWorker`; callers must not share those objects with another
runtime or dispose them independently.

`AnyRasterTechnique`, `RasterDataOf`, `RasterBindingOf`, and `GlyphBatchStorageOf` come from the portable
[raster technique API](raster-technique-api.md). A technique owns artifact decoding, physical glyph-resource selection, and
canonical CPU instance packing without importing a rendering engine.

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
import { createFontStack, createTextRuntime, span, txt } from '@pmndrs/text';
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
  readonly runtime: TextRuntime;
  readonly font: RegisteredFont;
  readonly technique: Technique;
  readonly raster: RegisteredRaster<RasterKindOf<Technique>>;
  readonly data: RasterDataOf<Technique>;
  readonly disposed: boolean;
  dispose(): void;
}
```

`loadFont()` completes after shaping data and the selected technique data are decoded into renderer-neutral CPU state. It
does not create textures, buffers, pipelines, materials, meshes, entities, or scene objects.

## Compose one logical font with fallback

A `FontStack` is one immutable logical font choice. Its first concrete font is primary; later fonts resolve missing glyphs
in order. A single loaded font already satisfies the same text-facing contract and needs no wrapper.

```ts
const noto = await runtime.loadFont(notoMtsdfRequest);
const amiri = await runtime.loadFont(amiriMtsdfRequest);
const iconMtsdf = await runtime.loadFont(iconMtsdfRequest);

const uiFont = createFontStack(inter, noto, amiri);
const iconFont = iconMtsdf;
```

```ts
type FontSelection<Technique extends AnyRasterTechnique> = LoadedFont<Technique> | FontStack<Technique>;

interface FontStack<Technique extends AnyRasterTechnique> {
  readonly technique: Technique;
  readonly fonts: readonly [LoadedFont<Technique>, ...LoadedFont<Technique>[]];
}

declare function createFontStack<Technique extends AnyRasterTechnique>(
  primary: LoadedFont<Technique>,
  ...fallback: readonly LoadedFont<NoInfer<Technique>>[]
): FontStack<Technique>;
```

Every concrete font must use the same technique. TypeScript rejects a mixed stack through `NoInfer`; runtime validation
provides the same guarantee to JavaScript and untrusted boundaries. The immutable stack owns no font lifecycle. Adding a
paragraph acquires a lease on every concrete font in its selection until that paragraph or its owning batch is disposed.
`LoadedFont.dispose()` fails while any live paragraph lease remains, so disposal can never silently turn fallback into a
missing glyph. A stack containing a successfully disposed member is rejected when used to create or update a paragraph.

```ts
createFontStack(interMtsdf, iconBitmap); // compile-time error and runtime rejection
```

A renderer that combines Bitmap and Slug data is a new technique with its own artifacts, instance schema, resource
bindings, and shader. It is not a font stack that mixes the existing Bitmap and Slug techniques.

## Create an intentional paragraph batch

A paragraph batch contains paragraphs that the application permits core to order and submit as one render phase.

```ts
const worldText = runtime.createParagraphBatch({
  technique: mtsdf,
});
```

```ts
interface ParagraphBatchOptions<Technique extends AnyRasterTechnique, Variant = undefined> {
  readonly technique: Technique;
  readonly capacity?: GlyphBufferCapacity;
  readonly renderVariant?: Variant;
}

interface GlyphBufferCapacity {
  readonly size: number;
  readonly policy: 'grow' | 'chunk' | 'fixed';
}

interface ParagraphBatch<Technique extends AnyRasterTechnique, Variant = undefined> {
  readonly runtime: TextRuntime;
  readonly technique: Technique;
  readonly capacity: GlyphBufferCapacity;
  readonly current: PreparedParagraphBatchRevision<Technique, Variant>;
  readonly paragraphCount: number;
  readonly hasPendingChanges: boolean;
  readonly preparationError: TextPreparationError | undefined;
  readonly disposed: boolean;

  renderVariant: Variant | undefined;

  add(properties: ParagraphProperties<Technique, Variant>): Paragraph<Technique, Variant>;
  setCapacity(capacity: GlyphBufferCapacity): void;
  has(paragraph: Paragraph<Technique>): boolean;
  subscribe(observer: ParagraphBatchObserver<Technique, Variant>): () => void;
  attach<TargetRevision extends ParagraphBatchTargetRevision>(
    target: ParagraphBatchTarget<Technique, Variant, TargetRevision>,
  ): ParagraphBatchAttachment<TargetRevision>;
  dispose(): void;
}

interface ParagraphBatchObserver<Technique extends AnyRasterTechnique, Variant = undefined> {
  next(revision: PreparedParagraphBatchRevision<Technique, Variant>): void;
  complete(): void;
}
```

`subscribe()` synchronously replays `current`, then reports each later published batch revision exactly once. Disposing the
batch calls `complete()` exactly once; unsubscribing is idempotent and prevents later `next()` or `complete()` calls. This
public observation contract is sufficient to build renderer coordination without access to shaping, allocation, or other
batch internals.

`attach()` is the retained convenience for that coordination. It validates technique compatibility, subscribes the target,
stages revisions, exposes renderer-safe commit, and couples attachment disposal to batch disposal. It is policy built on the
same public revisions and lifecycle events, not a second shaping or batching API. The exact target contract is specified in
the [engine integration contract](engine-integration-contract.md).

### Use the default or preallocate explicitly

Omitting `capacity` uses `{ size: 4_096, policy: 'chunk' }`. Core allocates storage lazily when the first glyph resolves to
a physical font resource. Paragraph handles and paragraph metadata grow normally; only glyph-instance storage has a
capacity policy.

```ts
const denseText = runtime.createParagraphBatch({
  technique: mtsdf,
  capacity: { size: 20_000, policy: 'chunk' },
});
```

`size` applies independently to every physical technique/resource buffer produced beneath the logical paragraph batch. It
is not a total glyph limit for the paragraph batch. Under `chunk`, core preserves existing storage and allocates another
`size`-slot buffer when one fills. Under `grow`, core transactionally replaces a full buffer and doubles its capacity until
the pending glyphs fit. Under `fixed`, exceeding `size` fails preparation and preserves the last published revision.
Ordered glyph runs make cross-buffer paragraph and fallback-font order explicit.

`ParagraphBatch.add()` cannot reject a capacity overflow because fallback, shaping, wrapping, and later mutations determine
the physical per-resource glyph demand. `update()` or `updateAsync()` discovers overflow after shaping but before
publication. Fixed overflow returns a typed `capacity-exceeded` preparation failure with the batch, configured limit, the
maximum per-resource requirement, and every overflowing physical resource. One resize to `error.required`
therefore satisfies the complete shaped generation rather than revealing overflows one at a time. The complete prior
runtime revision remains current; on a first update no partial revision becomes visible. Desired state remains available
for correction or an explicit capacity change.

The first failing synchronization throws or rejects and records the error on `batch.preparationError`. That exact failed
desired generation is then latched rather than remaining eligible work: `batch.hasPendingChanges` is false when its only
unpublished state is the unchanged failure, and later runtime updates may publish other dirty batches. Any relevant
paragraph or membership mutation clears the latch and schedules a new attempt. Successful publication clears
`preparationError`. Calling `setCapacity()` with a different normalized capacity also clears the latch and schedules one
new attempt while the last committed revision remains live.

Resize a batch when an application wants to replace a fixed allocation explicitly:

```ts
worldText.setCapacity({ size: 40_000, policy: 'fixed' });
runtime.update();

worldText.has(label); // true: batch and paragraph identity did not change
```

`setCapacity()` validates and records the normalized requested capacity synchronously but does not mutate published
canonical storage. The next `update()` or `updateAsync()` reuses compatible shaping and layout results, stages replacement
storage, and atomically publishes it only when complete. Failure preserves the previous revision and every handle.
Attached targets receive the new revision through their existing attachments, stage replacement engine buffers, commit at
their safe frame boundary, and retire old buffers after their fences. The `ParagraphBatch`, its `Paragraph` handles,
subscriptions, attachments, desired state, order, glyph overrides, and font leases never change identity.

Changing from `fixed` to `grow` or `chunk`, growing a fixed size, and deliberately shrinking are all explicit capacity
changes. A shrink that cannot hold the desired generation reports `capacity-exceeded` at synchronization and retains the
previous complete revision. Passing the current normalized capacity is a no-op and does not retry a latched failure.

Create another paragraph batch when text must be rendered in another phase, even if it uses the same technique.

```ts
const overlayText = runtime.createParagraphBatch({
  technique: mtsdf,
});
```

Core never merges `worldText` and `overlayText`. The application may place non-text draws between them or give them
different depth, stencil, clipping, compositing, lifetime, or render-pass policies.

`renderVariant` is the batch's optional inherited render intent. Core treats it as an opaque, exactly typed value: it does
not know whether the value represents an effect graph, material binding, palette entry, clipping mode, or application
state. Paragraph and span values may override it. `undefined` means inherit; an integration that needs an explicit “no
effect” choice defines that as an ordinary member of its own variant type. A variant never changes the declared raster
technique and does not by itself require another physical glyph buffer, pipeline, or draw.

Core retains an opaque variant value and compares replacements with `Object.is`; it cannot clone or inspect integration
objects. Treat ordinary variant records as immutable snapshots and assign a replacement to change run identity. A stable
binding object may expose integration-owned mutable parameters, but changing those parameters does not mark core dirty;
the owning program must update its sidecar/uniform storage directly. Disposing a binding still referenced by a live batch,
paragraph, or span is an integration lifecycle error.

## Everything added is a paragraph

A paragraph is one independently shaped and laid-out sequence. A multiline block, a one-line label, and a font-backed
icon use the same API.

```ts
const body = worldText.add({
  font: uiFont,
  text: 'A paragraph resolves missing glyphs through its FontStack.',
  contentBox: {
    width: { mode: 'at-most', size: 480 },
    wrap: 'word',
  },
});

const label = worldText.add({
  font: inter,
  text: 'Player 1',
});

const icon = worldText.add({
  font: iconFont,
  text: '\uf013',
});
```

Every paragraph owns a concrete `Font` or `FontStack`. A Bitmap font cannot appear in an MTSDF paragraph batch. Supporting
both resource types in one paragraph requires a technique expressly designed to render both.

```ts
interface ParagraphBaseProperties<Technique extends AnyRasterTechnique, Variant = undefined> {
  readonly font: FontSelection<Technique>;
  readonly contentBox?: ParagraphContentBox;
  readonly style?: ParagraphStyle;
  readonly paint?: GlyphPaintInput;
  readonly order?: number;
  readonly renderVariant?: Variant;
}

type ParagraphContentProperties<Technique extends AnyRasterTechnique, Variant = undefined> =
  | Readonly<{
      text: string;
      spans?: readonly ParagraphSpan<Technique, Variant>[];
    }>
  | Readonly<{
      text: FormattedText<Technique>;
      spans?: never;
    }>;

type ParagraphProperties<Technique extends AnyRasterTechnique, Variant = undefined> = ParagraphBaseProperties<
  Technique,
  Variant
> &
  ParagraphContentProperties<Technique, Variant>;

interface ParagraphSpan<Technique extends AnyRasterTechnique, Variant = undefined> {
  readonly start: number;
  readonly end: number;
  readonly font?: FontSelection<Technique>;
  readonly style?: ParagraphStyle;
  readonly paint?: GlyphPaintInput;
  readonly renderVariant?: Variant;
}

type FormattedText<Technique extends AnyRasterTechnique> = TextLiteral<Technique> | TextLiteral<never>;

type TextInput<Technique extends AnyRasterTechnique> = string | FormattedText<Technique>;

declare const textLiteralTechnique: unique symbol;

interface TextLiteral<Technique extends AnyRasterTechnique> {
  readonly [textLiteralTechnique]: (technique: Technique) => Technique;
  readonly text: string;
  readonly spans: readonly ParagraphSpan<Technique>[];
}

declare const textSpanFragmentTechnique: unique symbol;

interface TextSpanFragment<Technique extends AnyRasterTechnique> {
  readonly [textSpanFragmentTechnique]: (technique: Technique) => Technique;
  readonly text: string;
  readonly spans: readonly ParagraphSpan<Technique>[];
  readonly properties: Omit<ParagraphSpan<Technique>, 'start' | 'end'>;
}

type TextTemplateValue<Technique extends AnyRasterTechnique> =
  | string
  | number
  | TextLiteral<Technique>
  | TextLiteral<never>
  | TextSpanFragment<Technique>
  | TextSpanFragment<never>;

type SpanStyle = Readonly<ParagraphStyle & GlyphPaintInput>;

type SpanFormat<Technique extends AnyRasterTechnique> = FontSelection<Technique> | SpanStyle;

interface SpanTag<Technique extends AnyRasterTechnique> {
  (strings: TemplateStringsArray, ...values: readonly TextTemplateValue<Technique>[]): TextSpanFragment<Technique>;
}

interface UnboundSpanTag {
  <Technique extends AnyRasterTechnique = never>(
    strings: TemplateStringsArray,
    ...values: readonly TextTemplateValue<Technique>[]
  ): TextSpanFragment<Technique>;
}

declare function txt<Technique extends AnyRasterTechnique = never>(
  strings: TemplateStringsArray,
  ...values: readonly TextTemplateValue<Technique>[]
): TextLiteral<Technique>;

declare function span(...styles: readonly [SpanStyle, ...SpanStyle[]]): UnboundSpanTag;

declare function span<Technique extends AnyRasterTechnique>(
  font: FontSelection<Technique>,
  ...formats: readonly SpanFormat<NoInfer<Technique>>[]
): SpanTag<Technique>;
```

The paragraph font and every explicit span font must match the paragraph batch technique. A span without `font` inherits
the paragraph selection. A `FontStack` resolves missing glyphs in its own stored order; batch membership never changes a
paragraph's shaping semantics.

The renderer-neutral `txt` and `span` tags compose the same string-plus-range representation without parsing an embedded
markup language. `span()` accepts a `SpanStyle` by itself, or a concrete `Font` / `FontStack` followed by any number of
same-technique font selections and styles. A style-only tag inherits the surrounding paragraph or span font. A `SpanStyle`
flattens paragraph style and glyph paint for concise authoring; the helper normalizes it back into the canonical nested
`ParagraphSpan.style` and `ParagraphSpan.paint` snapshot.

A fragment or literal containing no font-bearing value carries `never` as its technique marker and is explicitly accepted
by `TextTemplateValue<Technique>` and `FormattedText<Technique>`. The first font-bearing fragment fixes the literal
technique; until then the composition remains neutral and inherits its eventual paragraph font.

Formats merge from left to right. When a font is supplied it is the first argument, allowing that selection to fix the
technique; a later same-technique font replaces it. Later style fields replace earlier fields. Nested values such as
`features`, `outline`, and `shadow` replace as complete values; the helper does not deep-merge them. `NoInfer` makes
TypeScript reject mixed-technique later fonts in addition to unknown properties and invalid value types. Core snapshots
the formats when `span()` is called, then computes UTF-16 ranges and offsets for nested fragments.

```ts
const importantStyle = {
  color: '#ffddff',
  fontSize: 18,
} satisfies SpanStyle;

const important = span(amiri, importantStyle);

const title = txt`Fast ${important`accurate`} text`;

label.text = title;
label.text = 'Plain text'; // replaces the source and clears spans
```

The returned `SpanTag` is reusable. When format inputs must remain independently composable, keep them in a readonly tuple
and bind them later:

```ts
const importantFormat = [amiri, importantStyle] as const;
const importantAmiri = span(...importantFormat);
```

Assigning a `TextLiteral` replaces text and spans atomically. Passing a formatted literal together with separate `spans`
is a type error. Manual `{ text: string, spans }`, `setSpan()`, and `removeSpan()` remain available when an integration
already owns explicit UTF-16 ranges.

`SpanStyle` deliberately contains portable layout and paint only. Set an opaque `renderVariant` through explicit
`ParagraphSpan` values or `setSpan()`; an integration such as React Three Fiber may normalize its own nested variant props
into those spans. The renderer-neutral `txt` tag never captures an engine object accidentally.

## Mutate handles; synchronize later

`add()` returns the retained interface for that paragraph. Setters change desired state and mark the paragraph dirty; they
do not shape immediately.

```ts
interface Paragraph<Technique extends AnyRasterTechnique, Variant = undefined> {
  readonly id: ParagraphId;
  readonly batch: ParagraphBatch<Technique, Variant>;
  readonly disposed: boolean;
  readonly committed: PreparedParagraph | undefined;

  font: FontSelection<Technique>;
  get text(): string;
  set text(value: TextInput<Technique>);
  spans: readonly ParagraphSpan<Technique, Variant>[];
  contentBox: ParagraphContentBox;
  style: ParagraphStyle;
  paint: GlyphPaintInput;
  order: number;
  renderVariant: Variant | undefined;

  set(properties: ParagraphUpdate<Technique, Variant>): void;
  setSpan(index: number, span: ParagraphSpan<Technique, Variant>): void;
  removeSpan(index: number): void;

  snapshotGlyphs(): GlyphSnapshot;
  setGlyphOrigins(update: GlyphOriginUpdate): void;
  clearGlyphOriginOverrides(): void;
  snapshotProperties(): ParagraphSnapshot<Technique, Variant>;

  dispose(): void;
}

declare const paragraphIdBrand: unique symbol;
type ParagraphId = number & { readonly [paragraphIdBrand]: true };

interface ParagraphSnapshot<Technique extends AnyRasterTechnique, Variant = undefined> {
  readonly font: FontSelection<Technique>;
  readonly text: string;
  readonly spans: readonly ParagraphSpan<Technique, Variant>[];
  readonly contentBox: ParagraphContentBox;
  readonly style: ParagraphStyle;
  readonly paint: GlyphPaintInput;
  readonly order: number;
  readonly renderVariant: Variant | undefined;
}

type ParagraphUpdate<Technique extends AnyRasterTechnique, Variant = undefined> =
  | (Partial<ParagraphBaseProperties<Technique, Variant>> &
      Readonly<{
        text?: string;
        spans?: readonly ParagraphSpan<Technique, Variant>[];
      }>)
  | (Partial<ParagraphBaseProperties<Technique, Variant>> &
      Readonly<{
        text: FormattedText<Technique>;
        spans?: never;
      }>);
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
const pending = worldText.add({ font: inter, text: 'Not shaped yet' });
pending.dispose();

runtime.update(); // coalesces the add and removal to no work
```

## Paragraph handles never move between batches

A `Paragraph` belongs permanently to the `ParagraphBatch` that created it. Core has no detach, reparent, or handle-transfer
operation. Snapshot desired properties, create a destination handle, then dispose the source handle:

```ts
const desired = label.snapshotProperties();
const movedLabel = overlayText.add(desired);
label.dispose();

runtime.update(); // destination addition and source removal publish atomically
```

`snapshotProperties()` returns immutable normalized desired state, not membership, prepared glyph storage, target
attachments, or ownership. The snapshot itself acquires no font lease. The destination must belong to the same runtime,
must use the same technique, and must receive still-live fonts. Glyph-origin snapshots remain topology-bound and are
reapplied separately after the destination has a compatible shaped topology.

Disposing a paragraph releases only that handle, its dirty work, cached paragraph state, and font leases. It marks
`paragraph.disposed`, removes it from `batch.has()`, and makes every method except idempotent `dispose()` fail.

Disposing a paragraph batch is terminal and cascades only through objects it owns:

```ts
const desired = label.snapshotProperties();

worldText.dispose();

worldText.disposed; // true
label.disposed; // true: the batch owned this core handle

const replacement = overlayText.add(desired); // a new handle; never the old label
```

`ParagraphBatch.dispose()` cancels its pending work, disposes every owned paragraph handle, releases their font leases,
removes the batch from future runtime revisions, and retires its canonical storage and target attachments. It does not
dispose the runtime or loaded fonts. `add()` and subscriptions on a disposed batch fail; `dispose()` remains idempotent.
Any snapshots required for recreation must be taken before disposal.

## Synchronize now

```ts
label.text = 'Ready for this frame';
body.contentBox = { width: { mode: 'at-most', size: 360 }, wrap: 'word' };

const revision = runtime.update();
```

```ts
interface TextRuntimeRevision {
  readonly revision: number;
  readonly paragraphBatches: readonly PreparedParagraphBatchRevision<AnyRasterTechnique, unknown>[];
}
```

`update()` snapshots every currently dirty paragraph across every paragraph batch in the runtime, performs the required
shaping and layout synchronously, updates prepared glyph batches, publishes one atomic runtime revision, and returns it.
When nothing is dirty it returns `runtime.current` without allocating or notifying subscribers.

Public `add()` and mutation methods reject invalid values, disposed handles, and technique incompatibility immediately.
All data required by synchronous shaping must also have been loaded already. Missing preparation data, fixed-capacity
overflow, or another preparation failure throws from `update()` before publication and leaves the prior revision current.

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

type TextPreparationError =
  | {
      readonly kind: 'capacity-exceeded';
      readonly batch: ParagraphBatch<AnyRasterTechnique, unknown>;
      readonly capacity: number;
      readonly required: number;
      readonly overflows: readonly GlyphCapacityOverflow[];
    }
  | {
      readonly kind: 'preparation-failed';
      readonly cause: unknown;
    };

interface GlyphCapacityOverflow {
  readonly resourceKey: GlyphBatchKey;
  readonly required: number;
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
type ParagraphDirtyChannel = 'text' | 'font' | 'features' | 'content-box' | 'paint' | 'origins' | 'order' | 'variant';
```

```ts
const WorkByChannel = {
  text: 'shape-layout-partition',
  font: 'shape-layout-partition',
  features: 'shape-layout-partition',
  'content-box': 'reflow-and-boundary-reshape',
  paint: 'rewrite-instance-paint',
  origins: 'rewrite-instance-origins',
  order: 'rebuild-glyph-runs',
  variant: 'rebuild-glyph-runs',
} as const;
```

Core keeps a dirty set rather than scanning every paragraph. Repeated writes to the same field coalesce. Paint, origin,
order, and render-variant changes do not reshape text.

## Core produces real glyph batches

One paragraph can resolve glyphs through several fonts. Those fonts use one technique but may bind different GPU
resources. Core partitions and packs them before the renderer sees the revision.

```ts
interface PreparedParagraphBatchRevision<Technique extends AnyRasterTechnique, Variant = undefined> {
  readonly paragraphBatch: ParagraphBatch<Technique, Variant>;
  /** Contiguous and monotonic within this paragraph batch. */
  readonly revision: number;
  readonly technique: Technique;
  readonly paragraphs: readonly PreparedParagraph[];
  readonly glyphBatches: readonly PreparedGlyphBatch<Technique>[];
  readonly glyphRuns: readonly PreparedGlyphRun<Variant>[];
}

interface PreparedGlyphBatch<Technique extends AnyRasterTechnique> {
  readonly key: GlyphBatchKey;
  readonly technique: Technique;
  readonly font: LoadedFont<Technique>;
  readonly chunk: number;
  readonly capacity: number;
  readonly instanceCount: number;
  readonly binding: RasterBindingOf<Technique>;
  readonly storage: GlyphBatchStorageOf<Technique>;
  readonly dirtyRanges: readonly GlyphRange[];
}

interface GlyphBatchKey {
  readonly technique: RasterTechniqueId;
  readonly resource: RasterResourceId;
  readonly pipelineVariant: number;
  readonly chunk: number;
}

interface PreparedGlyphRun<Variant = undefined> {
  readonly batch: GlyphBatchKey;
  readonly paragraph: ParagraphId;
  readonly renderVariant: Variant | undefined;
  readonly start: number;
  readonly count: number;
  readonly order: number;
}
```

Given the resolved font sequence `Inter -> Noto -> Inter`, core may retain one Inter buffer and one Noto buffer while
emitting three ordered glyph runs:

```ts
revision.glyphRuns = [
  { batch: interBatch.key, paragraph: label.id, renderVariant: plain, start: 0, count: 8, order: 0 },
  { batch: notoBatch.key, paragraph: label.id, renderVariant: warning, start: 0, count: 3, order: 1 },
  { batch: interBatch.key, paragraph: label.id, renderVariant: plain, start: 8, count: 5, order: 2 },
];
```

Core resolves batch → paragraph → span variant inheritance, then segments the ordered glyph sequence whenever the physical
batch, paragraph, or effective variant changes. The renderer does not inspect glyphs to rediscover technique,
raster-resource, capacity, source order, or variant boundaries. Each glyph batch also carries the technique-defined
`binding` that selects the required pages, buffers, or other decoded font data from `glyphBatch.font.data`.

`PreparedGlyphRun` is not a promised draw call. It is the smallest ordered core-authored range an integration may need to
classify. The target may split a run, or coalesce adjacent compatible runs, when compiling engine draws. It must preserve
the supplied order and compositing semantics unless its documented depth/blend policy proves another ordering equivalent.
It may not redo shaping, fallback, resource selection, or slot allocation.

Render variants remain on the calling thread. Async shaping workers receive shaping and layout inputs, not renderer
objects; after worker results return, core maps source clusters to the resolved variant before atomic publication. A
variant boundary does not split a shaping cluster or ligature. The cluster receives the variant of the span containing its
first UTF-16 code unit. Exact partial-ligature styling requires an authored shaping boundary or a shader masking technique.

## Core retains canonical instance storage

Core must retain paragraph input, shaping/layout results, glyph allocation metadata, shaped origins, and optional origin
overrides. It also owns one canonical packed CPU representation for each prepared glyph batch.

```ts
interface PreparedGlyphBatch<Technique extends AnyRasterTechnique> {
  readonly storage: GlyphBatchStorageOf<Technique>;
  readonly dirtyRanges: readonly GlyphRange[];
}
```

`dirtyRanges` is the coalesced delta from the immediately preceding revision of this paragraph batch. When a target has
that exact predecessor, it uploads only those ranges. A newly attached target, or a target whose committed
`sourceRevision` is older than that predecessor, initializes every range referenced by `glyphRuns`; those are the live
instance ranges for the current revision. It may coalesce overlapping or adjacent upload ranges without altering the
ordered run sequence.

The technique defines the canonical structure-of-arrays fields and writes changed slots into them. Those arrays are the
portable synchronization boundary. They remain available for multiple targets, late attachment, inspection, Worker result
integration, target recovery, and deterministic tests.

Published array contents remain readable until the next revision of that paragraph batch publishes. A target must consume
or copy its selected ranges during its synchronous `stage()` call; pending engine work cannot retain a canonical typed-array
view and read it after that call returns. Core can therefore reuse its CPU shadow without allocating an immutable full-buffer
snapshot for every publication.

On an adjacent revision, an integration synchronizes only `dirtyRanges`. When its engine layout matches, this is a direct
range copy or upload. When its layout differs, it maps only those canonical fields and ranges into its own interleaved or
technique-specific buffer. First and gapped synchronization use the live glyph-run ranges described above. The integration
still performs no shaping, source sorting, raster-resource partitioning, or slot allocation. It does compile the ordered
runs into its own minimum compatible draw sequence because only the integration knows its program, variant, pass, and
material compatibility.

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

Three.js applications use `FontLoader`, `TextGroup`, and `Text` from `@pmndrs/text-three`. That integration owns these core
objects privately and synchronizes them during Three's render lifecycle; it never asks an application to create core
paragraphs and wrap them in adapter objects.

See the authoritative [Three.js text API](three-api.md). The mapping is intentionally direct:

```ts
FontLoader -> cached TextRuntime/shaper initialization + loaded fonts
TextGroup  -> technique-specific ParagraphBatch + Three renderer target
Text       -> desired paragraph state + late-bound Paragraph + Object3D transform
```

## Implement another engine

The engine consumes already partitioned storage and ordered glyph runs:

```ts
for (const glyphBatch of revision.glyphBatches) {
  const gpuBatch = target.ensureBatch({
    key: glyphBatch.key,
    technique: glyphBatch.technique,
    font: glyphBatch.font,
    binding: glyphBatch.binding,
    capacity: glyphBatch.capacity,
    storage: glyphBatch.storage,
  });

  const ranges = isAdjacentTargetRevision
    ? glyphBatch.dirtyRanges
    : liveGlyphRunRanges(revision.glyphRuns, glyphBatch.key);
  gpuBatch.upload(ranges);
  gpuBatch.setCount(glyphBatch.instanceCount);
}

const draws = program.compileRuns(revision.glyphRuns, revision.glyphBatches);
for (const draw of draws) target.draw(draw);
```

Core owns shaping, fallback, layout, sorting, resource partitioning, slot allocation, overflow chunking, instance packing,
dirty ranges, and the ordered variant-bearing text runs. The engine owns compatible-run coalescing/splitting, final draw
planning, transforms, visibility, scene composition, GPU objects, render-pass placement, command encoding, frame
publication, fences, and resource retirement.

## Dispose

```ts
worldText.dispose();
overlayText.dispose();
inter.dispose();
runtime.dispose();
```

Dispose from the narrowest retained owner outward: paragraphs when individually finished, paragraph batches when a render
phase is finished, fonts after their paragraph leases are gone, and the runtime last. A successful dispose is idempotent;
using a disposed handle otherwise fails.

`TextRuntime.dispose()` is the one intentional cascade root. It cancels asynchronous preparation and unpublished staging,
disposes every remaining paragraph batch and paragraph, releases loaded fonts after those leases are gone, notifies
attachments, and disposes the runtime-owned registry, shaper, and Worker. It invalidates every handle created by that
runtime and does not publish another revision. Targets release GPU resources only after their engine knows no in-flight
frame still references them.

## Why these boundaries exist

```ts
const Decisions = {
  oneParagraphAPI: 'A label or icon is still a paragraph.',
  explicitBatchTechnique: 'The technique fixes canonical buffer layouts and rejects incompatible text before shaping.',
  fontStacksAreFonts: 'A FontStack is one ordered font selection with missing-glyph behavior.',
  explicitParagraphBatches: 'Only the application knows where text render phases must remain separate.',
  coreOwnedPhysicalBatching: 'Every target would otherwise duplicate grouping, sorting, packing, and dirty tracking.',
  handleOwnedMutation: 'Repeated writes debounce naturally before a synchronization call.',
  perUpdateScheduling: 'The same runtime must switch between immediate and Worker preparation.',
  canonicalCpuStorage: 'Targets synchronize adjacent deltas or live ranges from one stable portable representation.',
  orderedGlyphRuns: 'Fallback and render variants preserve source order without pretending every run is a draw.',
} as const;
```

The old public `createParagraphEngine()` path, runtime-wide sync/Worker mode, mutation callback passed to `update()`, mixed-
technique logical batch, and renderer-owned reshaping or physical glyph repartitioning are explicitly not part of this API.
