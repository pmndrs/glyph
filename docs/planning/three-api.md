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
    resource: rust-layout-engine.md
    title: Rust text engine and render-plan ABI
  - id: current-loader
    resource: ../../packages/glyph/src/three/font-loader.ts
    title: Current Three.js font loader
  - id: current-text
    resource: ../../packages/glyph/src/three/text.ts
    title: Current Three.js Text lifecycle
  - id: current-material
    resource: ../../packages/glyph/src/three/material.ts
    title: Current Three.js material factory
  - id: three-object3d
    resource: https://threejs.org/docs/pages/Object3D.html
    title: Three.js Object3D
  - id: three-loader
    resource: https://threejs.org/docs/pages/Loader.html
    title: Three.js Loader
generated:
  by: openai-codex/gpt-5.6
  at: '2026-08-15T15:53:27Z'
---

# Three.js text API

`@pmndrs/glyph/three` is the maintained renderer integration. `Text` and `TextGroup` are Three.js `Object3D` subclasses;
scene traversal collects desired mutations, calls the Rust engine, consumes its render-plan command buffer, uploads dirty
ranges, and updates draw proxies.

```ts
import { FontLoader, Text, TextGroup, defineTextMaterial } from '@pmndrs/glyph/three';
import { bitmap } from '@pmndrs/glyph/three/bitmap';
import { msdf } from '@pmndrs/glyph/three/msdf';
import { slug } from '@pmndrs/glyph/three/slug';
```

Import only the technique modules an application uses. Each module registers the matching Three policy program and
material implementation.

## Load a font

```ts
const loader = new FontLoader();
const font = await loader.loadAsync({
  input: '/fonts/inter-msdf.font.glb',
  raster: {
    technique: msdf,
    options: {
      /* technique options */
    },
  },
});
```

`FontLoader` extends `THREE.Loader`, participates in its `LoadingManager`, and accepts an optional `AbortSignal` on the
request. Loaders sharing a manager share one Glyph engine domain. Disposing a loader releases its lease; loaded fonts
retain the backing they still need until their own disposal.

Source-font loading requires a caller-supplied runtime baker:

```ts
const loader = new FontLoader(undefined, { runtimeBake });
```

No runtime baker is pulled into the default Three bundle.

## Create text

```ts
const label = new Text({
  font,
  text: 'Hello world',
  style: { fontSize: 32, lineHeight: 1.2, language: 'en', color: '#ffffff' },
  layout: { wrap: 'word', overflow: 'clip' },
  constraints: { width: { mode: 'at-most', size: 420 } },
});

scene.add(label);
```

A standalone `Text` owns an implicit batch of one. It binds lazily on an explicit `measure()`/`glyphs()` query or
ordinary scene traversal; construction does not shape or allocate renderer buffers. A query may run while detached.

`Text` accepts either a plain string with explicit `spans`, or a formatted value built with `txt` and `span`. Span values
may override font selection, text style, and material.

## Batch text

```ts
const group = new TextGroup({
  capacity: { size: 4096, policy: 'grow' },
  compositing: 'ordered',
});

group.add(title, body, iconLabel);
scene.add(group);
```

All descendant `Text` objects that belong to the same runtime participate in one retained Rust engine session and one
render plan. Compatible Bitmap, MSDF, and Slug records may share backing storage while the plan emits the draw boundaries
required by technique, font resource, material, clipping, and compositing policy.

`compositing: 'ordered'` preserves authored draw order. `independent` allows Rust to reorder compatible work when the
application asserts that blending order is irrelevant.

Capacity policy controls the instance arena:

| Policy  | Behavior                                                                                   |
| ------- | ------------------------------------------------------------------------------------------ |
| `grow`  | Grow retained storage to fit the group.                                                    |
| `chunk` | Use bounded chunks when the group exceeds the initial size.                                |
| `fixed` | Keep the last accepted draw while desired text exceeds the declared pre-shape slot budget. |

`fixed` uses UTF-16 text length as a conservative pre-shape slot bound. Exceeding it is a requested renderer policy, not
an engine failure: traversal leaves the last complete draw live, `commitState()` stays `pending`, and `measure()` still
reports the desired paragraph. Shortening the text or increasing capacity is checked again on the next traversal, so
recovery does not depend on a latch or unrelated input churn (D-282).

The default group capacity is 4,096 glyphs with `chunk` policy. A standalone `Text` defaults to 256 glyphs with `grow`
policy. `setCapacity()` changes the retained capacity policy without changing text semantics.

## Update retained values

```ts
label.text = 'Updated';
label.style = { ...label.style, fontSize: 36, color: '#ffd166' };
label.layout = { wrap: 'word' };
label.constraints = { width: { mode: 'exact', size: 500 } };

label.set({ text: 'Final value', style: { color: '#ffffff' } });
```

Setters change desired state. The nearest `TextGroup` applies all pending descendant changes together on its next
`updateMatrixWorld()` traversal. Reassigning a value that normalizes to the current state is a no-op. Transform-only
changes update the transform buffer and do not reshape or recompose text.

One group traversal performs at most one mutating `pmndrs_glyph_engine_update` transaction for that group's pending
values. An earlier `measure()` query uses the non-publishing paragraph measurement call and retains a speculative batch
candidate; the traversal adopts matching work rather than repeating it.

Editor-style changes go through the same assignment. `label.text = next` states the string the paragraph now holds, and
the adapter derives its smallest common-prefix/common-suffix replacement without allocating a second scan buffer, so an
editor that keeps its own document sends one narrow UTF-16 edit per keystroke without describing the edit itself:

```ts
label.text = document.applyEdit(cursor, 'a');
label.set({ text: document.value, spans: document.spans });
```

Multiple assignments before traversal remain one Wasm call. An assignment cannot address the inside of a Unicode scalar,
so the replacement it derives is scalar-aligned by construction rather than by a range check.

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
const label = new Text({ font, text: 'abc', spans: [{ start: 0, end: 1, style: accent }] });
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

## Measure desired layout and inspect positioned glyphs

```ts
const summary = label.measure();
const glyphs = label.glyphs();
```

`measure()` synchronously requests an allocation-light `ParagraphLayoutSummary` for current desired state. A detached
`Text` uses its implicit standalone planner; a `Text` beneath a `TextGroup` uses that group's planner. The call does not
traverse matrices, realize materials or GPU resources, publish draws, or change `commitState()` from `pending` to
`committed`. Use the renderer-neutral `Paragraph` API when no Three object should exist.

Sequential `measure()` calls in one group extend a full desired-lifecycle speculative transaction. Each query applies
semantic mutations only for its paragraph; the first render traversal publishes the complete batch once and adopts the
prepared work. Repeating an unchanged measurement returns the retained result object without another Wasm crossing.

`glyphs()` is intentionally different: it positions current desired text and copies per-line and per-glyph arrays. It
still does not publish or realize renderer resources. Ordinary rendering never materializes either semantic view merely
to draw. Caret and selection lookup use renderer-accepted placement state and may return `undefined` while desired state
is pending or a renderer candidate was rejected.

The complete field semantics are defined by the [core layout-query reference](core-api.md#layout-query-values).

## Define a material

```ts
const material = defineTextMaterial((context) => {
  const value = context.createDefaultMaterial();
  // Customize the technique-specific TSL graph or material properties.
  return value;
});

const label = new Text({ font, text: 'Custom', material });
```

The factory is renderer-owned. Rust carries a numeric `materialId` through style resolution and draw planning; it does not
execute the factory. Three invokes `create()` when it needs a material for a concrete Bitmap, MSDF, or Slug pipeline.
Material creation runs while Three holds borrowed plan-backed attributes. It must return synchronously and must not query
or update text; the coordinator rejects such reentrancy before another Wasm call can detach those views.

`ThreeTextMaterialContext` is a discriminated union on `technique`. Each branch provides the concrete technique shader,
the final policy-selected position node, and `createDefaultMaterial()`.

A material on a span overrides the text material; a text material overrides the group material. Equal material objects
share identity. Different materials may still share instance buffers—the render plan determines draw segmentation, while
the Three executor decides which GPU resources can be shared safely.

## Mix fallback techniques

```ts
const prose = await loader.loadAsync({
  input: '/fonts/inter-msdf.font.glb',
  raster: { technique: msdf, options: {} },
});
const emoji = await loader.loadAsync({
  input: '/fonts/emoji-slug.font.glb',
  raster: { technique: slug, options: {} },
});

const font = createFontStack(prose, emoji);
const label = new Text({ font, text: 'Status 🌍' });
```

The font stack carries resource and technique identity. The user-facing text API does not repeat a technique selector.
Rust resolves missing-glyph fallback, and the render plan partitions the selected glyphs by the capabilities and resources
declared by the active Three policy.

## Break committed glyphs into an independent object

`breakApart()` copies the source paragraph's committed drawable records and any committed decoration draws into independently
owned groups. The copy is synchronous, is available only when `commitState().status === 'committed'`, and returns a frozen
two-entry tuple whose decoration slot is `undefined` when the paragraph has no decoration draws.

```ts
const [glyphs, decorations] = label.breakApart();
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

The planner emits a complete checkpoint for the selected committed stable glyph IDs. Three imports it through its normal
plan executor, preserving fallback techniques, atlas/resource relationships, supplied geometry, batching, and draw
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

Materials are cloned into each detached branch and exposed through `materials`; changing one cannot mutate the source
`Text` or its sibling detached branch. Immutable atlas/page GPU resources are leased from the existing Three engine domain
instead of uploaded again. Each returned object retains that domain until its own disposal, so the detached rendering may
outlive the source `Text`, `Font`, and `FontLoader`. The caller owns scene attachment, source visibility, animation,
physics bodies, reset timing, and disposal. Adding the returned groups to the source `Text` parent overlays them exactly
at creation.

Decorations have independent topology and lifetime. Core copies them through the separate
`RetainedText.copyDecorations()` planner request; Three coordinates that request with glyph copying but returns the
result separately in tuple slot two. The detached roots keep Three's default group order while their draw ranges preserve
the source boundary's under-decoration, glyph, then line-through paint order:

```ts
const [glyphs, decorations] = label.breakApart();
if (decorations !== undefined) {
  label.parent!.add(decorations);
  decorations.materials[0].opacity = 0.5;
  decorations.dispose();
}
glyphs.dispose();
```

`caretAt(x, y)` and `selectionRects(start, end)` remain read-only interaction helpers over accepted glyph extents. They
resolve to clusters, not JavaScript characters: a ligature is one glyph over several characters, and under bidi the
character after an offset can be drawn to its left.

The complete copy and ownership contract is recorded in
[Planner-assisted detached glyph slices](detached-glyph-slice.md).

## Ownership and disposal

- `Text.dispose()` unbinds the object and releases its font leases.
- `TextGroup.dispose()` releases the group session and GPU resources but does not dispose descendant `Text` objects.
- `LoadedFont.dispose()` releases font and raster resources after all text leases are gone.
- `FontLoader.dispose()` releases its claim on the manager-scoped runtime.

Dispose text objects before their loaded fonts. A disposed `TextGroup` can be removed while its still-live `Text` children
are moved into another group.

## React Three Fiber

`@pmndrs/glyph/react` exports `<Text>`, `<TextGroup>`, and `useFont`. Components preserve the Three ownership and batching
semantics above. Nested R3F `<Text>` values flatten into formatted spans; an outer text requires a font, while nested spans
may override it. The maintained renderer target is `@react-three/fiber/webgpu`, which inherits Three's WebGL fallback.

## Deliberately absent surfaces

There is no effects/variant API, JavaScript layout callback, public TypeGPU batch, or user-authored command parser in this
surface. Custom visual behavior uses `material`; renderer-directed batching uses the compiled Rust policy and render plan.
TypeGPU will be rebuilt against that plan in a later stack.
