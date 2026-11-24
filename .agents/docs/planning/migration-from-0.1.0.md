---
type: Migration Guide
title: 'Migrating from @pmndrs/glyph 0.1.0'
description: 'Every breaking change between the published 0.1.0 and the next release, for application authors and for renderer integrators, with what to change.'
documentation_type: how-to
tags: [migration, api, threejs, react, vue, typegpu, renderer]
status: draft
sources:
  - id: api-summary
    resource: api-summary-for-review.md
    title: Public API summary for owner review
  - id: three-api
    resource: three-api.md
    title: Three.js text API
  - id: core-api
    resource: core-api.md
    title: Glyph integration API
  - id: preparation-decision
    resource: decisions/deferred-never-stale-preparation.md
    title: Deferred, never-stale preparation
  - id: render-time-errors-decision
    resource: decisions/render-time-errors-throw.md
    title: Render-time failures throw; onError and TextFrameError removed
generated:
  by: anthropic/claude-fable-5-2
  at: '2026-11-22T23:30:00Z'
---

# Migrating from @pmndrs/glyph 0.1.0

This release is breaking and has no compatibility paths. The one entry point added is `@pmndrs/glyph/pixi3d`; none was
removed. Sections 1–4 are for application code; section 5 is for code that implements a renderer against
`@pmndrs/glyph/core` or the shader subpaths. The name-level evidence for each row is in the
[API summary](api-summary-for-review.md).

## 1. When layout runs

| 0.1.0                                                            | Now                                                                                                  | What to change                                                                                                     |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| A setter laid the text out synchronously.                        | A setter validates, records the value and marks the text dirty. It makes no engine call.             | Nothing, unless you relied on a setter throwing an engine error: see section 2.                                    |
| A read returned the committed state, which could be a frame old. | A read (`measure`, `glyphs`, `readGlyphs`, `boundingBox`, carets, `split`) prepares that text first. | Remove any `glyph.shape()` or `updateMatrixWorld()` you called only to make a read current.                        |
| `glyph.shape()` published what setters had prepared.             | `glyph.shape()` batch-prepares every dirty text in one engine call, then publishes.                  | Nothing.                                                                                                           |
| No batch read.                                                   | `glyph.prepare()` prepares every dirty text in one call and publishes nothing.                       | Call it before reading many texts between frames; a loop of reads without it costs one engine call per dirty text. |
| Creating a `Text` entered the engine.                            | Creating a `Text` is a setter.                                                                       | Nothing.                                                                                                           |
| `commitState()` was `pending` between a setter and its frame.    | The same, and `pending` now also covers "not prepared yet" and "held for its layout callback".       | Do not treat `pending` as "laid out but not drawn".                                                                |
| `measure()` and `glyphs()` refreshed `boundingBox`.              | The box is kept current only after `boundingBox` has been read once. It now includes the anchor.     | Read `text.boundingBox` (or call `computeBoundingBox()`) where you need the box.                                   |

A Three root now keeps a second private object in the Scene, `@pmndrs/glyph-prepare`, as the Scene's first child. Code
that walks `scene.children` by index or assumes the first child is its own must skip it. `root.attach(scene)` (new)
names the Scene before the first traversal; React and Vue call it for you.

### Fixed-height text and `layout.overflow`

With a fixed `height`, a line is judged by its line box: it fits when it ends at or above the block end, it straddles
when it starts inside the box and ends past it, and it is outside when it starts at or below the block end. Only the
last column or flow region is affected; earlier ones still pass a line that does not fit on to the next.

| 0.1.0                                                                                                | Now                                                                 |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `'visible'` (the default) drew the lines that fit and dropped the straddling line.                   | `'visible'` also draws the straddling line, spilling over the edge. |
| `'clip'` drew the same lines, but `measure().lines` and `glyphs()` reported every line past the box. | `'clip'` lays out, draws and reports only the lines that fit.       |

Use `overflow: 'clip'` to keep 0.1.0's drawing. To read all of the text's lines, measure it with an unconstrained
`height`; no mode lays out a line wholly outside the box. `measure().overflowed` and `contentHeight` are unchanged.

## 2. Errors

| 0.1.0                                                                                         | Now                                                                                                                                      | What to change                                                                                        |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Invalid input threw `TypeError` or `RangeError` from the setter.                              | It throws `GlyphInputError` (`code: 'invalid-input'`, `path: (string \| number)[]`, the old error as `cause`). The previous value stays. | Replace `instanceof TypeError`/`RangeError` checks on setters with `GlyphInputError` or `error.code`. |
| An engine failure threw from the setter.                                                      | It is thrown from the render that finds it, once; its message quotes the text. Its siblings draw.                                        | Move `try`/`catch` from setters to around `renderer.render()` (see below).                            |
| `Text.onError`, `TextGroup.onError`, R3F `onError` prop, Vue `error` event, `TextFrameError`. | Removed. A failure found while rendering is thrown from that render (see below) as the underlying error.                                 | Delete the handlers; catch the render instead.                                                        |
| A lone surrogate threw `RangeError: text offset N is an unpaired … surrogate`.                | Lone surrogates no longer throw; they render as the replacement character. `text.text` returns the string as assigned.                   | Remove the guard if you had one.                                                                      |
| No per-text length limit.                                                                     | A text longer than `maxTextUnits` (default 65,536 UTF-16 units) is invalid input.                                                        | Raise it with `defineThreeConfig({ maxTextUnits })` if you hold longer paragraphs.                    |
| `Glyphs.glyphAt(i)` returned `undefined` out of range.                                        | It throws `RangeError`.                                                                                                                  | Check the index against `count` first.                                                                |
| React: an invalid prop surfaced however the setter did.                                       | It throws while React commits and reaches the nearest error boundary; without one inside the canvas, the canvas unmounts.                | Wrap Text in `<GlyphErrorBoundary fallback={…}>` (new) inside the canvas.                             |
| Vue: not defined.                                                                             | An invalid prop, and a FontFace that fails to load, reach Vue's error handling; the component keeps its previous value.                  | Use `onErrorCaptured` or `app.config.errorHandler`.                                                   |

Engine traps no longer take a root down: the engine instance is replaced, every text restates itself, and the next
frame retries. An input that always traps is refused alone, and the thrown message quotes that text.

**Catching a failure found while rendering.** There is no error callback. A paragraph the engine refused, a
publication the renderer rejected, an engine restart, a fixed capacity exceeded and an exception from your own
`onLayout` are thrown from `renderer.render(scene, camera)` (TypeGPU: from `root.draw()`; PixiJS 3D: from
`glyph.shape()`), after the frame was drawn and once per failure: the same standing failure is not thrown again on
later frames, and the failed text draws nothing until its input changes while its siblings draw. Catch it where you
render, or let it reach your global error handler (`window.onerror`, Sentry):

```ts
try {
  renderer.render(scene, camera);
} catch (error) {
  report(error); // e.g. 'Glyph text "Hello, wor…" was not drawn: …' (the engine's error is `cause`)
}
```

There is no per-text error read: `Text.error`, `TextGroup.error`, `TypeGpuText.error`, `Pixi3DText.error` and the
`failed` status of `commitState()` are removed. The thrown message quotes the first 40 UTF-16 units of the failed
text, so a console or error report alone finds it; a refused text's `commitState()` is `pending`.

## 3. Renamed and removed application names

| Entry                                      | 0.1.0                                                                    | Now                                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| three, typegpu, core `GlyphTextController` | `withGlyphs(read)`                                                       | `readGlyphs(read)`, same signature                                                                      |
| three                                      | `Text.breakApart()`                                                      | `Text.split()`, same return type                                                                        |
| three                                      | `DetachedGlyph.sourceIndex`, `ThreeGlyphMeasurement.sourceIndex`         | Removed. Detached indices are dense over drawable glyphs.                                               |
| three                                      | `Text.caretAt(x, y)`                                                     | `text.hitTest({ x, y })`, then `text.caret(position)` for the rectangle                                 |
| three                                      | `Text.selectionRects(start, end)`                                        | `text.rangeRects(start, end)`                                                                           |
| three, root                                | `GlyphCaret` (`offset`, `line`, `leading`, `rect`)                       | `TextPosition` (`offset`, `affinity`) and `TextCaret` (`rect`, `line`, `level`, `secondary`, `clipped`) |
| core                                       | `GlyphPlacements.caretAt`, `caretForOffset`, `selectionRects`            | Removed. Use `GlyphTextController.editing`.                                                             |
| three, react, vue                          | `order` on Three `TextProperties`/`TextUpdate`, R3F and Vue `Text` props | Removed. It was never read; Three paints in scene order with `renderOrder`. Delete the property.        |
| CLI                                        | `glyph bake --yes`                                                       | Removed. It never did anything (the CLI does not prompt). Delete the flag.                              |

`Text.caretAt` and `Text.selectionRects` existed in 0.1.0; `Text.caretForOffset` was added after it and is replaced
by `text.caret({ offset, affinity })` before any release. What changes in behaviour, not only in name:

- **Nothing is snapped or clipped.** `selectionRects` swapped a reversed range and clipped one that ran past the
  text; `caretForOffset` moved an offset inside a cluster to the cluster's start. Every editing method now throws
  `TextOffsetError` for an offset that is not a whole number, is out of range, ends a reversed range, or is inside
  a grapheme. The error carries `method`, `argument`, the `offset` as given, `reason`, `textLength`, and the nearest
  valid boundaries `before` and `after`.
- **A position has a side.** `GlyphCaret.leading` mixed up two things. `affinity` is `'downstream'` (the caret
  belongs to the grapheme that starts at the offset) or `'upstream'` (to the one that ends there). They differ at
  a soft wrap, where `upstream` is the end of the earlier line, and at a bidi boundary, where they are two x on one
  line and `caret().secondary` is the other one.
- **Boundaries are graphemes, not shaping clusters, and they are the engine's.** A caret can stand inside a
  ligature (`f|fi`), placed by the font's ligature carets when it has them. A conjunct, an emoji sequence, a flag
  and a combining sequence are one unit. `Intl.Segmenter` is not consulted and may disagree.
- **The methods never return `undefined`.** They prepare the text if a setter left it dirty, as `measure()` does.

## 4. New application surface

None of these require a change; they replace patterns that no longer work or were not possible.

- `text.onLayout = (text, layout) => …` on Three `Text`, `<Text onLayout>` in React, `@layout` in Vue, and
  `onLayout` on TypeGPU text. It receives what `measure()` returns, after the first preparation and whenever that
  summary changes, before the frame that draws it. Use it where 0.1.0 code read `measure()` after a frame to size
  something else. Inside it, writing a layout input of any text throws `GlyphLayoutPhaseError`.
- `root.onInvalidate` (also run by `root.material`, `TextGroup.material`, `TextGroup.batching` and `TextGroup.dispose()`)
  and `root.attach(scene)` on a Three root.
- `@pmndrs/glyph/pixi3d`: PixiJS 3D text on WebGPU and WebGL2, a subpath of this package with optional peers `@pixi/3d`
  (`>=0.1.0 <0.2`) and `pixi.js` (`>=8.23.0 <9`). It is not a separate package. `Pixi3DText` has `measure`, `glyphs`,
  `split` and the editing methods below, including `replace`, and the entry exports `TextOffsetError` and the editing
  types.
- Frustum culling is on by default for every built-in draw, with no API: each draw is culled by a bound computed from
  the records it draws. `frustumCulled = false` on a `Text`, an enclosing `TextGroup` or a `Glyphs` is respected and
  submits every draw that places its records. For a custom material see "Custom materials" below.
- `frameloop="demand"` (React) and on-demand rendering (Vue) now draw an imperative `ref.current.text = …`.
- `Constraints.anchor` (`{ x, y }`), `measure().anchorOffset`, `fontMetrics` on measurements and lines, glyph outlines
  (`outlineAt`), `TextGroup.batching`, and the `msdfAtlas: 'msdf' | 'sdf'` config option.
- Editing geometry and one exact edit, on Three `Text`, TypeGPU text and `Pixi3DText`. These are what an application needs to
  build its own editable field; selection state, caret drawing, keyboard, pointer, clipboard and undo stay with the
  application.

  ```ts
  text.caret({ offset, affinity }); // { rect, line, level, secondary, clipped }
  text.hitTest({ x, y }); // { offset, affinity }
  text.move(position, direction, unit, goalX?); // { position, goalX }
  text.boundary(position, unit); // { start, end }
  text.rangeRects(start, end); // LayoutBox[]
  text.replace(start, end, insert);
  ```

  Offsets are UTF-16 code units of `text.text`. Coordinates are logical Text-local, +X right and +Y down, anchor
  included. `direction` is `'forward' | 'backward'` (logical), `'left' | 'right'` (visual across bidi runs) or
  `'up' | 'down'` (by line; pass the returned `goalX` to the next vertical move). `unit` is
  `'grapheme' | 'word' | 'sentence' | 'line'`. `replace` edits exactly the range it names, and spans follow it:
  inserted text takes the style of the grapheme before it.

  An input method needs nothing more. The application tracks its composition as `[start, start + insert.length)`
  and underlines `rangeRects` of that range:

  ```ts
  let composition = { start: caretOffset, end: caretOffset };
  function compose(insert: string) {
    text.replace(composition.start, composition.end, insert);
    composition = { start: composition.start, end: composition.start + insert.length };
    underline(text.rangeRects(composition.start, composition.end));
  }
  input.addEventListener('compositionupdate', (event) => compose(event.data));
  input.addEventListener('compositionend', (event) => {
    compose(event.data);
    caretOffset = composition.end;
  });
  ```

Results that change without a code change:

- Line breaks after opening quotation marks follow UAX #14 LB15a, so text containing them can wrap differently.
- `boundingBox`, `measureGlyphs` and `split` include the anchor.
- Empty and newline-only text have lines: `""`, `"\n"` and `"\n\n"` measure 1, 2 and 3 lines (they had none), and an
  empty paragraph reports a known, empty ink box instead of an unknown one. Code that treated `lineCount === 0` as
  "empty" must test the text instead.
- An ellipsis follows the paragraph direction (it is at the end side of a right-to-left line), and an ellipsis line fits
  its slot, with the spaces its fit hung charged to it. Right-to-left lines fill exclusion slots in reading order.
- Lone surrogates draw as U+FFFD, one unit for one unit (section 2); nothing is counted.
- A `glyph bake --unicodes` subset keeps every OpenType layout feature and the alternates the selection reaches, so
  style `features` such as `smcp`, `tnum` or `ss01` work on it (they did nothing in 0.1.0). Subset fonts grow: the
  ASCII Inter app asset (Bitmap 32, MSDF, Slug) went from 2,355,620 to 8,743,692 bytes. The new
  `--layout-features <tags>` (`layoutFeatures` in `bakeFont()`) keeps only the named features plus the ones shaping
  needs, with or without `--unicodes` ([issue 02](issues-0.2.0/02-subset-drops-discretionary-features.md)).
- Fonts baked with outlines decode them inside the dynamically loaded font baker, not the text shaper. No name,
  signature or artifact changed; the first outline font fetches the baker if nothing had loaded it, and a cold decode
  of 65,535 CFF glyphs measured the same (375 ms against 371 ms in Node).

### Custom materials

`ThreeTextMaterial` gained two required fields, `frustumCulled: boolean` and `boundsPadding: number`, so an object
literal such as `{ create }` no longer type-checks. Build the value with
`defineTextMaterial(create, { boundsPadding, frustumCulled })`; both options are optional and default to `true` and `0`.
`boundsPadding` is the furthest the vertex stage moves any vertex along any axis, in the units of `context.position`
(finite, `>= 0`; invalid options throw `TypeError` or `RangeError`). Glyph grows each draw's culling bound by it, so a
material that displaces vertices must declare how far or pass `frustumCulled: false`, or its glyphs can be culled while
on screen. Draws of custom materials are now culled by default; 0.1.0 computed no bound for them.

Every built-in material context (decoration, bitmap, MSDF, Slug) also carries `position` (the final draw-local
position the default material assigns to `positionNode`) and `paragraphPosition` (the unanchored paragraph-local
position, +X right and +Y up). Both are evaluated per vertex and reach a fragment node interpolated, so either is safe
in a vertex or a fragment node. A displacement assigns `material.positionNode` from `position`; fragment reads still see
the undisplaced value.

## 5. Renderer integrators

These affect code written against `@pmndrs/glyph/core`, `@pmndrs/glyph/shaders/tsl` or the TypeGPU shader subpath.

### Instance and glyph data

| Item                        | 0.1.0                                                                                                  | Now                                                                                                                                                 |
| --------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `msdfSchema` buffers        | `rect`, `uvRect`, `uvBounds`, `color`, `effectColor`, `page` (`x, y, z, page`)                         | `rect`, `color`, `effectColor`, `effect` (`shadowX, shadowY, outlineWidth, glyph`)                                                                  |
| `msdfSchema` glyph record   | f32 `bearingX … uvMaxY` (10 lanes); u32 `page`                                                         | f32 `bearingX, bearingY, width, height`; u32 `glyph`                                                                                                |
| MSDF `atlas` resource group | `texture` (`texture-array`, `rgba8unorm`), `pixelRange`, `effectScale`                                 | `pages` (a buffer holding an in-process token; resolve it with `msdfBakedPages`), `pixelRange`, `effectScale`, `glyphs` (a buffer: the glyph table) |
| `slugSchema` buffers        | `rect`, `color`, `planeRect`, `bandTransform`, `inverseFontSize`, `tableStarts`, `bandCounts`          | `rect`, `color`, `glyph` (u32 lanes `glyph, unused1`)                                                                                               |
| `slugSchema` glyph record   | f32 8 lanes, u32 6 lanes                                                                               | f32 `bearingX, bearingY, width, height`; u32 `glyph`                                                                                                |
| Slug `page` group           | `curves` (texture `rgba16float`), `headers` (texture `r32uint`), `references` (texture `r32uint`)      | `headers` (texture `r32uint`), `curves` (buffer), `references` (buffer), `glyphs` (buffer)                                                          |
| tsl `TslSlugPageResources`  | `headerTexture, headerWidth, curveTexture, curveWidth, referenceTexture, referenceWidth`               | `headerTexture, headerWidth, bandCurveTexture, bandCurveWidth` (one `rgba32uint` texel per band entry)                                              |
| typegpu shader slots        | `slugCurveTexelSlot`, `slugCurveWidthAccessor`, `slugReferenceTexelSlot`, `slugReferenceWidthAccessor` | `slugBandCurveTexelSlot`, `slugBandCurveWidthAccessor`; the reference pair is removed                                                               |
| typegpu `SlugShaderPage`    | `loadHeader, headerWidth, loadCurve, curveWidth, loadReference, referenceWidth`                        | `loadHeader, headerWidth, loadBandCurve, bandCurveWidth`                                                                                            |

What to change: an instance no longer carries its atlas rectangle or band tables. It carries a glyph index, and the
shader reads the per-glyph record from the `glyphs` table (`MSDF_GLYPH_TABLE_STRIDE`, `MSDF_GLYPH_TABLE_LAYER_STEP`,
`SLUG_GLYPH_TABLE_STRIDE`). The MSDF atlas is no longer one texture the package uploads whole: the `pages` member is a
token, `msdfBakedPages(pages)` returns the baked pages, and the renderer makes resident only the cells of glyphs it
draws, before the frame that draws them. MSDF quads are trimmed to the ink.

### New `/core` exports

`msdfBakedPages`, `MsdfBakedPages`, `MSDF_GLYPH_TABLE_STRIDE`, `MSDF_GLYPH_TABLE_LAYER_STEP`,
`SLUG_GLYPH_TABLE_STRIDE`, `createDecorationCodecProgram`, `decorationSchema`, `SlugBandResidency`,
`SLUG_RESIDENT_BAND_CURVE_WIDTH`, `createGlyphPlacements` with the types `GlyphPlacement`, `GlyphPlacements`, `GlyphRun`,
`GlyphLine` and `GlyphSpace`, `GlyphSchema.preservesHostTopology`, and an optional argument on
`GlyphRootServices.syncTransforms(updates?)`.

### Root hooks and the text controller

- `GlyphRootShapeHooks` gains `prepared()` (after the batch preparation, before staging), `layout()` (run layout
  callbacks; every root is prepared, none is published), `unchanged()` (the root settled without a publication) and
  `invalidated()` (a setter left the root needing a frame). An integration that resolved anchors or read measurements
  inside a setter does it in `prepared()` now.
- `GlyphTextController` gains `refusal`, `keepMeasured`, `preparedMeasurement()`, `awaitsPreparation` and
  `editing`: `caret`, `hitTest`, `move`, `boundary`, `rangeRects` and `beginReplace(start, end, insert)`, which
  validates a replacement's range and states it to the engine before the integration sets the new text. An
  integration that wrapped `createGlyphPlacements(...).caretAt` wraps `controller.editing` instead.
  `controller.update()` no longer enters the engine and no longer throws engine status errors.
- While `layout()` hooks run, `controller.update()` throws `GlyphLayoutPhaseError` for a change to a layout input.

### Behaviour a renderer can rely on, or must now handle

- No overflow mode draws outside its box, so none publishes a clip boundary: an instance span's and a draw's `clip`
  is always `undefined`, and a clipped multi-column paragraph is no longer split into one draw per column.
- Three materials survive buffer growth: when instance storage outgrows its capacity, the material (node graph,
  shader modules, pipeline) is kept and pointed at the new buffers. The material factory is not called again, so a
  factory with side effects per call sees fewer calls.
- The first frame that shows a new MSDF effect combination (fill, outline, shadow, both) compiles: Three creates one
  material per combination when a draw first needs it; TypeGPU creates one pipeline per combination, shared by all
  MSDF fonts of a config.
- TypeGPU anchored text: `createText` writes the unanchored `position`; the anchored position is written when
  `glyph.shape()` accepts the text.
- TypeGPU in a browser without a bundler: the `typegpu` peer (0.12.5) reads `process.env.NODE_ENV` unguarded, so
  loading `/typegpu` or `/three/typegpu` as direct, unbundled browser ESM needs a bundler or a `process` shim.
