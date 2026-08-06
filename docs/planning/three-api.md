---
type: API Specification
title: Three.js text API
description: Canonical Three.js API for loading text fonts, declaring scene-local text batches, retaining transform-bearing Text objects, and synchronizing hidden core work inside the Three.js render lifecycle.
documentation_type: reference
tags: [api, threejs, fonts, text, batching, lifecycle, rendering]
status: stable
sources:
  - id: core-api
    resource: core-api.md
    title: Core text API
  - id: engine-contract
    resource: engine-integration-contract.md
    title: Engine integration contract
  - id: current-loader
    resource: ../../packages/text/src/loader.ts
    title: Current font loader
  - id: current-text
    resource: ../../packages/text/src/text.ts
    title: Current Three.js Text lifecycle
  - id: three-object3d
    resource: https://threejs.org/docs/pages/Object3D.html
    title: Three.js Object3D
  - id: three-loader
    resource: https://threejs.org/docs/pages/Loader.html
    title: Three.js Loader
  - id: three-group
    resource: https://threejs.org/docs/pages/Group.html
    title: Three.js Group
  - id: three-buffer-attribute
    resource: https://threejs.org/docs/pages/BufferAttribute.html
    title: Three.js BufferAttribute
generated:
  by: openai-codex/gpt-5.6
  at: '2026-08-06T17:05:36Z'
---

# Three.js text API

Three.js owns the core API internally. A Three.js application never creates a `TextRuntime`,
`ParagraphBatch`, `Paragraph`, prepared revision, or glyph submission.

```ts
FontLoader
  -> LoadedFont[]
  -> TextGroup                       // explicit batch for one scene render phase
  -> Text[]                          // transform-bearing Three.js objects
  -> renderer.render(scene, camera)  // membership, shaping, packing, and uploads synchronize here
```

## The complete public surface

```ts
import * as THREE from 'three/webgpu';
import type { FontSelection, FormattedText, TextInput } from '@pmndrs/text';

interface FontLoaderOptions {
  readonly runtimeBake?: RuntimeFontBake;
  readonly createWorker?: () => TextPreparationWorker;
}

declare class FontLoader extends THREE.Loader<LoadedFont<AnyRasterTechnique>, LoadedFontRequest<AnyRasterTechnique>> {
  constructor(manager?: THREE.LoadingManager, options?: FontLoaderOptions);

  load<Technique extends AnyRasterTechnique>(
    request: LoadedFontRequest<Technique>,
    onLoad: (font: LoadedFont<Technique>) => void,
    onProgress?: (event: ProgressEvent) => void,
    onError?: (error: unknown) => void,
  ): void;

  loadAsync<Technique extends AnyRasterTechnique>(
    request: LoadedFontRequest<Technique>,
    onProgress?: (event: ProgressEvent) => void,
  ): Promise<LoadedFont<Technique>>;

  dispose(): void;
}

interface LoadedFont<Technique extends AnyRasterTechnique> {
  readonly technique: Technique;
  readonly disposed: boolean;
  dispose(): void;
}

declare class TextGroup<Technique extends AnyRasterTechnique> extends THREE.Object3D {
  constructor(options: TextGroupOptions<Technique>);

  readonly technique: Technique;
  readonly capacity: GlyphBufferCapacity;
  readonly textCount: number;
  readonly disposed: boolean;
  updateMode: 'sync' | 'async';

  add<const Children extends readonly THREE.Object3D[]>(...children: CompatibleTextChildren<Technique, Children>): this;
  dispose(): void;
}

declare class Text<Technique extends AnyRasterTechnique> extends THREE.Object3D {
  constructor(properties: StandaloneTextProperties<Technique>);

  readonly textGroup: TextGroup<Technique> | undefined;
  readonly bound: boolean;
  readonly disposed: boolean;
  readonly layout: ParagraphLayout | undefined;

  font: FontSelection<Technique>;
  get text(): string;
  set text(value: TextInput<Technique>);
  spans: readonly TextSpan<Technique>[];
  contentBox: ParagraphContentBox;
  style: ParagraphStyle;
  paint: GlyphPaintInput;
  rasterPixelRatio: number;
  updateMode: 'sync' | 'async';

  set(properties: TextUpdate<Technique>): void;
  setSpan(index: number, span: TextSpan<Technique>): void;
  removeSpan(index: number): void;

  snapshotGlyphs(): GlyphSnapshot;
  setGlyphOrigins(update: GlyphOriginUpdate): void;
  clearGlyphOriginOverrides(): void;

  dispose(): void;
}

export { txt, span } from '@pmndrs/text';
export type { FormattedText, GlyphBufferCapacity, SpanFormat, SpanStyle, SpanTag, UnboundSpanTag } from '@pmndrs/text';
```

`TextGroup.updateMode` controls the hidden core update for every `Text` bound to that group. `Text.updateMode` applies only
while the object owns an implicit standalone batch. Both are mutable policies, not construction-time runtime choices.

## Load fonts with the Three.js loader

```ts
import { createFontStack } from '@pmndrs/text';
import { FontLoader } from '@pmndrs/text/three';
import { mtsdf } from '@pmndrs/text/raster/mtsdf';

const loader = new FontLoader();

const [inter, noto, iconFont] = await Promise.all([
  loader.loadAsync({
    input: { baked: '/fonts/Inter.font.glb' },
    raster: { technique: mtsdf },
  }),
  loader.loadAsync({
    input: { baked: '/fonts/NotoSans.font.glb' },
    raster: { technique: mtsdf },
  }),
  loader.loadAsync({
    input: { baked: '/fonts/Icons.font.glb' },
    raster: { technique: mtsdf },
  }),
]);

const uiFont = createFontStack(inter, noto);
```

The first load in a Three font-cache domain lazily creates the core shaping engine. Concurrent loads share that
initialization Promise, and later loaders in the same domain reuse the resolved shaper. The cache domain is integration-
owned; Three users do not construct a core registry or runtime. `loadAsync()` does not resolve until the font, selected
technique data, and synchronous shaper are ready. Loading remains an explicit application wait; shaping ordinary warm edits
does not become a readiness Promise.

The callback `load()` and Promise-returning `loadAsync()` follow the standard Three.js loader pattern and participate in the
provided `LoadingManager`. The loaded font is a Three-surface handle; it does not expose the hidden core runtime or core font
handle.

## Create an explicit batch with `TextGroup`

```ts
import { TextGroup } from '@pmndrs/text/three';

const worldText = new TextGroup({
  technique: mtsdf,
});

scene.add(worldText);
```

```ts
interface TextGroupOptions<Technique extends AnyRasterTechnique> {
  readonly technique: Technique;
  readonly capacity?: GlyphBufferCapacity;
  readonly renderOrder?: number;
}

interface GlyphBufferCapacity {
  readonly size: number;
  readonly policy: 'grow' | 'chunk' | 'error';
}
```

### Use the default or preallocate explicitly

An explicit `TextGroup` defaults to `{ size: 4_096, policy: 'chunk' }`. Storage is allocated lazily for each physical
font-resource buffer, so an empty group allocates no glyph arrays or GPU buffer. Text objects and their metadata are not
capacity-limited.

```ts
const denseText = new TextGroup({
  technique: mtsdf,
  capacity: { size: 20_000, policy: 'chunk' },
});
```

`size` counts glyph-instance slots per physical buffer, not texts and not total glyphs across the `TextGroup`. `chunk`
allocates another buffer without replacing published storage, `grow` transactionally replaces the full buffer with a
buffer whose capacity doubles until the pending glyphs fit, and `error` makes `size` a hard per-buffer limit. The readonly
`capacity` property exposes the normalized explicit or default value.

A `TextGroup` is one author-declared text render phase and one hidden core paragraph batch. Its technique fixes the
canonical instance layout, target implementation, and shader family before any text is attached. Every `Text` owns its
font selection, which must use that technique. Core may produce several physical resource batches and ordered draw
submissions beneath one `TextGroup`.

The `add()` override preserves normal `Object3D` children while conditionally rejecting any directly supplied
`Text<OtherTechnique>` tuple member. Runtime ancestry validation remains mandatory for JavaScript, React reconciliation,
and text nested below arbitrary containers.

`TextGroup` deliberately extends `THREE.Object3D`, not `THREE.Group`. Three carries the nearest real ancestor Group's
`renderOrder` through non-Group descendants as `groupOrder`; another Group would replace it, including with its default
value of `0`. The integration does not insert a hidden Group.

`TextGroup.renderOrder` is the secondary render-order base for the batch. The integration maps the core's ordered physical
submissions to consecutive native Three render orders beginning at that base. `Text.renderOrder` remains the paragraph
sorting value inside core; it cannot create a Three render-list boundary inside one GPU batch.

```ts
parent.renderOrder = 100;
parent.add(textGroup); // physical submissions use groupOrder 100

textGroup.renderOrder = 10; // physical submissions begin at secondary order 10
```

A nested `TextGroup` starts a new batch and render-order domain; it never joins its nearest outer `TextGroup`.

Create separate `TextGroup` instances when text belongs to different scenes, render phases, or renderer lifetimes:

```ts
const mainSceneText = new TextGroup(worldOptions);
const minimapSceneText = new TextGroup(minimapOptions);

mainScene.add(mainSceneText);
minimapScene.add(minimapSceneText);
```

One Three object can have only one parent, so one `TextGroup` cannot be present in two scenes simultaneously. The group binds
to the first renderer that draws it. Rendering it through a different renderer fails before drawing; create a separate
`TextGroup` so attributes, materials, upload ranges, fences, and retirement remain renderer-owned. Standalone implicit
batches follow the same rule.

## Add and remove text through the scene graph

```ts
import { Text } from '@pmndrs/text/three';

const label = new Text({
  font: inter,
  text: 'Player 1',
});

worldText.add(label);

label.position.set(0, 2, 0);
label.rotation.y = Math.PI / 4;
label.scale.setScalar(2);
```

There is no `TextGroup.allocate()` shortcut. Construction creates one retained, late-bound `Text`; inherited
`Object3D.add()` and `Object3D.remove()` are the only membership operations. Adding binds the object to the batch before
the next synchronization. Removing releases its internal paragraph membership without disposing the public object, so it
can be added elsewhere.

A `Text` joins its nearest `TextGroup` ancestor. Ordinary `Object3D` containers may appear between them. A nested
`TextGroup` stops membership discovery:

```ts
worldText.add(container);
container.add(label); // label still belongs to worldText

worldText.add(overlayText);
overlayText.add(icon); // icon belongs to overlayText, never worldText
```

## A standalone `Text` is a batch of one

```ts
const title = new Text({
  font: uiFont,
  text: 'Standalone title',
});

scene.add(title);
```

```ts
type StandaloneTextProperties<Technique extends AnyRasterTechnique> = TextProperties<Technique> &
  Readonly<{
    capacity?: GlyphBufferCapacity;
  }>;
```

When a render-attached `Text` has no `TextGroup` ancestor, it owns an implicit paragraph batch containing only itself. Its
required font selection supplies that implicit batch's technique. Adding that same object to a `TextGroup` retires the
implicit batch, validates its font selection against the explicit group technique, and creates new paragraph membership in
the group.

An unattached or detached `Text` remains unbound and owns no implicit batch. `textGroup.remove(text)` therefore leaves only
the reusable public object and desired state. Adding it directly to a scene later creates its implicit batch before that
scene's first shaping and render; adding it to another `TextGroup` creates membership there instead. The public `Text`,
transform, desired properties, and glyph overrides remain the same object throughout.

The standalone `capacity` value configures only that implicit batch and defaults to `{ size: 256, policy: 'grow' }` to
avoid reserving a full explicit-group chunk for every isolated label. While the object is inside a `TextGroup`, the parent
group's technique, capacity policy, and update policy are authoritative; the `Text` always retains its own font selection.

## Bind late; render on the first frame

Constructing an unattached `Text` stores desired state only. It creates no core paragraph, performs no shaping, allocates no
glyph slots, and creates no GPU object.

```ts
const score = new Text({ font: inter, text: '0' });

score.text = '1';
score.text = '2';
score.text = '3';

hudText.add(score);
renderer.render(scene, camera); // shapes and renders only "3"
```

Membership is resolved before the first shaping call. `Object3D` `added`, `removed`, `childadded`, and `childremoved`
events mark scene membership dirty synchronously. Because those events do not bubble through every arbitrary ancestor
change, `Text` and `TextGroup` perform a final ancestry reconciliation at the start of `updateMatrixWorld()`.

The required order is:

```ts
reconcileTextMembership();
applyPendingRemovalsAndAllocations();
synchronizeHiddenCore();
publishThreeDrawObjects();
super.updateMatrixWorld();
// Three.js then builds the render list and draws.
```

Three.js 0.185.1 calls `scene.updateMatrixWorld()` before render-list construction in both `WebGPURenderer` and
`WebGLRenderer`. Publishing before descendant traversal therefore makes newly attached resident text visible in that same
render call. No preparatory frame is required.

## Moving between batches is remove plus add

```ts
overlayText.add(label);
```

Three.js removes `label` from its old parent before adding it to `overlayText`. The integration responds by staging two core
operations:

```ts
oldParagraph.dispose();
const nextParagraph = overlayParagraphBatch.add(label.desiredState);
```

It does not move a core paragraph handle between batches. Pending removal and allocation publish in the same pre-render
synchronization, so the old batch cannot leave ghost glyphs while the new batch renders the object. Cached shaping and
layout may be reused when their inputs are unchanged, but the destination receives new batch slots.

The old paragraph slot and glyph instances belong to the old batch, not to `label`. Removal makes those slots reusable and
updates the old batch's logical counts and submissions. It does not dispose or shrink a shared buffer merely because one
text left. The old `TextGroup` retains that capacity until a later transactional replacement or `TextGroup.dispose()`.
The destination group owns any new physical storage it needs. Moving from a standalone implicit batch also retires that
text-owned target storage according to the renderer's in-flight-frame rules.

That standalone-to-group transition is transactional. The integration validates and stages destination membership first,
publishes the new complete group revision, then retires the previous implicit target only after no in-flight frame can use
it. It never destroys the old target first and risks a missing frame or unrecoverable destination failure.

Removal marks old membership dirty synchronously. Slot recycling and the updated submission list publish at the old
group's next render synchronization. If the old group remains visible, that synchronization occurs before Three builds the
next render list. If the entire group is removed and will never render again, the application disposes the group rather
than waiting for another synchronization.

Changing parents during an active Three.js traversal is unsupported, matching Three.js scene-graph expectations. Scene
membership changes must complete before `renderer.render()` enters world-matrix traversal.

## Three.js owns synchronization

```ts
renderer.setAnimationLoop(() => {
  renderer.render(scene, camera);
});
```

Applications do not call a core update and then copy the result into Three. Each standalone `Text` or explicit `TextGroup`
owns a hidden core runtime/batch coordinator. Its `updateMatrixWorld()` implementation coalesces every desired-state and
membership change, invokes the selected core update, publishes the resulting Three draw objects, and then continues normal
matrix traversal.

The default `updateMode` is `'sync'`:

```ts
worldText.updateMode = 'sync';
```

Warm edits are current in the render call that observes them. Switch the same group to asynchronous preparation without
recreating fonts, text objects, or runtime state:

```ts
worldText.updateMode = 'async';
```

Async mode starts at most one hidden update for the current desired-state snapshot and renders the last complete revision.
Newer edits remain dirty. A completed candidate publishes on the next render traversal; stale work cannot replace a newer
sync or async result. Loading and raster-page misses remain explicit readiness work owned by `FontLoader` and the loaded
font handle rather than being silently started as ordinary shaping.

## Change retained text at runtime

```ts
label.text = 'First value';
label.text = 'Second value';
label.text = 'Player 2';

label.contentBox = {
  width: { mode: 'at-most', size: 360 },
  wrap: 'word',
};
```

Those writes update desired state only. The parent batch shapes the final values once during its next render-loop
synchronization. Nested records are immutable replacement values; direct deep mutation is unsupported.

```ts
interface TextBaseProperties<Technique extends AnyRasterTechnique> {
  readonly font: FontSelection<Technique>;
  readonly contentBox?: ParagraphContentBox;
  readonly style?: ParagraphStyle;
  readonly paint?: GlyphPaintInput;
  readonly rasterPixelRatio?: number;
}

type TextContentProperties<Technique extends AnyRasterTechnique> =
  | Readonly<{
      text: string;
      spans?: readonly TextSpan<Technique>[];
    }>
  | Readonly<{
      text: FormattedText<Technique>;
      spans?: never;
    }>;

type TextProperties<Technique extends AnyRasterTechnique> = TextBaseProperties<Technique> &
  TextContentProperties<Technique>;

type TextUpdate<Technique extends AnyRasterTechnique> =
  | (Partial<TextBaseProperties<Technique>> &
      Readonly<{
        text?: string;
        spans?: readonly TextSpan<Technique>[];
      }>)
  | (Partial<TextBaseProperties<Technique>> &
      Readonly<{
        text: FormattedText<Technique>;
        spans?: never;
      }>);

interface TextSpan<Technique extends AnyRasterTechnique> {
  readonly start: number;
  readonly end: number;
  readonly font?: FontSelection<Technique>;
  readonly style?: ParagraphStyle;
  readonly paint?: GlyphPaintInput;
}
```

`font` and every span font must match the effective batch technique. Changing `font` to another same-technique `Font` or
`FontStack` is a retained update. Assigning an incompatible selection throws without changing current desired or rendered
state.

## Compose typed spans

The Three entry point re-exports core's renderer-neutral `txt` and `span` tags. It does not add formatting methods to the
`Text` class or parse a markup language.

```ts
import { Text, span, txt } from '@pmndrs/text/three';

const emphasis = span(noto, { color: '#ffddff' });

const label = new Text({
  font: uiFont,
  text: txt`Fast ${emphasis`accurate`} text`,
});

label.text = 'Plain text';
label.text = txt`Player ${span(noto)`Two`}`;
```

`txt` returns one immutable typed literal containing the flattened string and computed UTF-16 spans. `span()` accepts a
style by itself, or a `Font` / `FontStack` followed by styles and same-technique font overrides, merging left to right into
a reusable typed tag. TypeScript validates fonts, style and paint fields, property names, and technique. Assignment of a
plain string clears spans, while assignment of a literal replaces text and spans atomically. Explicit `spans`, `setSpan()`,
and `removeSpan()` remain the lower-level imperative form.

React Three Fiber uses the same composer internally:

```tsx
<Text font={uiFont}>
  Fast <Text font={noto}>accurate</Text> text
</Text>
```

The nested React form and `txt` literal above must produce the same source string and span ranges. A nested React `<Text>`
is inline paragraph data; `label.add(new Text(...))` remains an ordinary spatial Three child and a separate paragraph.

Three-native state remains Three-native:

```ts
label.position.x += 1;
label.visible = false;
label.layers.set(2);
label.renderOrder = 10;
```

Transforms never reshape. `Text.renderOrder` maps to the paragraph ordering value inside the effective batch. Visibility,
layers, and transform changes update instance visibility/transform storage without changing shaping. `TextGroup.renderOrder`
sets the secondary Three render-order base for the batch's ordered physical submissions. The nearest real Three Group owns
their primary `groupOrder`.

## Structural, rebuilding, and hot changes

### Construction-only batch identity

These values define compatibility and have no setters:

```ts
new TextGroup({
  technique, // canonical instance layout, target, and shader family
  capacity, // physical glyph-buffer size and overflow policy
});
```

Changing them requires a new `TextGroup`. Existing `Text` objects can be added to that replacement because they bind late;
the objects themselves, their transforms, and desired state do not need to be recreated.

For standalone `Text`, `capacity` is likewise construction-only because it defines the implicit batch. Its font selection
is mutable; changing technique rebuilds the implicit batch. Inside an explicit `TextGroup`, changing to a different
technique is rejected and requires moving the retained `Text` to a compatible group.
The renderer identity becomes fixed on first draw and is also structural. `renderOrder` and `updateMode` remain mutable
runtime policies.

### Retained changes that rebuild internal storage

These operations retain public objects but may allocate new internal glyph slots, chunks, attributes, or materials:

```ts
destination.add(text); // remove old paragraph allocation, add new allocation
text.font = anotherFont; // reshape and possibly change physical resource batch
text.spans = nextSpans; // reshape and possibly change font-resource submissions
text.rasterPixelRatio = next; // select resources and rebuild affected target storage
```

Glyph overflow follows the owning group's `grow`, `chunk`, or `error` policy. All fallible replacement work stages before
publication; failure preserves the last complete revision.

### Hot retained changes

These never recreate the `Text` or `TextGroup`:

```ts
text.text = nextText;
text.contentBox = nextContentBox;
text.style = nextStyle;
text.paint = nextPaint;
text.renderOrder = nextOrder;
text.position.copy(nextPosition);
text.visible = nextVisible;
text.setGlyphOrigins(nextOrigins);
```

Dirty channels determine whether the hidden update shapes, reflows, rewrites paint/origins/transforms, or only rebuilds the
submission plan.

## Manual glyph motion

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
```

Clear overrides to return to shaped positions:

```ts
label.clearGlyphOriginOverrides();
```

The next Three render-loop synchronization writes the changed origins without reshaping. Later content changes may reshape
the authoritative targets; the application can snapshot again and interpolate from its current displayed values.

## Dispose ownership explicitly

```ts
label.dispose();
worldText.dispose();
inter.dispose();
noto.dispose();
loader.dispose();
```

`remove()` changes membership; `dispose()` ends ownership. Use the explicit destroy sequence when a text will never be
reused:

```ts
label.removeFromParent();
label.dispose();
```

`Text.dispose()` is idempotent and permanent. It releases the current core paragraph membership, renderer-neutral cached
state, and any implicit standalone batch and target. It does not dispose explicit-group buffers or loaded fonts, and it
does not mutate the caller-owned scene graph; a disposed object still parented in Three is skipped but remains referenced
until the caller removes it. When grouped, disposal stages the same old-membership cleanup as `remove()` and the group
publishes that cleanup before its next render. When already detached and unbound, disposal still cancels pending work,
clears retained shaping/layout state and font references, marks the object permanently disposed, and prevents future
attachment. Mutating or adding a disposed `Text` throws.

`TextGroup` owns its hidden paragraph batch, canonical batch storage, renderer-specific targets, materials, attributes,
and subscriptions. Removing a child only frees/recycles logical slots inside those shared resources. `TextGroup.dispose()`
permanently releases the group-owned resources, but does not dispose or remove child `Text` objects; callers may remove
those retained children and add them to a live compatible group.

`LoadedFont.dispose()` releases that loaded-font ownership only after every `Text` or `FontStack` using it is gone;
`FontStack` itself owns no lifecycle and cannot keep a disposed concrete font valid. `FontLoader.dispose()` releases its
cache-domain ownership; shared shaping state retires only after its final loader/font owner is gone.

Renderer-specific GPU resources retire according to the renderer target's in-flight-frame rules. Disposal is idempotent.

## Required conformance cases

The implementation is not complete until tests prove:

- an unattached `Text` performs no shaping or GPU allocation;
- direct `scene.add(text)` renders through an implicit batch of one on its first render;
- `TextGroup` exposes no duplicate creation or allocation shortcut; `new Text()` plus ordinary `add()` is the only explicit-group path;
- direct and nested descendants join the nearest `TextGroup`, while nested `TextGroup` boundaries do not merge;
- a detached `Text` owns desired state but no paragraph batch or GPU resources, and direct scene attachment creates its implicit batch before first render;
- add/remove/reparent events plus pre-render ancestry reconciliation cannot leave stale or duplicate membership;
- moving a `Text` performs an atomic old allocation removal and new allocation creation without ghost glyphs;
- removing one text recycles its slots without shrinking or disposing shared group buffers;
- disposed text rejects mutation and attachment, text disposal does not dispose group/font resources, and group disposal does not dispose child text/fonts;
- separate scenes use separate groups, and attempting to draw one group through a second renderer fails before submission;
- construction-only incompatibilities fail without mutating the current group;
- runtime setters coalesce and select the narrowest dirty work;
- default synchronous mode renders warm edits in the observing frame;
- asynchronous mode renders the last complete revision and treats stale work as a resolved superseded outcome;
- a same-technique `FontStack` produces the core-authored minimum physical batches and exact ordered submissions;
- mixed-technique group additions and font stacks fail before shaping without replacing live text;
- font-bound, font-stack-bound, style-only, reusable-tag, and readonly-tuple `span()` forms normalize identically, while mixed-technique format lists fail;
- `txt`/`span`, explicit spans, and nested React `<Text>` produce the same UTF-16 source/span snapshot;
- WebGPU and forced WebGL2 execute the same Bitmap, MTSDF, and Slug behavior on Three.js 0.185.1.
