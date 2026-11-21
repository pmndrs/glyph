---
type: API Specification
title: Three.js text API
description: Reference for loading fonts, batching Text objects, querying current Rust layout, and defining Three.js materials.
documentation_type: reference
tags: [api, threejs, fonts, text, batching, materials, layout]
status: stable
sources:
  - id: core-api
    resource: core-api.md
    title: Core text API
  - id: rust-engine
    resource: ../../../packages/glyph/rust/shaper/src/engine/state.rs
    title: Retained Rust text engine
  - id: current-font-face
    resource: ../../../packages/glyph/src/font-face.ts
    title: Current renderer-neutral FontFace lifecycle
  - id: current-text
    resource: ../../../packages/glyph/src/three/text.ts
    title: Current Three.js Text lifecycle
  - id: current-config
    resource: ../../../packages/glyph/src/three/schema.ts
    title: Current Three bindings, schema, and config types
  - id: current-react
    resource: ../../../packages/glyph/src/react.ts
    title: Current R3F handle injection
  - id: current-material
    resource: ../../../packages/glyph/src/three/material.ts
    title: Current Three.js material factory
  - id: msdf-shader
    resource: ../../../packages/glyph/src/shaders/tsl/msdf-shader.ts
    title: MSDF material shader output
  - id: three-object3d
    resource: https://threejs.org/docs/pages/Object3D.html
    title: Three.js Object3D
generated:
  by: openai-codex/gpt-6
  at: '2026-10-14T08:13:00Z'
---

# Three.js text API

## Held refactor contract

[Deferred, never-stale preparation](decisions/deferred-never-stale-preparation.md) governs when layout runs; it
supersedes the setter rule of the [retained preparation/publication decision](decisions/retained-prepare-publish.md),
whose remainder stands. A setter validates its input and marks the paragraph dirty; it does not enter the engine. A
read prepares that one paragraph on demand, so no read is stale. `glyph.shape()` (and a Three scene traversal)
batch-prepares every paragraph still dirty in one engine call, then publishes; `glyph.prepare()` does the first half
alone. Reads, copies and publication share one prepared revision.

`@pmndrs/glyph/three` is the maintained renderer integration. `Text` and `TextGroup` are Three.js `Object3D` subclasses;
scene traversal collects desired mutations, participates in root publication, consumes the resulting command buffer,
uploads dirty ranges, and updates draw proxies.

```ts
import { glyph } from '@pmndrs/glyph';
import { ThreeConfig, defineTextMaterial } from '@pmndrs/glyph/three';
import { bitmap } from '@pmndrs/glyph';
import { msdf } from '@pmndrs/glyph';
import { slug } from '@pmndrs/glyph';

await glyph.init();
const three = glyph.handle('main', ThreeConfig);
```

Import only the RasterFormat modules an application names explicitly. `ThreeConfig` already supports its built-in
Bitmap, MSDF, and Slug formats and realizes their Three materials.

`ThreeConfig` is the built-in config value. `defineThreeConfig({ transformMode, capacity })` creates an immutable variant.
Several named Three handles may coexist over the same loaded FontFace data while owning independent roots and renderer
state. Ordered physical storage is the only plan and is not a public option.

## Resolver, publication object, and actual rendering

Creating a Three handle needs no `WebGPURenderer`, scene, camera, canvas, rendering context, or `GPUDevice`.
`ThreeConfig.resolve()` converts authenticated portable payloads into retained Three JavaScript resource descriptions.
It does not call `device.create*`, configure a canvas, or submit work. Three's renderer-local managers perform those backend
operations later when an application's renderer encounters the committed objects.

Each Three root owns a private publication `Object3D`. During renderer commit, Glyph creates or reuses ordinary
`THREE.Mesh` values beneath that object. When a retained `Text` enters a scene, the publication object enters the same
scene as its sibling; several Text objects selected by one named root share that publication object. Material factories
receive it as `ThreeRootContext.renderObject`. Glyph prepares and attaches the renderer-owned object, but it does not draw
it:

```ts
const label = three.createText({ font, text: 'Hello' });
scene.add(label);

glyph.shape(); // one semantic flush publishes every dirty root
renderer.render(scene, camera); // Three traverses and actually submits those meshes
```

Each `WebGPURenderer` or `WebGLRenderer` is constructed with its own canvas and rendering backend in normal Three code.
Text instances do not create canvases, and a handle is not bound to one renderer. One anonymous or named Glyph root may
attach to at most one `THREE.Scene`; use distinct named roots for distinct scenes. A single `Object3D` still has only one
parent, per Three's ordinary hierarchy rules.

## Load a font

```ts
const inter = glyph.fontFace('/fonts/Inter.font.glb', {
  family: 'Inter',
  format: [msdf, bitmap({ strikes: [16, 32] }), slug],
});

const font = await inter.load(); // font === inter; all declared formats load in parallel
// Or load exactly one typed selection: await inter.slug.load();
```

The FontFace declaration is renderer-neutral and owns its load lease. Text creation synchronously acquires a separate
immutable `Font` lease from the selected loaded format. A string family uses the live FontFace catalog and the handle's
configured default format. If the selected format is not loaded, Text creation throws; React hooks suspend on the same
stable cached load Promise. Three's `LoadingManager` is not a font-ownership or handle boundary.

Passing a TTF or OTF source requests runtime baking; the baker remains a dynamically imported subpath and is not pulled
into the default Three bundle.

## Create text

```ts
const label = three.createText({
  font,
  text: 'Hello world',
  style: { fontSize: 32, lineHeight: 1.2, language: 'en', color: '#ffffff' },
  layout: { wrap: 'word', overflow: 'clip' },
  constraints: { width: { mode: 'at-most', size: 420 } },
});

scene.add(label);
```

A standalone `Text` belongs to the anonymous or named root that created it. It binds lazily on an explicit
`measure()`/`glyphs()` query or ordinary scene traversal; construction does not shape or allocate renderer buffers. A
query may run while detached, and it does not create another publication boundary.

`Text` accepts either a plain string with explicit `spans`, or a formatted value built with `txt` and `span`. Span values
may override font selection, text style, and material.

## Batch text

```ts
const group = three.createTextGroup({ batching: 'auto', renderOrder: 10 });

group.add(title, body, iconLabel);
scene.add(group);
```

All descendant `Text` objects under the group participate in its retained hierarchy and nearest root publication.
Compatible Bitmap, MSDF, and Slug records may share backing storage while the command buffer emits the draw boundaries
required by raster, font resource, material, and clipping policy.

`batching` controls where compatible records may share a physical draw without creating another semantic root:

| Value    | Boundary behavior                                                                                |
| -------- | ------------------------------------------------------------------------------------------------ |
| `auto`   | Default. A top-level authored `TextGroup` owns a boundary; nested automatic groups inherit it.   |
| `shared` | Joins the nearest authored boundary, or the implicit root pool when no authored boundary exists. |
| `group`  | Forces this group to own a nested boundary.                                                      |

Setting `visible = false` always hides descendants. When the group owns a boundary, Three also skips its draws while
retaining the same buffers and meshes. Use `shared` when cross-group draw coalescing matters more than draw-level group
culling.

A `Text` always batches its own spans. Inside a `TextGroup`, each child `Text.renderOrder` is the stable paragraph rank;
the adapter sends changed ranks and group-owned scope identities through a separate order sideband, while the ordinary
12-byte paragraph mutation retains only lifecycle identity and authored root order. Rust atomically permutes
only that scope's paragraphs into its existing root slots. Rust validates the complete final permutation in one
transaction; the adapter neither pre-sorts nor incrementally rejects rank swaps. Authored semantic traversal remains
separate from ranked draw traversal. The nearest
`TextGroup.renderOrder` remains the ordinary Three draw-mesh order of the shared publication object, and an ungrouped
`Text.renderOrder` remains the ordinary Three draw-mesh order of that Text's publication object. Applications such as
camera-facing label systems may calculate child ranks from camera distance in TypeScript, but the portable engine owns
applying those ranks to paragraph order, decoration paint layers, and coalesced glyph batches.

Draw order inside one paragraph follows the engine's fixed under-decoration, glyph-ink, and over-decoration paint layers.
Paragraph rank is not stored per glyph and is not a draw-key field, so multiple fonts, colors, and decorations can still
coalesce wherever their actual resource, material, and paint-layer keys agree.

Capacity belongs to `defineThreeConfig()`, not mutable TextGroup or handle methods. The policy controls
every anonymous or named root created by that handle:

```ts
const dense = glyph.handle(
  'dense',
  defineThreeConfig({
    capacity: { size: 16_384, policy: 'chunk' },
  }),
);
```

Capacity policy controls the instance arena:

| Capacity mode | Behavior                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------ |
| `grow`        | Grow retained storage to fit the group.                                                    |
| `chunk`       | Use bounded chunks when the group exceeds the initial size.                                |
| `fixed`       | Keep the last accepted draw while desired text exceeds the declared pre-shape slot budget. |

`fixed` uses UTF-16 text length as a conservative pre-shape slot bound. Exceeding it is a requested renderer policy, not
an engine failure: traversal leaves the last complete draw live, `commitState()` stays `pending`, and `measure()` still
reports the desired paragraph. Shortening the text or increasing capacity is checked again on the next traversal, so
recovery does not depend on a latch or unrelated input churn (D-282).

`ThreeConfig` defaults every root to 4,096-glyph chunks. To use another immutable policy, create
another handle from another config.

## Update retained values

```ts
label.text = 'Updated';
label.style = { ...label.style, fontSize: 36, color: '#ffd166' };
label.layout = { wrap: 'word' };
label.constraints = { width: { mode: 'exact', size: 500 } };

label.set({ text: 'Final value', style: { color: '#ffffff' } });
```

A setter validates its input, records it as the desired state and marks the paragraph dirty. It makes no engine call,
so it cannot fail for a layout reason: invalid input (a `NaN` size, an inverted range) throws a `GlyphInputError`
from the setter and the previous value stays. The error has `code: 'invalid-input'`, a `path` array naming the input
from the property the caller wrote (`['style']`, `['constraints']`, `['text', 'spans', 2, 'style']`; empty when the
properties are only invalid together) and the validator's `TypeError` or `RangeError` as `cause`. A text longer than
`maxTextUnits` is invalid input at `['text']`. `measure()`, `glyphs()`, `readGlyphs()`, `measureGlyphs()`, `split()`,
`boundingBox` and the caret helpers prepare that one paragraph first when a setter left it dirty, so a read is never
stale and never waits for `updateMatrixWorld()`. Constructing a `Text` is a setter: it enters the engine zero times.
Reassigning a value that normalizes to the current state is a no-op, a value overwritten before a read or a frame
never reaches the engine, and restoring the value the renderer already draws publishes nothing. A colour, opacity or
material change never runs layout. Transform-only changes update the transform buffer and do not reshape or recompose
text.

Lone surrogates are data, not an error: a string cut at a UTF-16 index carries them routinely. Each is laid out and
drawn as U+FFFD, one unit for one unit, so every offset stays where the caller put it. `text.text` returns the string
exactly as it was assigned, and the replacement has no public surface.

Call `glyph.shape()` to prepare whatever is still dirty and publish all dirty roots: one
`pmndrs_glyph_engine_prepare_batch` crossing for every dirty paragraph of every dirty root, then one
`pmndrs_glyph_engine_update_batch` crossing. Paragraphs a read already prepared are not prepared again, and a frame
with nothing dirty makes no crossing. Three scene traversal runs the same two steps before display-list realization
(see [The frame](#the-frame)). If no semantics are pending, `updateMatrixWorld()` uses only the cheap transform
synchronizer. Traversal retains an error on `Text`/`TextGroup`; explicit `glyph.shape()` throws a publication failure
at the call that requested it.

Call `glyph.prepare()` before reading many texts between frames: it batch-prepares every dirty text in one crossing,
keeps each one's measurement so the following `measure()` calls do not enter the engine, and publishes nothing. A loop
of reads without it costs one crossing per dirty text.

One root contributes at most one entry to each batch. The publication carries only lifecycle and order records and
compiles the exact preparation a read or the batch produced; it does not replay text, styles, geometry, or Unicode
work. A batch serializes a summary only for a paragraph someone will read: one with an anchor, or one whose previous
summary a caller read.

Paragraph base order remains part of that complete root publication. Reordering reused Scene siblings updates desired
orders one Text at a time, so preparation keeps each existing paragraph at its last Rust-installed order
and retains the desired order until traversal has reconciled the complete sibling set. A newly bound Text whose final
slot is temporarily occupied prepares at a creation-only free order. Neither preparation order is observable through
measurement or glyph reads; the gated final-set check and one publication install swaps, beginning insertions,
removal/reinsertion, and mixed content/order changes atomically.

Editor-style changes go through the same assignment. `label.text = next` states the complete string the paragraph now
holds. When the paragraph is next prepared, the host derives one UTF-16 range replacement against the text the engine
last prepared (the common prefix and suffix are dropped, and a boundary never splits a surrogate pair) and Rust drives
the same Unicode, shaping, wrapping, and positioning pipeline used for publication:

```ts
label.text = document.applyEdit(cursor, 'a');
label.set({ text: document.value, spans: document.spans });
```

Assignments before a read or a frame collapse into that one replacement, so a keystroke in a long paragraph sends a
request the size of the edit, in either direction. The wire record is `(start, deleteCount, insert)` in UTF-16 units;
it is not a public edit table. An editing session that knows its range would state it through the same record.

`text` and `spans` are authored together: stating `text` without `spans` clears the ranges it replaced, because
replacement text carries its own formatting and retaining the previous ranges would reinterpret them against unrelated
text. An editor that owns styled ranges therefore states both, and rebases its own offsets in its own document model,
where it knows what the edit meant. The library does not rebase ranges across a text change, and the offset-taking
helpers that once did (`insertText`, `deleteText`, `replaceText`, `setSpan`, `removeSpan`) have been removed: they let a
caller hand the engine an offset the tree API cannot express, and every one of them was reproducible with one
assignment.

### Span offsets resolve to grapheme clusters

The engine resolves exactly one style per extended grapheme cluster, so a span boundary is a cluster boundary. `Text`
settles that before a frame is built, and settles it constructively rather than by rejection (D-265):

> **A cluster takes the style of its base.** Every span boundary moves forward to the end of the cluster containing it,
> so the marks that attach to a base follow the base's style.

The rule has two entry points and the same answer at both. Nothing throws, and `text.spans` always reports the resolved
offsets.

**Offsets you author** reach it through the `spans` array, the one surface that carries raw numbers:

```ts
const accent = { color: '#ff0000' };
const label = three.createText({ font, text: 'abc', spans: [{ start: 0, end: 1, style: accent }] });
label.set({ text: 'ábc', spans: label.spans }); // 'a' and the mark are now one cluster spanning [0, 2)
label.spans; // [{ start: 0, end: 2, style: accent }] -- the mark joined the style of its base
```

**Boundaries the tree compilers derive** reach it at the concatenation join that created them. `txt`/`span` and nested
React `<Text>` compile a document that states no offsets at all, deriving each boundary where two fragments meet.
Concatenation can fuse the tail of one fragment with the head of the next into one cluster, and the join then names an
offset the finished text has no boundary at. Both compilers resolve their own joins against the text they produced, so
a document tree cannot compile to a paragraph the engine refuses:

```ts
txt`a${span({ color: '#ff0000' })`́b`}`;
// text  'áb' -- the base and the mark fused into one cluster spanning [0, 2)
// spans [{ start: 2, end: 3, ... }] -- the fused cluster keeps the style of its base, which is plain
```

The same document written as nested React elements compiles to the same pair. By the time either reaches
`alignSpansToClusters`, there is nothing left for it to move.

Forward is a policy, not arithmetic. Moving both boundaries backward preserves ordering and adjacency just as well;
forward is chosen because backward would take style away from a base you styled and never edited, handing the cluster to
a mark that attached to it. Both boundaries move the same way, so two spans meeting at one offset still meet.

A span that keeps no cluster of its own becomes an empty range and stays in the array. Removing the base between a
styled letter and a mark leaves that mark on the previous cluster, and the span it came from reports `[2, 2)` rather
than disappearing: the loss is visible, and every later span keeps the index it always had, so reading `text.spans` back
to compare it against what you authored lines up entry for entry. An empty span states nothing and reaches no engine
style.

Offsets outside the text are left exactly as given. Range validity is a separate rule with its own error, and clamping
an out-of-range offset would turn an arithmetic mistake into a plausible-looking style.

To derive cluster-aligned ranges yourself -- or to detect a shift instead of accepting one -- use the same function
`Text` uses. It returns its argument by identity when nothing moves:

```ts
import { alignSpansToClusters } from '@pmndrs/glyph/three';

const resolved = alignSpansToClusters(text, spans);
if (resolved !== spans) editor.reportOffsetsThatSplitACluster(resolved);
```

Errors are retained on `text.error` and the owning `group.error`, then forwarded to `onError`. They do not escape Three.js
scene traversal. A renderer-side failure leaves the last accepted draw state live and the error visible. Unchanged group
traversals do not retry it. Assigning new material or other renderer-relevant state requests a checkpoint from the last
accepted plan revision; malformed engine output remains a defect rather than a supported recovery state (D-285).

## The frame

A root keeps two private objects in the Scene that holds its text. `@pmndrs/glyph-prepare` is the Scene's first child:
Three visits it before any other object computes its matrix, and there the frame batch-prepares every dirty text and
runs layout callbacks. `@pmndrs/glyph:<root>` is the publication object: when the traversal reaches it, the frame
prepares whatever became dirty since and publishes. A scene with nothing dirty makes no engine call in either.

A root learns its Scene from the first traversal that reaches one of its texts. That traversal has already begun, so
the two objects are appended and that one frame prepares and publishes together at the publication object; the
preparation object moves to the front during the next traversal. `root.attach(scene)` names the Scene beforehand so the
first frame is prepared at the front like every later one. The React and Vue components call it.

A renderer traverses the Scene, calls `scene.onBeforeRender`, runs shadow and pass renders, then calls
`scene.onAfterRender`. A traversal that starts between those two belongs to a nested render: it synchronizes transforms
and neither prepares nor publishes.

`root.onInvalidate` runs when a setter leaves the root needing a frame. An on-demand render loop requests one there;
the React and Vue components wire it to their canvas.

### Layout callbacks

```ts
label.onLayout = (text, layout) => {
  panel.scale.set(layout.width + 24, layout.height + 16, 1);
};
```

`onLayout(text, layout)` receives the text and what `text.measure()` returns. It runs after the text is first prepared
and whenever that summary changes (width, height, line count, glyph count or anchor offset), in a phase after every
root is prepared and before anything is published. A colour, opacity, material or transform change is not a new
layout and does not run it, and neither does a read that prepares the text on demand. `glyph.prepare()` runs the
phase too, and the frame after it does not repeat a summary already handed over. A callback installed on text that is
already drawn receives the current layout in the next frame.

Inside the phase a callback may read any text and write transforms, visibility, colour, opacity and material; what it
paints is drawn by the same frame. Writing a layout input of any text throws `GlyphLayoutPhaseError` (`code:
'layout-phase'`) from that setter and the text keeps its value: a layout written there could not be laid out before
the frame it was meant for. `dispose()` is allowed. An exception thrown by a callback is reported to that text's
`onError` and the root's `onError` (or to the global error event when neither is set); the other callbacks still run
and the frame publishes.

A text with a callback is drawn only at a layout its callback has seen. A layout input written after the frame's
layout phase (from a later sibling's `updateMatrixWorld`, for example) keeps that text at its published revision for
this frame; the next frame runs its callback and draws it. Text without a callback is drawn by the frame that changed
it.

### Errors

| Failure                                                       | Where it surfaces                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------------ |
| A value a setter, `set()` or `createText()` cannot accept     | `GlyphInputError` thrown by that call; the previous value stays    |
| A layout input written inside a layout callback               | `GlyphLayoutPhaseError` thrown by that setter                      |
| A paragraph the engine refuses (memory, an input that traps)  | That text's `error` and `onError`, once; siblings publish as usual |
| A publication the renderer rejects, a fixed capacity exceeded | `text.error`/`group.error` and `onError` of the texts involved     |
| An engine trap during a frame                                 | The affected texts' `error` and `onError`; the next frame retries  |
| An exception thrown by a layout callback                      | That text's `onError`                                              |

`root.onError` also receives every failure in the last four rows, once per report, so one handler can observe a
root. It is assigned on the root (`handle.onError = …` for the anonymous root, `handle('hud').onError = …` for
a named one). GPU device loss is not detected by this package; the host observes `device.lost` and rebuilds.

## Measure desired layout and inspect positioned glyphs

```ts
const summary = label.measure();
const glyphs = label.glyphs();
```

`measure()` synchronously returns the allocation-light `ParagraphLayoutSummary` of the current desired state, preparing
the paragraph first when a setter left it dirty. A detached `Text` uses its implicit standalone planner; a `Text`
beneath a `TextGroup` uses that group's planner. The first read of a root also creates every sibling the engine has
not seen, so reading a freshly mounted group is linear in its labels. Later unchanged `measure()` calls make no Wasm
call, do not traverse matrices, realize materials or GPU resources, publish draws, or change `commitState()` from
`pending` to `committed`. `pending` therefore means "not yet published", whether or not the paragraph is prepared.

`glyphs()` copies per-line and per-glyph arrays from the current prepared positioned arena, while `readGlyphs()` borrows
only requested scalar records. Neither is a preparation trigger. Ordinary rendering consumes the same retained revision
without materializing a semantic inspection table merely to draw. Caret and selection lookup query desired layout;
pending or rejected publication does not change that query into the previously accepted layout. Renderer-derived glyph
origins are used only when that desired revision is committed; otherwise placement falls back to desired layout origins.

`computeBoundingBox()` requests positioned aggregate ink when it is unknown; a preceding allocation-light `measure()`
does not cache an empty box for visible text. Repeated bounds reads reuse known ink for the same desired revision.
Zero glyphs cache an empty Three box, and positioned whitespace can have a finite zero-height extent.

The complete field semantics are defined by the [core layout-query reference](core-api.md#layout-query-values).

Box references belong to constraints, independently of line alignment:

```ts
label.set({
  constraints: { width: { mode: 'exact', size: 320 }, anchor: { x: 'center', y: 'first-baseline' } },
  layout: { align: 'center' },
});
```

`measure()` and `glyphs()` retain unshifted paragraph coordinates. `anchorOffset` reports the placement translation in
+Y-down paragraph units. Three applies `(offset.x, -offset.y)` through the text's host transform, including local
rotation/scale; it does not modify `Text.position`. `boundingBox`/`computeBoundingBox()` and `measureGlyphs()` describe
anchored Text-local Three coordinates. Text's caret and selection helpers use anchored Text-local coordinates with
+Y down, as before; their returned rectangles include the same offset. `/core`'s lower-level `createGlyphPlacements()`
continues to describe unshifted paragraph coordinates. `split()` keeps the source object's local transform and pivot,
with the captured anchor applied once to its local content.

Use these coordinate-space names consistently:

- **Paragraph-local:** layout coordinates, +X right and +Y down, before anchoring; origin at the paragraph box top-left.
- **Text-local / Glyphs-local Three:** owner-local coordinates, +X right and +Y up, with anchoring included in the content.
  The owner's position, rotation, scale and ancestors are not applied. A split keeps the source Text's owner-local frame.
- **Logical Text-local:** the same anchored owner origin, +X right and +Y down, used by caret and selection APIs.
- **World:** owner-local coordinates after the owner and ancestor transforms. World conversion is optional for a sibling split.

The coordinate spaces are intentional and must not be mixed:

| Query                                                         | Coordinates                                                              | Anchor already applied?                 |
| ------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------- |
| `measure()`, `glyphs()`, `readGlyphs()`                       | Paragraph-local, +X right, +Y down                                       | No; `anchorOffset` is separate metadata |
| `Text.measureGlyphs()`, `boundingBox`, `computeBoundingBox()` | Text-local Three, +X right, +Y up                                        | Yes                                     |
| `caret()`, `hitTest()`, `move()`, `rangeRects()`              | Logical Text-local, +X right, +Y down                                    | Yes                                     |
| `Glyphs.measurements`, `getMatrixAt()`, `setMatrixAt()`       | Glyphs-local Three, +X right, +Y up; same frame as the source at capture | Yes                                     |
| `Glyphs.getWorldMatrixAt()`, `setWorldMatrixAt()`             | World, after owner and ancestors                                         | Yes                                     |

For a Text-local glyph measurement, multiply `originalMatrix` by the Text's `matrixWorld` to get its world transform;
do not add `anchorOffset` again. Raw paragraph inspection is lower-level: converting its coordinates to Three-local
space requires the anchor translation and a Y-axis conversion. `measure().firstBaseline` remains a distance from the
paragraph box top, not a world-space baseline position.

Anchor-only edits of an accepted paragraph update the host placement without waiting for an engine publication when
its effective presentation and order still match the accepted publication. Pending or rejected root/TextGroup material,
batching or order changes keep the previous draw/anchor together until acceptance, including presentation staged by an
inspection query before a render attempt. Semantic edits follow the same acceptance boundary. Ordinary Three object
motion and visibility continue to update the accepted branch using its accepted anchor. Desired measurement still
describes pending text. React and Vue forward the same constraints and retain the same shallow property-list rules.

## Define a material

```ts
const material = defineTextMaterial((context) => {
  const value = context.createDefaultMaterial();
  // Customize the raster-format-specific TSL graph or material properties.
  return value;
});

const label = three.createText({ font, text: 'Custom', material });
```

The factory is renderer-owned. Rust carries an internal material identity through style resolution and command-buffer construction; it does not
execute the factory. Three invokes `create()` when it needs a material for a built-in Bitmap, MSDF, Slug, or decoration
pipeline. A registered external `ThreeRasterProgram` owns its separate typed `createMaterial` contract.
Material creation runs while Three holds borrowed plan-backed attributes. It must return synchronously and must not query
or update text; the coordinator rejects such reentrancy before another Wasm call can detach those views.

`ThreeTextMaterialContext` is a closed discriminated union on `kind`. A glyph branch also carries the concrete
`pmndrs.bitmap`, `pmndrs.msdf`, or `pmndrs.slug` raster format. The decoration branch does not pretend that decoration is a
raster format. Every branch provides its concrete shader, the final Codec-selected position node, and
`createDefaultMaterial()`, so decoration can keep the built-in material or override it explicitly:

```ts
const material = defineTextMaterial((context) => {
  const value = context.createDefaultMaterial();
  if (context.kind === 'decoration') {
    value.colorNode = context.shader.color.mul(0.75);
  }
  return value;
});
```

Decoration paint still comes from the engine-authored text style. Underline, overline, and line-through spans are planned
as their own ordered batches and become separate Three draw objects with separate material instances. Reusing one factory
therefore unifies material selection without merging decoration geometry into the glyph draw or mutating the glyph
material.

A material on a span overrides the text material; a text material overrides the group material. Equal material objects
share identity. Different materials may still share instance buffers—the command buffer determines draw segmentation, while
the Three executor decides which GPU resources can be shared safely.

### MSDF distance fields

When `context.kind === 'glyph'` and `context.format === 'pmndrs.msdf'`, both `/three` and `/three/typegpu` expose
these `Node<'float'>` fields on `context.shader`:

| Field          | Meaning                                                                                                                 |
| -------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `fillDistance` | Corner-preserving signed distance from the median of the sampled RGB channels, minus 0.5.                               |
| `trueDistance` | Smooth signed distance from the sampled alpha channel, minus 0.5; suitable for glows and bevels.                        |
| `pixelRange`   | Render-target pixels per normalized distance unit, using the canonical derivative-based conversion with a minimum of 1. |

Both distances are negative outside, zero on the edge, and positive inside. They use normalized atlas distance units
in `[-0.5, 0.5]`; multiply by `pixelRange` for the screen-space distance used by antialiasing. The values come from the
half-texel-clamped base sample, before the coverage clamp and atlas-cell mask. `pixelRange` is computed per fragment;
it differs from the baker's constant range in atlas texels.

For example, the MSDF branch of a material factory can add a soft glow:

```ts
const pixels = context.shader.trueDistance.mul(context.shader.pixelRange);
const glow = smoothstep(-3, 0, pixels);
material.colorNode = mix(vec3(0, 0.5, 1), context.shader.color, context.shader.fillCoverage);
material.opacityNode = max(context.shader.opacity, glow.mul(0.35));
```

Here `max`, `mix`, `smoothstep`, and `vec3` come from `three/tsl`. The radius is in render-target pixels; choose the
corresponding physical radius when authoring in CSS pixels. Effects remain limited by the baked distance range and
glyph quad. Publishing the field does not enlarge either, so a wide glow can require a larger baked range.
Raw TypeGPU `msdfFragment()` and `msdfRenderDetailed()` expose the same three fields on `TypeGpuMsdfFragmentOutput`.

### Slug coverage at a coordinate

When `context.kind === 'glyph'` and `context.format === 'pmndrs.slug'`, both `/three` and `/three/typegpu` expose
`context.shader.coverageAt(coordinate)`. It evaluates the analytic integral behind `coverage` at any em-space
`Node<'vec2'>` the material computes (one unit per em, y up), returning fill coverage in `[0, 1]` before paint alpha.
`coverage` is `coverageAt(renderCoordinate)`.

To bend the letterform rather than the quad, compute where each fragment's ink came from, the inverse of the warp, and
integrate there:

```ts
const { renderCoordinate } = context.shader;
const source = renderCoordinate.add(vec2(sin(renderCoordinate.y.mul(12)).mul(0.03), 0));
material.opacityNode = context.shader.coverageAt(source);
```

Antialiasing follows the screen footprint of the coordinate passed, so a warp that stretches the outline softens its
edge. The footprint uses componentwise screen derivatives: it is a local approximation for smooth mappings, rather
than exact integration of a nonlinear pixel footprint. Sharp discontinuities, subpixel folds, and rapidly changing or
singular mappings can alias. Evaluate coverage outside divergent fragment control flow, as required by shader
derivatives. The quad is not enlarged: ink appears only where the glyph's quad is drawn. Each call is a whole integral, and
`/three` inlines each one, so a material reading both `coverage` and `coverageAt()` doubles its fragment shader and Three
renames the second copy's variables with a warning per name. Replacing `opacity` with `coverageAt()` drops paint alpha,
which the context does not expose separately. Raw TypeGPU hosts pass their own coordinate to `slugRender()`.

## Mix fallback raster formats

`createFontStack()` accepts already loaded immutable `Font` values in fallback order, including Fonts returned by the
React raster hooks. The stack carries resource and raster identity, so the user-facing Text API does not repeat a format
selector. Rust resolves missing glyphs and the command buffer partitions the selected glyphs by the capabilities and
resources declared by the active Three Codec.

## Attached glyph deformation (unshipped follow-up)

`Text.readGlyphs<Result>()` is the generic synchronous borrowed-layout read boundary and returns the callback's value.
The accepted D-356 design for an attached, index-addressed `Text.transformGlyphs()` mutation is deferred and is not part
of the current Three API; `Text` exposes neither `transformGlyphs()` nor `clearGlyphTransforms()` and carries no attached
matrix storage. A later, separately scoped implementation must prove Three and TypeGPU lifecycle, storage,
interaction-geometry, and performance behavior together. Use `split()` when the caller wants an independently
owned, already-shaped object whose existing per-glyph matrices can be manipulated outside the source Text lifecycle.

## Copy desired glyphs into an independent object

`split()` synchronously queries the desired paragraph and copies its drawable records and decoration draws into independently
owned groups, including before first render or after an unpublished edit. It leaves source publication pending and returns a frozen
two-entry tuple whose decoration slot is `undefined` when the paragraph has no decoration draws.

```ts
const [glyphs, decorations] = label.split();
label.parent!.add(glyphs); // sibling attachment preserves the source transform
if (decorations !== undefined) label.parent!.add(decorations);
label.visible = false;

const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();
const quaternion = new THREE.Quaternion();
const scale = new THREE.Vector3();
glyphs.getWorldMatrixAt(0, matrix);
matrix.decompose(position, quaternion, scale);
position.x += 1;
matrix.compose(position, quaternion, scale);
glyphs.setWorldMatrixAt(0, matrix);

glyphs.materials[0].opacity = 0.65;

glyphs.dispose();
decorations?.dispose();
label.visible = true;
```

The planner emits a complete checkpoint for the selected desired-layout stable glyph IDs. Three imports it through its normal
command-buffer executor, preserving fallback raster formats, atlas/resource relationships, supplied geometry, batching, and draw
ordering. It does not reconstruct one child `Text` per glyph and it does not install mutable overrides on the live
paragraph. The source continues shaping normally; later source publications cannot mutate the detached copy.

`Glyphs` follows the familiar instanced-mesh matrix surface. `getMatrixAt()` and `setMatrixAt()` use `Glyphs`-local
space; `getWorldMatrixAt()` and `setWorldMatrixAt()` bridge world-space physics through the root transform. Every method
reads or writes a complete affine matrix, so translation, quaternion rotation, scale, and depth are all supported.
`measurements` retains each original local matrix, local ink and advance bounds, anchor lookup, and the metric or supplied
geometry used by the renderer. It never traverses or caches scene ancestors. World-space callers update the `Glyphs`
root once, invert its `matrixWorld` once, and cross that boundary through `worldToLocalMatrix(inverse, world, target)`
plus `setMatrixAt()` for bulk writes. The convenience `setWorldMatrixAt()` remains correct for individual writes but
updates and inverts the ancestor chain on every call. These are rendering facts, not prescribed collision bodies.

The source Text and detached Glyphs use the same owner-local frame at capture. The detached roots copy the source
local transform and pivot exactly; local instance matrices and measurements already include the captured anchor.
Sibling attachment preserves initial glyph world transforms and subsequent identical group rotations/scales, including
beneath rotated, nonuniformly scaled ancestors. No world conversion or manual anchor offset is needed for this swap.
Adding `anchorOffset` to these local matrices would apply it twice. Reparenting into a different frame still requires
preserving world transforms explicitly; adding the detached root as a child of the source Text is not the sibling swap.

`Glyphs.measurements` is an original snapshot of Glyphs-local geometry and matrices. After per-glyph animation,
read `getMatrixAt()` or `getWorldMatrixAt()` for current transforms rather than treating the original snapshot as live.
For a swap of the source's currently visible renderer state, first require `label.commitState().status === 'committed'`.
A split of pending/rejected desired state intentionally copies the new desired layout, while the source can still draw
its previous accepted revision. Later source edits do not change the detached snapshot or its captured anchor.

Materials are cloned into each detached branch and exposed through `materials`; changing one cannot mutate the source
`Text` or its sibling detached branch. Immutable atlas/page GPU resources are leased from the existing Three engine domain
instead of uploaded again. Each returned object retains that domain until its own disposal, so the detached rendering may
outlive the source `Text` and caller-owned `Font` lease. The caller owns scene attachment, source visibility, animation,
physics bodies, reset timing, and disposal. Adding the returned groups to the source `Text` parent overlays them exactly
at creation.

Decorations have independent topology and lifetime. Core copies them through the separate
`RetainedText.copyDecorations()` planner request; Three coordinates that request with glyph copying but returns the
result separately in tuple slot two. The detached roots keep Three's default group order while their draw ranges preserve
the source boundary's under-decoration, glyph, then line-through paint order:

```ts
const [glyphs, decorations] = label.split();
if (decorations !== undefined) {
  label.parent!.add(decorations);
  decorations.materials[0].opacity = 0.5;
  decorations.dispose();
}
glyphs.dispose();
```

`caret(position)`, `hitTest(point)`, `move(position, direction, unit, goalX?)`, `boundary(position, unit)` and
`rangeRects(start, end)` are synchronous editing queries over the desired layout, answered by the engine in one call
each. Offsets are UTF-16 code units of the source text on the engine's grapheme boundaries; an offset that is not one
throws `TextOffsetError` and nothing is snapped. A position is `{ offset, affinity }`: `'upstream'` and
`'downstream'` differ at a soft wrap and at a bidi boundary. A caret can stand inside a ligature; a conjunct or an
emoji sequence is one unit. `replace(start, end, insert)` is the one edit: it validates its range the same way and
rebases spans so inserted text takes the style of the grapheme before it. Selection state, caret drawing and input
handling belong to the application.

`measure()`, `glyphs()`, `measureGlyphs()` and the editing queries can read current
desired layout before first render and after an unpublished edit. Repeated unchanged reads reuse cached preparation.
`split()` realizes an independent copy of that layout; neither interaction reads nor copying publish the source batch.
The next ordinary publication adopts matching preparation. [#299](https://github.com/pmndrs/glyph/pull/299) replaces
[#240](https://github.com/pmndrs/glyph/pull/240)'s forced-publication approach without changing these public signatures.

The complete copy and ownership contract is recorded in
[Planner-assisted detached glyph slices](detached-glyph-slice.md).

## Ownership and disposal

- `Text.dispose()` unbinds the object and releases its font leases.
- `TextGroup.dispose()` releases the group's private publication boundary and GPU resources but does not dispose descendant `Text` objects.
- `handle.dispose()` prevents new `Text`/`TextGroup` construction and releases its adapter domain after existing object leases end.
- `Font.dispose()` releases its caller-owned lease after all text leases are gone.
- `FontFace.dispose()` releases its declarative source lease without invalidating fonts already retained by text.

Dispose text objects before their loaded fonts. A disposed `TextGroup` can be removed while its still-live `Text` children
are moved into another group.

## React Three Fiber

`@pmndrs/glyph/react` exports `GlyphProvider`, `<Text>`, `<TextGroup>`, and `useFont`; exact format leaves export
`useBitmap`, `useMsdf`, and `useSlug`. Ordinary R3F uses one lazily
initialized built-in Three handle without configuration at each component:

```tsx
<TextGroup>
  <Text font={font}>Hello</Text>
</TextGroup>
```

Use a provider only when a subtree needs a previously created custom handle:

```tsx
<GlyphProvider handle={three}>
  <TextGroup>
    <Text font={font}>Hello</Text>
  </TextGroup>
</GlyphProvider>
```

`Text` and `TextGroup` never accept handle or root props. The adapter obtains both from one immutable React context: a
provider-selected value when present, otherwise the Canvas-local default root. That context is dependency injection, not
another runtime, and it does not own an engine, resolver, renderer, scene, canvas, publication boundary, or the supplied
handle's disposal. Remount the provider to select another handle and reconstruct its retained Three subtree. Nested R3F `<Text>` values flatten into formatted spans and create no
Three object of their own; an outer text requires a font, while nested spans may override it. React commit applies desired
properties in layout effects and calls R3F `invalidate()`. The subsequent Three scene traversal performs
`shape()`-equivalent publication or cheap transform synchronization before the host renderer builds its render list. The
maintained renderer target is `@react-three/fiber/webgpu`, which inherits Three's WebGL fallback.

While a `<Text>` is mounted, its root is joined to the canvas: the root is attached to the canvas Scene, a scheduler
job registered before `render` prepares dirty text and runs layout callbacks, and a setter that leaves the root
needing a frame calls the canvas `invalidate()`, so `frameloop="demand"` draws an imperative
`ref.current.text = …`. `<Text onLayout={(text, layout) => …}>` is the layout callback and `onError` the per-text
error handler.

A prop that is not valid input throws from the Text's setter while React commits. Without a boundary inside the
canvas that error unmounts the whole canvas. `<GlyphErrorBoundary fallback={…} onError={…}>` is a boundary to place
inside the canvas around Text: only the subtree it wraps is replaced by `fallback`, which is canvas elements, `null`,
or a function `(error, reset) => …` whose `reset` mounts the children again.

Fonts may be caller-owned `glyph.fontFace()` declarations passed directly to Text, hook-owned declarations returned by
`useFont` or a typed format hook, or provider aliases declared through `fontFaces`. All three use Glyph's one FontFace
resource graph; React retains only stable suspension identity and mounted Font leases. The complete ownership, preload,
retry, and cleanup rules are in [React font loading](../guides/react.md).

## Deliberately absent surfaces

There is no user-authored command parser and no callback that takes part in layout: `onLayout` observes a finished
layout and cannot change one. Custom visual behavior uses `material`; renderer-directed batching uses the compiled Codec and command buffer. TypeGPU consumes the same public
`GlyphConfig` contract through the example renderer.
