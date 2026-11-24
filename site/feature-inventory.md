# Feature inventory and documentation map

What `@pmndrs/glyph` 0.2.0 offers, where each feature is documented, and which live demo shows it. The inventory is
read from the package: `packages/glyph/package.json` `exports`, the entry modules under `packages/glyph/src`, and
`.agents/docs/planning/api-summary-for-review.md`. Update a row when its page or demo changes.

Status values:

- **Page**: `done` (written for 0.2.0 and its snippets typecheck), `scaffold` (code blocks plus writing notes inherited
  from the pre-0.2.0 branches; prose not written), `none`.
- **Demo**: the scene slug under `site/examples/src/scenes/`, or `none`. `n/a` where a live scene would not clarify.
- **Verified**: `yes` when `site:verify-pages` has driven the demo live on its docs page in Chromium with no console
  error; `no` otherwise.

## Information architecture

The site follows Diátaxis. Each page has one purpose; pages link across purposes instead of mixing them.

| Folder (`site/docs/`) | Diátaxis type | Reader need                              | Explainer section(s) it embeds                                        |
| --------------------- | ------------- | ---------------------------------------- | --------------------------------------------------------------------- |
| `getting-started/`    | routing       | orient, install, find the next page      | `start`                                                               |
| `tutorials/`          | tutorial      | learn by building one thing that works   | `start`, `editing`                                                    |
| `guides/`             | how-to        | complete one task                        | `layout`, `styling`, `fonts`, `editing`, `inspect`, `scene`, `motion` |
| `reference/`          | reference     | look up a name, option, default or error | embeds a demo only where a picture defines the term                   |
| `explanation/`        | explanation   | understand why it works this way         | `fonts`, `scene`                                                      |

Renderer-specific pages (React Three Fiber, Vue/TresJS, TypeGPU, PixiJS 3D) are how-to guides under `guides/renderers/`
and reference pages under `reference/`.

### Explainer sections

A docs page declares one `<glyph-explainer-root data-explainer-page="<section>">`. The loader fetches that section's
module and nothing from any other section; each scene inside a section is a further lazy chunk fetched when its proxy
first takes a lease. One root drives every proxy on the page through one renderer and one GPU device.

| Section        | Scenes it owns                                                                                                 | Catalog file                          |
| -------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `start`        | first text, the three formats side by side                                                                     | `site/examples/src/catalog/start.ts`  |
| `layout`       | wrapping, alignment, justification, overflow, columns, flow regions, exclusions, drop caps, anchors, bidi, CJK | `catalog/layout.ts`                   |
| `styling`      | style properties, spans, decorations, outline and shadow, OpenType features, language, opacity                 | `catalog/styling.ts`                  |
| `fonts`        | formats, size ladder, zoom, Slug anatomy, shaping, fallback stacks, icons, runtime baking                      | `catalog/fonts.ts`                    |
| `editing`      | caret, selection, movement, boundaries, replace, bidi carets, an editable field                                | `catalog/editing.ts`                  |
| `inspect`      | measurement, lines, glyph inspection, outlines, `onLayout`, anchors against metrics                            | `catalog/inspect.ts`                  |
| `scene`        | depth, labels, off-axis, bloom, groups, batching, ordering, materials, positions, culling                      | `catalog/scene.ts`                    |
| `motion`       | `split()`, glyphs on paths, kinetic showcases                                                                  | `catalog/motion.ts`                   |
| `introduction` | the bespoke introduction scenes (object showcase, physics)                                                     | `docs/components/pages/introduction/` |

The gallery at `/examples/` lists every section's scenes on one root.

Scenes run on the Three.js WebGPU renderer through React Three Fiber, because that is what the shared host is. Vue,
TypeGPU and PixiJS 3D features are documented with typechecked snippets and, where the repository has an app for them
(`apps/tres-playground`, `apps/typegpu-hello-world`), a link to it; they have no live scene on the docs host.

## Not in 0.2.0

Listed so nobody looks for them: hyphenation, variable-font axes, vertical writing modes, inline objects (deferred to
0.3.0; icons go through the font stack and wrap-around through exclusions), and decoration styles other than `solid`
(`double`, `dotted`, `dashed` and `wavy` are typed and rejected).

## Inventory

### Setup and lifecycle

| Feature                      | Public surface                                                                                                        | Page                                    | Demo     | Verified |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | -------- | -------- |
| Install, peers, entry points | `package.json` `exports`                                                                                              | `getting-started/installation` scaffold | n/a      | n/a      |
| Engine start                 | `glyph.init(options)`, `glyph.initialized`                                                                            | `reference/glyph` none                  | n/a      | n/a      |
| Handles and roots            | `glyph.handle(name, config)`, `ThreeHandle`, `ThreeRoot`, `root.attach(scene)`, `root.onInvalidate`, `root.dispose()` | `reference/three/roots` none            | `groups` | no       |
| Frame preparation            | `glyph.shape()`, `glyph.prepare()`, deferred never-stale reads                                                        | `explanation/when-layout-runs` none     | none     | no       |
| Renderer config              | `defineThreeConfig({ capacity, transformMode, defaultFontFormat, material, msdfAtlas, maxTextUnits })`, `ThreeConfig` | `reference/three/config` none           | none     | no       |
| Buffer capacity policy       | `GlyphBufferCapacity` `grow` / `chunk` / `fixed`                                                                      | `guides/performance/capacity` none      | none     | no       |
| Publication state            | `text.commitState()` `unbound` / `pending` / `committed`                                                              | `reference/three/text` none             | none     | no       |

### Fonts

| Feature                           | Public surface                                                                                           | Page                                                  | Demo                                                | Verified |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------- | -------- |
| Declaring a face                  | `glyph.fontFace(source, { format })`, `FontFace.load()`, `FontFaceSource`                                | `guides/fonts/load-a-font` scaffold (`fonts/loading`) | `first-text`                                        | no       |
| Formats                           | `bitmap`, `msdf`, `slug` and their options                                                               | `explanation/formats` scaffold (`fonts/techniques`)   | `techniques`, `text-ladder`, `zoom`, `slug-anatomy` | no       |
| Bitmap strikes and pixel snapping | `bitmap({ strikes })`, `rasterPixelRatio`, `TextGroup.pixelSnapping`                                     | `guides/fonts/pixel-perfect-bitmap` none              | `text-ladder`                                       | no       |
| MSDF atlas memory                 | `msdfAtlas: 'msdf' \| 'sdf'`, on-demand page residency                                                   | `guides/performance/memory` none                      | none                                                | no       |
| Fallback stacks                   | `createFontStack`, `FontStack`, `missingGlyphCount`                                                      | `guides/fonts/fallback-stacks` scaffold               | none                                                | no       |
| Icon fonts                        | a baked icon subset in a stack                                                                           | `guides/fonts/icons` none                             | `labels`                                            | no       |
| Font metrics                      | `Font.metrics`, `FontMetrics`, `measure().fontMetrics`                                                   | `reference/glyph/font` none                           | `measurement`                                       | no       |
| Baking with the CLI               | `glyph` bin: `bake`, project discovery, inspect                                                          | `guides/fonts/bake-fonts` scaffold (`fonts/baking`)   | n/a                                                 | n/a      |
| Baking from Node                  | `@pmndrs/glyph/bake`: `bakeFont`, `bakeProject`, `inspectFont`, `fontIsUpToDate`, `validateFontArtifact` | `reference/bake` none                                 | n/a                                                 | n/a      |
| Raster bakers                     | `@pmndrs/glyph/bakers/{bitmap,msdf,slug}`, `@pmndrs/glyph/baker` `rasterBake`, `defineRasterBaker`       | `reference/bakers` none                               | n/a                                                 | n/a      |
| Coverage subsets                  | `RasterCoverage`, `RasterUnicodeRange`                                                                   | `guides/fonts/subset-coverage` none                   | n/a                                                 | n/a      |
| Runtime baking in a worker        | `@pmndrs/glyph/runtime-bake` `bakeFontInWorker`, `BakeProgress`                                          | `guides/fonts/runtime-baking` scaffold                | none                                                | no       |
| Transferring faces between realms | `FontFaceTransfer`, `SerializedFontFace`                                                                 | `reference/glyph/font-face` none                      | n/a                                                 | n/a      |

### Text content and style

| Feature                        | Public surface                                                                            | Page                                                                      | Demo          | Verified |
| ------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------- | -------- |
| Creating and updating text     | `root.createText`, `Text` setters, `text.set(update)`                                     | `tutorials/first-text-three` scaffold (`getting-started/your-first-text`) | `first-text`  | no       |
| Style properties               | `TextStyle`: `fontSize`, `lineHeight`, `letterSpacing`, `wordSpacing`, `color`, `opacity` | `guides/text/style-text` scaffold (`text/styling`)                        | `styling`     | no       |
| Property lists and named rules | `PropertyList`, `TextStyle.create`, `ParagraphLayout.create`, `Constraints.create`        | `guides/text/reuse-styles` none                                           | `styling`     | no       |
| Inline spans                   | `span`, `txt`, `FormattedText`, nested `<Text>` in React                                  | `guides/text/rich-text` scaffold                                          | `rich-text`   | no       |
| Outline and shadow             | `TextStyle.outline`, `TextStyle.shadow`, `RasterTextEffect` (MSDF)                        | `guides/text/outline-and-shadow` none                                     | `effects`     | no       |
| Decorations                    | `TextStyle.decoration` underline / overline / lineThrough, `Decorations`                  | `guides/text/decorations` none                                            | `decorations` | no       |
| OpenType features              | `TextStyle.features`, `FontFeature` ranges                                                | `guides/text/opentype-features` none                                      | `styling`     | no       |
| Language and script shaping    | `TextStyle.language`, complex-script shaping                                              | `guides/text/languages-and-scripts` none                                  | `shaping`     | no       |
| Direction and bidi             | `TextStyle.direction` `auto` / `ltr` / `rtl`, mixed runs                                  | `guides/text/bidirectional-text` none                                     | none          | no       |
| Text length limit              | `maxTextUnits`, lone surrogates as U+FFFD                                                 | `reference/errors` done (`text/errors`)                                   | n/a           | n/a      |

### Paragraph layout

| Feature                            | Public surface                                                                         | Page                                                                | Demo               | Verified |
| ---------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------ | -------- |
| Constraints                        | `Constraints.width` / `height` with `unconstrained` / `at-most` / `exact`              | `guides/layout/size-a-paragraph` scaffold (`text/paragraph-layout`) | `paragraph-layout` | no       |
| Anchor                             | `Constraints.anchor` `{ x, y }`, nine vertical references, `measure().anchorOffset`    | `guides/layout/anchor-text` none                                    | none               | no       |
| Wrapping                           | `ParagraphLayout.wrap` `none` / `word` / `character`, UAX #14 breaks                   | `guides/layout/wrap-and-align` none                                 | `paragraph-layout` | no       |
| Alignment                          | `ParagraphLayout.align` `start` / `center` / `end` / `justify`                         | `guides/layout/wrap-and-align` none                                 | `paragraph-layout` | no       |
| Justification                      | `justify.minWordSpaceRatio` / `maxWordSpaceRatio` / `letterSpaceExpansion`, `lastLine` | `guides/layout/justify` none                                        | `justify`          | no       |
| Overflow and truncation            | `overflow` `visible` / `clip` / `ellipsis`, `maxLines`                                 | `guides/layout/truncate` none                                       | none               | no       |
| Indent and paragraph spacing       | `firstLineIndent`, `spaceBefore`, `spaceAfter`                                         | `guides/layout/indent-and-spacing` none                             | none               | no       |
| Columns                            | `ParagraphLayout.columns` `{ count, gap }`                                             | `guides/layout/columns` none                                        | none               | no       |
| Flow regions                       | `flow.regions`, `TextFlowRegion`, rectangle and polygon shapes, `clip`                 | `guides/layout/flow-through-regions` none                           | none               | no       |
| Exclusions                         | `TextFlowExclusion` `wrapSide`, margins                                                | `guides/layout/wrap-around-shapes` none                             | none               | no       |
| Projected flow                     | `projectTextFlowBounds`, `projectTextFlowSilhouette`                                   | `guides/layout/wrap-around-3d-objects` none                         | none               | no       |
| Drop caps                          | `ParagraphLayout.dropCap` lines, align, side, margins, contour                         | `guides/layout/drop-caps` none                                      | none               | no       |
| CJK and mixed-script line breaking | UAX #14, kinsoku through the shaper                                                    | `guides/text/languages-and-scripts` none                            | none               | no       |

### Measurement and inspection

| Feature                      | Public surface                                                         | Page                                                        | Demo          | Verified |
| ---------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------- | ------------- | -------- |
| Paragraph measurement        | `text.measure()`, `ParagraphLayoutSummary`, intrinsic widths           | `guides/inspect/measure-text` scaffold (`text/measurement`) | `measurement` | no       |
| Line metrics                 | `measure().lines`, `ParagraphLineMetrics`                              | `reference/glyph/measurement` none                          | none          | no       |
| Glyph inspection             | `text.glyphs()`, `text.readGlyphs(read)`, `glyphFlags`                 | `guides/inspect/read-glyphs` none                           | none          | no       |
| Glyph outlines               | `glyphs().outlineAt(index)`, `GlyphOutlineContour`                     | `guides/inspect/glyph-outlines` none                        | none          | no       |
| Layout callback              | `text.onLayout`, `<Text onLayout>`, `@layout`, `GlyphLayoutPhaseError` | `guides/inspect/react-to-layout` none                       | none          | no       |
| Bounding box                 | `text.boundingBox`, `computeBoundingBox()`                             | `reference/three/text` none                                 | `measurement` | no       |
| Per-glyph Three measurements | `text.measureGlyphs()`, `ThreeGlyphMeasurement`, `GlyphAnchor`         | `reference/three/glyphs` none                               | none          | no       |

### Editing

| Feature                       | Public surface                                            | Page                                                           | Demo      | Verified |
| ----------------------------- | --------------------------------------------------------- | -------------------------------------------------------------- | --------- | -------- |
| Hit testing                   | `text.hitTest(point)`                                     | `guides/editing/caret-and-selection` done (`text/interaction`) | `caret`   | yes      |
| Caret geometry                | `text.caret(position)`, `TextCaret.secondary`, `clipped`  | same                                                           | `caret`   | yes      |
| Selection rectangles          | `text.rangeRects(start, end)`                             | same                                                           | `caret`   | yes      |
| Movement                      | `text.move(position, direction, unit, goalX)`             | same                                                           | none      | no       |
| Boundaries                    | `text.boundary(position, unit)`                           | same                                                           | none      | no       |
| Exact edits                   | `text.replace(start, end, insert)`, spans follow the edit | same                                                           | `editing` | no       |
| Input methods                 | composition over `replace` and `rangeRects`               | `guides/editing/input-methods` none                            | none      | no       |
| An editable field, end to end | all of the above                                          | `tutorials/editable-text-field` none                           | none      | no       |

### In a scene

| Feature                      | Public surface                                                                                     | Page                                                             | Demo                            | Verified |
| ---------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------- | -------- |
| Text as scene objects        | transforms, depth, perspective                                                                     | `guides/scene/place-text-in-3d` scaffold (`text/in-3d`)          | `depth`, `off-axis`, `orbit`    | no       |
| Billboards and labels        | application-owned orientation                                                                      | `guides/scene/labels` none                                       | `labels`                        | no       |
| Groups, batching, draw order | `TextGroup`, `batching` `auto` / `shared` / `group`, `renderOrder`, `order`                        | `guides/scene/group-and-batch` scaffold (`text/text-and-groups`) | `groups`, `batching`            | no       |
| Frustum culling              | on by default; `frustumCulled`, `boundsPadding`                                                    | `guides/scene/culling` none                                      | none                            | no       |
| Materials                    | `defineTextMaterial`, `ThreeTextMaterial`, per-format contexts                                     | `guides/scene/custom-materials` scaffold (`text/materials`)      | `materials`, `relief`, `ripple` | no       |
| Material positions           | `context.position`, `context.paragraphPosition`                                                    | same                                                             | `ripple`                        | no       |
| Post-processing              | bloom over text                                                                                    | `guides/scene/post-processing` none                              | `bloom`                         | no       |
| Detached glyphs              | `text.split()`, `Glyphs`, `setMatrixAt`, `Decorations`, `localToWorldMatrix`, `worldToLocalMatrix` | `guides/motion/animate-glyphs` scaffold (`text/break-apart`)     | `break-apart`, `arc`, `ribbon`  | no       |
| Transform modes              | `transformMode` in `defineThreeConfig`                                                             | `reference/three/config` none                                    | none                            | no       |

### Renderers and frameworks

| Feature                    | Public surface                                                                                                                  | Page                                                           | Demo                                   | Verified |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------- | -------- |
| Three.js                   | `@pmndrs/glyph/three`                                                                                                           | `guides/renderers/three` none                                  | every scene's `three.ts` twin          | n/a      |
| React Three Fiber          | `@pmndrs/glyph/react`: `Text`, `TextGroup`, `GlyphProvider`, `GlyphErrorBoundary`, `useFont`, `useBitmap`, `useMsdf`, `useSlug` | `reference/react` scaffold (`react/components`, `react/hooks`) | every scene                            | no       |
| Vue and TresJS             | `@pmndrs/glyph/vue`: `Text`, `TextGroup`, `GlyphProvider`, `useFont`, `preloadFont`, `clearFont`                                | `guides/renderers/vue` none                                    | none (link `apps/tres-playground`)     | n/a      |
| TypeGPU                    | `@pmndrs/glyph/typegpu`: `defineTypeGpuConfig`, `TypeGpuText`, draw transforms                                                  | `guides/renderers/typegpu` none                                | none (link `apps/typegpu-hello-world`) | n/a      |
| Three with TypeGPU shaders | `@pmndrs/glyph/three/typegpu`                                                                                                   | `guides/renderers/three-typegpu` none                          | none                                   | n/a      |
| PixiJS 3D                  | `@pmndrs/glyph/pixi3d`: `definePixi3DConfig`, `Pixi3DText`, `Pixi3DTextMaterial`, shader bits, `Pixi3DTextSnapshot`             | `guides/renderers/pixi3d` none                                 | none                                   | n/a      |

### Errors

| Feature                       | Public surface                                                                                                                       | Page                                        | Demo | Verified |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- | ---- | -------- |
| Error classes and codes       | `GlyphError`, `GlyphInputError`, `GlyphLayoutPhaseError`, `TextOffsetError`, `GlyphFontError`, `GlyphEngineStatusError`, bake errors | `reference/errors` done (`text/errors`)     | n/a  | n/a      |
| Catching render-time failures | throw from `renderer.render`, once per failure                                                                                       | `guides/handle-errors` done (`text/errors`) | n/a  | n/a      |

### For integrators

| Feature                    | Public surface                                                           | Page                                                                       | Demo           | Verified |
| -------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------- | -------------- | -------- |
| Renderer integration       | `@pmndrs/glyph/core`: `GlyphConfig`, roots, hooks, `GlyphTextController` | `explanation/renderer-integration` scaffold (`advanced/custom-renderers`)  | n/a            | n/a      |
| Codec programs and schemas | `techniqueProgram`, `msdfSchema`, `slugSchema`, `decorationSchema`       | `reference/core/codec` scaffold (`advanced/codec`)                         | n/a            | n/a      |
| Render plan                | display list, batches, resources                                         | `explanation/render-plan` scaffold                                         | n/a            | n/a      |
| Custom raster formats      | `registerThreeRasterProgram`, `defineRasterBaker`                        | `guides/integrators/custom-format` scaffold (`advanced/custom-techniques`) | n/a            | n/a      |
| Shader libraries           | `@pmndrs/glyph/shaders/tsl`, `@pmndrs/glyph/shaders/typegpu`             | `reference/shaders` none                                                   | `slug-anatomy` | no       |

### Cross-cutting

| Topic                                                        | Page                            | Status                             |
| ------------------------------------------------------------ | ------------------------------- | ---------------------------------- |
| How it works (pipeline)                                      | `explanation/how-it-works`      | scaffold (`advanced/how-it-works`) |
| Performance model                                            | `explanation/performance`       | scaffold (`advanced/performance`)  |
| Topologies (many roots, many canvases)                       | `explanation/topologies`        | scaffold                           |
| Coordinate spaces (Text-local +Y down, Three +Y up, anchors) | `explanation/coordinate-spaces` | none                               |
| TypeScript patterns                                          | `guides/typescript`             | scaffold (`advanced/typescript`)   |
| Testing                                                      | `guides/testing`                | scaffold (`advanced/testing`)      |
| Common pitfalls                                              | `guides/troubleshooting`        | scaffold (`advanced/pitfalls`)     |
| Migrating from 0.1.0                                         | `guides/migrate-from-0.1`       | scaffold (`advanced/migration`)    |
