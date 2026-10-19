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
  at: '2026-10-13T18:42:06Z'
---

# Three.js text API

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

Setters change desired state. The owning root gathers all pending descendant changes on its next
`updateMatrixWorld()` traversal. Reassigning a value that normalizes to the current state is a no-op. Transform-only
changes update the transform buffer and do not reshape or recompose text.

Call `glyph.shape()` to synchronously publish all dirty roots in one Rust/Wasm crossing instead of crossing once per
TextGroup or named root. Three scene traversal also participates in publication before display-list realization. If no
semantics are pending, `updateMatrixWorld()` uses only the cheap transform synchronizer. Traversal retains an error on
`Text`/`TextGroup`; explicit `glyph.shape()` throws a publication failure at the call that requested it.

One root traversal contributes at most one entry to the mutating `pmndrs_glyph_engine_update_batch` transaction for that
root's pending values. An earlier `measure()` query uses the non-publishing paragraph measurement call and retains a speculative batch
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

## Measure desired layout and inspect positioned glyphs

```ts
const summary = label.measure();
const glyphs = label.glyphs();
```

`measure()` synchronously requests an allocation-light `ParagraphLayoutSummary` for current desired state. A detached
`Text` uses its implicit standalone planner; a `Text` beneath a `TextGroup` uses that group's planner. The call does not
traverse matrices, realize materials or GPU resources, publish draws, or change `commitState()` from `pending` to
`committed`. An explicit call intentionally pays one synchronous one-Text engine query, which is suitable for Yoga/uikit
measurement without introducing a second renderer-free retained runtime.

Sequential `measure()` calls in one group extend a full desired-lifecycle speculative transaction. Each query applies
semantic mutations only for its paragraph; the first render traversal publishes the complete batch once and adopts the
prepared work. Repeating an unchanged measurement returns the retained result object without another Wasm crossing.
The root may park one preceding detached controller outside active publication membership, so alternating two detached
queries preserves both semantic caches while only the explicitly queried Text remains bound. A third distinct detached
query or an ordinary scene publication evicts that bounded slot.

`glyphs()` is intentionally different: it positions current desired text and copies per-line and per-glyph arrays. It
still does not publish or realize renderer resources. Ordinary rendering never materializes either semantic view merely
to draw. Caret and selection lookup also query desired layout; pending or rejected publication does not change that
query into the previously accepted layout. Renderer-derived glyph origins are used only when that desired revision is
committed; otherwise placement falls back to desired layout origins.

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
| `caretAt()`, `caretForOffset()`, `selectionRects()`           | Logical Text-local, +X right, +Y down                                    | Yes                                     |
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
raster format. Every branch provides its concrete shader, a paragraph-local position node, the final Codec-selected
position node, and
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

`context.paragraphPosition` is in unanchored paragraph-local Three coordinates (+X right, +Y up), before per-glyph and
Text/ancestor transforms. It pairs with `label.glyphs().inkBounds` after changing the bounds' Y-down axis to Y-up.
`context.position` is the final draw-local position sent to `material.positionNode`; it must not be normalized against raw
paragraph bounds or the Text-local `computeBoundingBox()` result. In indexed mode the Text/ancestor transform is applied
inside this node, while in direct mode it remains on the draw mesh's matrix. Its numeric value can therefore differ
between modes for the same world-space glyph. Use `paragraphPosition` for effects that must track a paragraph in both
modes. Both position nodes are computed in the vertex stage.
Reading either in a fragment expression receives its interpolated value, including for Slug, whose position graph also
publishes the analytic coverage coordinate. Keep the same node when reading it more than once; the renderer realizes one
vertex varying for that node. The default material keeps the raw vertex position graph so TypeGPU-backed Bitmap and
decoration shaders retain their vertex builtins on WebGL2. A displacement must still assign `material.positionNode` in
the vertex stage:

```ts
const material = defineTextMaterial((context) => {
  const value = context.createDefaultMaterial();
  if (context.kind !== 'glyph' || context.format !== 'pmndrs.slug') return value;
  const position = context.position;
  value.positionNode = position.add(vec3(position.y.sin().mul(0.12), 0, 0));
  value.colorNode = context.shader.color.mul(position.x.sin().mul(0.2).add(0.8));
  return value;
});
```

Here `vec3` comes from `three/tsl`. The colour expression reads an interpolated coordinate; it does not rerun Slug's
vertex dilation in the fragment shader. For a texture across a paragraph, query its desired bounds before material
realization, give that Text its own material, and normalize the paragraph position in the same space:

```ts
const label = three.createText({ font, text: 'Custom' });
const bounds = label.glyphs().inkBounds; // paragraph-local, +Y down
if (bounds !== undefined && bounds.width > 0 && bounds.height > 0) {
  const bottom = -(bounds.y + bounds.height);
  label.material = defineTextMaterial((context) => {
    const value = context.createDefaultMaterial();
    const position = context.paragraphPosition;
    const uv = vec2(position.x.sub(bounds.x).div(bounds.width), position.y.sub(bottom).div(bounds.height));
    value.colorNode = texture(image, uv).rgb.mul(context.shader.color);
    return value;
  });
}
```

Here `vec2` and `texture` come from `three/tsl`, and `image` is a caller-owned Three texture. Refresh the bounds and
material when desired text/layout changes; a shared material cannot carry a different paragraph extent for each Text.
The factory itself must not call `glyphs()` because material realization holds borrowed plan data.

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

`caretAt(x, y)` and `selectionRects(start, end)` remain synchronous interaction helpers over desired glyph extents, using accepted renderer origins when current. They
resolve to clusters, not JavaScript characters: a ligature is one glyph over several characters, and under bidi the
character after an offset can be drawn to its left.

`measure()`, `glyphs()`, `measureGlyphs()`, `caretAt()`, `caretForOffset()`, and `selectionRects()` can read current
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

Fonts may be caller-owned `glyph.fontFace()` declarations passed directly to Text, hook-owned declarations returned by
`useFont` or a typed format hook, or provider aliases declared through `fontFaces`. All three use Glyph's one FontFace
resource graph; React retains only stable suspension identity and mounted Font leases. The complete ownership, preload,
retry, and cleanup rules are in [React font loading](../guides/react.md).

## Deliberately absent surfaces

There is no JavaScript layout callback or user-authored command parser in this surface. Custom visual behavior uses
`material`; renderer-directed batching uses the compiled Codec and command buffer. TypeGPU consumes the same public
`GlyphConfig` contract through the example renderer.
