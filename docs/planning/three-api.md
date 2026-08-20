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
| `fixed` | Reject an update that exceeds the declared capacity.        |

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

For editor-style changes, use UTF-16 ranges instead of rebuilding or diffing the paragraph in application code:

```ts
label.insertText(cursor, 'a');
label.deleteText(selectionStart, selectionEnd);
label.replaceText(selectionStart, selectionEnd, pastedText);
```

These operations update the ordinary `text` value and queue narrow replacements for the same next-frame transaction.
Multiple operations before traversal remain one Wasm call. Direct `label.text = next` remains the simple declarative API;
the adapter derives its smallest common-prefix/common-suffix replacement without allocating a second scan buffer.
Offsets match JavaScript and DOM selection APIs and cannot split a surrogate pair. Existing spans shift with edits;
inserted text inherits a span only when inserted strictly inside it, so span-boundary affinity does not become hidden
mutable state.

Errors are retained on `text.error` and the owning `group.error`, then forwarded to `onError`. They do not escape Three.js
scene traversal. A renderer-side failure leaves the Rust publication unconsumed; `retry()` or the next group traversal
reapplies its owned bytes before another engine delta is requested.

## Query committed layout

```ts
const summary = label.measureLayout();
const layout = label.inspectLayout();
```

`measureLayout()` requests an allocation-light `ParagraphLayoutSummary`. `inspectLayout()` additionally copies per-line
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

```ts
const snapshot = label.snapshotGlyphOrigins();
if (snapshot !== undefined) {
  const x = snapshot.shapedX.slice();
  x[0] += 4;
  label.setGlyphOrigins({ layout: snapshot.layout, x, y: snapshot.shapedY });
}
```

Origin overrides are presentation-only. They use stable glyph identities from the inspected layout and never mutate
authoritative Rust shaping or layout. A semantic text/style/geometry revision retires incompatible overrides.
`clearGlyphOriginOverrides()` restores shaped positions.

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
