---
type: API Specification
title: Three.js text API
description: Reference for loading fonts, batching Text objects, querying committed Rust layout, and defining Three.js materials.
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
  input: { baked: '/fonts/inter-msdf.font.glb' },
  raster: {
    technique: msdf,
    options: {
      /* technique options */
    },
  },
});
```

`FontLoader` extends `THREE.Loader`, participates in its `LoadingManager`, and accepts an optional `AbortSignal` on the
request. Loaders sharing a manager share one text runtime. Disposing a loader releases its runtime only after every font
loaded through that domain has also been disposed.

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
  style: { fontSize: 32, lineHeight: 1.2, language: 'en' },
  contentBox: {
    width: { mode: 'at-most', size: 420 },
    wrap: 'word',
    overflow: 'clip',
  },
  paint: { color: '#ffffff' },
});

scene.add(label);
```

A standalone `Text` owns an implicit batch of one. It binds lazily when attached to a traversed scene graph; construction
does not shape or allocate renderer buffers.

`Text` accepts either a plain string with explicit `spans`, or a formatted value built with `txt` and `span`. Span values
may override font selection, shaping style, paint, and material.

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

| Policy  | Behavior                                                    |
| ------- | ----------------------------------------------------------- |
| `grow`  | Grow retained storage to fit the group.                     |
| `chunk` | Use bounded chunks when the group exceeds the initial size. |

There is no non-resizing policy. A capacity cap could only be enforced after shaping, from inside `synchronize()` inside
`updateMatrixWorld()`, and `measure()` routes through the same path — so a caller could not ask how many glyphs the
content needs without already having exceeded the cap (D-267).

The default group capacity is 4,096 glyphs with `chunk` policy. A standalone `Text` defaults to 256 glyphs with `grow`
policy. `setCapacity()` changes the retained capacity policy without changing text semantics.

## Update retained values

```ts
label.text = 'Updated';
label.style = { ...label.style, fontSize: 36 };
label.contentBox = { width: { mode: 'exact', size: 500 }, wrap: 'word' };
label.paint = { color: '#ffd166' };

label.set({ text: 'Final value', paint: { color: '#ffffff' } });
```

Setters change desired state. The nearest `TextGroup` applies all pending descendant changes together on its next
`updateMatrixWorld()` traversal. Reassigning a value that normalizes to the current state is a no-op. Transform-only
changes update the transform buffer and do not reshape or recompose text.

One group traversal performs at most one mutating `pmndrs_glyph_engine_update` transaction for that group's pending values. Calling a
layout query with pending mutations may perform that synchronization earlier; the following traversal observes the
committed revision and does not repeat the semantic work.

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
const label = new Text({ font, text: 'abc', spans: [{ start: 0, end: 1, paint }] });
label.set({ text: 'ábc', spans: label.spans }); // 'a' and the mark are now one cluster spanning [0, 2)
label.spans; // [{ start: 0, end: 2, paint }] -- the mark joined the style of its base
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
scene traversal. A renderer-side failure leaves the Rust publication unconsumed; the next group traversal reapplies its
owned bytes before another engine delta is requested. There is no public `retry()`: `synchronize()` already replays an
unconsumed publication first, so a caller had nothing to do that the next frame did not (D-267).

## Query committed layout

```ts
const summary = label.measure();
const layout = label.layout();
```

`measure()` requests an allocation-light `ParagraphLayoutSummary`. `layout()` additionally copies per-line
and per-glyph semantic arrays. Neither query is part of the ordinary render plan, and rendering never materializes layout
arrays merely to draw.

Queries apply pending mutations for the containing group because the requested result must describe one coherent Rust
revision. Every paragraph updated by that transaction becomes reusable by the next render traversal. Repeating a query on
an unchanged committed layout returns the retained result object without another Wasm crossing.

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
  input: { baked: '/fonts/inter-msdf.font.glb' },
  raster: { technique: msdf, options: {} },
});
const emoji = await loader.loadAsync({
  input: { baked: '/fonts/emoji-slug.font.glb' },
  raster: { technique: slug, options: {} },
});

const font = createFontStack(prose, emoji);
const label = new Text({ font, text: 'Status 🌍' });
```

The font stack carries resource and technique identity. The user-facing text API does not repeat a technique selector.
Rust resolves missing-glyph fallback, and the render plan partitions the selected glyphs by the capabilities and resources
declared by the active Three policy.

## Directed glyph presentation

The cycle is snapshot, manipulate, restore.

```ts
const placements = label.snapshotGlyphs();
if (placements !== undefined) {
  // Units people animate, addressable directly.
  for (const [index, word] of placements.words.entries()) word.translate(0, Math.sin(index) * 4);
  const applied = label.applyGlyphs(placements);
  if (applied.applied !== applied.requested) reportUnmoved(applied.unapplied);
}
label.restoreGlyphs();
```

Placements are presentation-only: they never mutate authoritative Rust shaping or layout, and a semantic
text/style/geometry revision retires incompatible overrides. `applyGlyphs` refuses a snapshot whose layout the
paragraph has since replaced, because the identities in it no longer address the same glyphs.

Every position and box in a snapshot is in one stated space, `space: 'paragraph'`. `GlyphPlacement` carries the
shaped origin, the drawn position, the shaped advance, and the ink box; `GlyphRun` carries the advance box and the ink
box of a word or a line, and a line adds its baseline, ascent, and descent. `incomplete` names any glyph with no
retained render record — a space, ordinarily — whose position therefore cannot be read or written.

`GlyphKey` is the package's identity for a glyph: font, glyph id, cluster, and occurrence. It survives a reflow that
MOVES glyphs (content box, font size, anchor, pixel ratio) and deliberately not one that RESHAPES them (text, font,
language, direction, features). `placements.adopt(previous)` recovers each matching glyph's previous drawn position and
reports how many matched, so a caller never rebuilds the key itself.

`caretAt(x, y)` and `selectionRects(start, end)` are built on the same extents and resolve to clusters, not to
JavaScript characters: a ligature is one glyph over several characters, and under bidi the character after an offset can
be drawn to its left.

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
