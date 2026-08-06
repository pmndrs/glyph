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

Three.js owns the core API internally. A Three.js application never creates a `TextRuntime`, `FontGroup`,
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

  readonly fonts: readonly LoadedFont<Technique>[];
  readonly fallback: readonly LoadedFont<Technique>[];
  readonly capacity: TextBatchCapacity;
  readonly textCount: number;
  readonly disposed: boolean;
  updateMode: 'sync' | 'async';

  allocate(properties: TextProperties<Technique>): Text<Technique>;
  has(text: Text<AnyRasterTechnique>): boolean;
  dispose(): void;
}

declare class Text<Technique extends AnyRasterTechnique> extends THREE.Object3D {
  constructor(properties: StandaloneTextProperties<Technique>);

  readonly textGroup: TextGroup<Technique> | undefined;
  readonly bound: boolean;
  readonly disposed: boolean;
  readonly layout: ParagraphLayout | undefined;

  font: LoadedFont<Technique>;
  text: string;
  spans: readonly TextSpan<Technique>[];
  contentBox: ParagraphContentBox;
  style: ParagraphStyle;
  paint: GlyphPaintInput;
  rasterPixelRatio: number;
  updateMode: 'sync' | 'async';

  set(properties: Partial<TextProperties<Technique>>): void;
  setSpan(index: number, span: TextSpan<Technique>): void;
  removeSpan(index: number): void;

  snapshotGlyphs(): GlyphSnapshot;
  setGlyphOrigins(update: GlyphOriginUpdate): void;
  clearGlyphOriginOverrides(): void;

  dispose(): void;
}
```

`TextGroup.updateMode` controls the hidden core update for every `Text` bound to that group. `Text.updateMode` applies only
while the object owns an implicit standalone batch. Both are mutable policies, not construction-time runtime choices.

## Load fonts with the Three.js loader

```ts
import { FontLoader } from '@pmndrs/text/three';
import { mtsdf } from '@pmndrs/text/raster/mtsdf';

const loader = new FontLoader();

const [inter, noto, icons] = await Promise.all([
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
  fonts: [inter, noto, icons],
  fallback: [inter, noto],
  capacity: {
    texts: 1_000,
    glyphs: 20_000,
    overflow: 'chunk',
  },
});

scene.add(worldText);
```

```ts
interface TextGroupOptions<Technique extends AnyRasterTechnique> {
  readonly fonts: readonly [LoadedFont<Technique>, ...LoadedFont<Technique>[]];
  readonly fallback?: readonly LoadedFont<Technique>[];
  readonly capacity?: TextBatchCapacity;
  readonly renderOrder?: number;
}

interface TextBatchCapacity {
  readonly texts?: number;
  readonly glyphs?: number;
  readonly overflow?: 'grow' | 'chunk' | 'error';
}
```

A `TextGroup` is one author-declared text render phase and one hidden core paragraph batch. Every font must use the same
technique. Fallback may cross fonts but never techniques. Core may produce several physical resource batches and ordered
draw submissions beneath one `TextGroup`.

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

## Allocate or add text

Allocate and attach in one call:

```ts
const body = worldText.allocate({
  font: inter,
  text: 'Fallback can resolve this paragraph through every font in the group.',
  contentBox: {
    width: { mode: 'at-most', size: 480 },
    wrap: 'word',
  },
});
```

Or create the transform-bearing object first and add it through the ordinary Three.js scene graph:

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

`allocate()` returns the same public `Text` type as `new Text()`. It is a convenience for immediate group binding, not a
second text lifecycle.

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
  font: inter,
  fallback: [noto],
  text: 'Standalone title',
});

scene.add(title);
```

```ts
interface StandaloneTextProperties<Technique extends AnyRasterTechnique> extends TextProperties<Technique> {
  readonly fallback?: readonly LoadedFont<Technique>[];
  readonly capacity?: Omit<TextBatchCapacity, 'texts'>;
}
```

When a `Text` has no `TextGroup` ancestor, it owns an implicit font group and paragraph batch containing only itself. Adding
that same object to a `TextGroup` destroys the implicit allocation and allocates the retained desired state in the group.
Removing it from the group recreates its implicit batch. The public `Text`, transform, desired properties, and glyph
overrides remain the same object.

The standalone `fallback` and `capacity` values configure only that implicit batch. While the object is inside a
`TextGroup`, the parent group's fonts, fallback order, capacity, overflow, and update policy are authoritative.

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

Membership is resolved before the first shaping call. `TextGroup.allocate()` binds immediately. `Object3D` `added`,
`removed`, `childadded`, and `childremoved` events mark scene membership dirty synchronously. Because those events do not
bubble through every arbitrary ancestor change, `Text` and `TextGroup` perform a final ancestry reconciliation at the start
of `updateMatrixWorld()`.

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
interface TextProperties<Technique extends AnyRasterTechnique> {
  readonly font: LoadedFont<Technique>;
  readonly text: string;
  readonly spans?: readonly TextSpan<Technique>[];
  readonly contentBox?: ParagraphContentBox;
  readonly style?: ParagraphStyle;
  readonly paint?: GlyphPaintInput;
  readonly rasterPixelRatio?: number;
}

interface TextSpan<Technique extends AnyRasterTechnique> {
  readonly start: number;
  readonly end: number;
  readonly font?: LoadedFont<Technique>;
  readonly style?: ParagraphStyle;
  readonly paint?: GlyphPaintInput;
}
```

`font` and every span font must belong to the effective batch. Changing `font` to another eligible same-technique font is a
retained update. Assigning an ineligible font throws without changing current desired or rendered state.

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
  fonts, // same-technique eligibility and fallback universe
  fallback, // fallback precedence
  capacity, // initial allocation and overflow policy
});
```

Changing them requires a new `TextGroup`. Existing `Text` objects can be added to that replacement because they bind late;
the objects themselves, their transforms, and desired state do not need to be recreated.

For standalone `Text`, `fallback` and `capacity` are likewise construction-only because they define the implicit batch.
The primary `font` is mutable only within the effective eligible font set; changing technique requires a replacement batch.
The renderer identity becomes fixed on first draw and is also structural. `renderOrder` and `updateMode` remain mutable
runtime policies.

### Retained changes that rebuild internal storage

These operations retain public objects but may allocate new internal glyph slots, chunks, attributes, or materials:

```ts
destination.add(text); // remove old paragraph allocation, add new allocation
text.font = anotherGroupFont; // reshape and possibly change physical resource batch
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

`Text.dispose()` permanently releases its current paragraph allocation and any implicit standalone batch. Removing a
`Text` from its parent does not dispose the public object because it may be added elsewhere. `TextGroup.dispose()` releases
its hidden paragraph batch, renderer-specific targets, materials, attributes, and subscriptions; it does not dispose loaded
fonts or child `Text` objects. `LoadedFont.dispose()` releases that loaded-font ownership after all groups using it are gone.
`FontLoader.dispose()` releases its cache-domain ownership; shared shaping state retires only after its final loader/font
owner is gone.

Renderer-specific GPU resources retire according to the renderer target's in-flight-frame rules. Disposal is idempotent.

## Required conformance cases

The implementation is not complete until tests prove:

- an unattached `Text` performs no shaping or GPU allocation;
- direct `scene.add(text)` renders through an implicit batch of one on its first render;
- `group.allocate()` and `group.add(new Text())` produce the same retained lifecycle;
- direct and nested descendants join the nearest `TextGroup`, while nested `TextGroup` boundaries do not merge;
- add/remove/reparent events plus pre-render ancestry reconciliation cannot leave stale or duplicate membership;
- moving a `Text` performs an atomic old allocation removal and new allocation creation without ghost glyphs;
- separate scenes use separate groups, and attempting to draw one group through a second renderer fails before submission;
- construction-only incompatibilities fail without mutating the current group;
- runtime setters coalesce and select the narrowest dirty work;
- default synchronous mode renders warm edits in the observing frame;
- asynchronous mode renders the last complete revision and treats stale work as a resolved superseded outcome;
- fallback fonts produce the core-authored minimum physical batches and exact ordered submissions;
- WebGPU and forced WebGL2 execute the same Bitmap, MTSDF, and Slug behavior on Three.js 0.185.1.
