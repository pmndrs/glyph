# Feature inventory and documentation map

What `@pmndrs/glyph` 0.2.0 offers, where each feature is documented, and which live demo shows it. The inventory is
read from the package: `packages/glyph/package.json` `exports`, the entry modules under `packages/glyph/src`, and
`.agents/docs/planning/api-summary-for-review.md`. Update a row when its page or demo changes.

Status values:

- **Page**: the page under `site/docs/` that documents the feature. Every page listed is written for 0.2.0 and its
  `ts`/`tsx` fences typecheck against the package (`site:check-snippets`).
- **Demo**: the scene slug under `site/examples/src/scenes/`, `none` where a demo is still missing, or `n/a` where a
  live scene would not clarify or cannot run on the docs host.
- **Verified**: `yes` when `site:verify-pages` has driven the demo live on its docs page in Chromium with no console
  error (last run 2026-11-24); `n/a` without a demo.

## Information architecture

The site follows Diátaxis. Each page has one purpose; pages link across purposes instead of mixing them.

| Folder (`site/docs/`) | Diátaxis type | Reader need                              | Explainer section(s) it embeds                                        |
| --------------------- | ------------- | ---------------------------------------- | --------------------------------------------------------------------- |
| `getting-started/`    | routing       | orient, install, find the next page      | `start`                                                               |
| `tutorials/`          | tutorial      | learn by building one thing that works   | `start`, `editing`                                                    |
| `guides/`             | how-to        | complete one task                        | `layout`, `styling`, `fonts`, `editing`, `inspect`, `scene`, `motion` |
| `reference/`          | reference     | look up a name, option, default or error | embeds a demo only where a picture defines the term                   |
| `explanation/`        | explanation   | understand why it works this way         | `fonts`, `scene`                                                      |

Renderer-specific pages (three.js, React Three Fiber, Vue/TresJS, TypeGPU, PixiJS 3D) are how-to guides under
`guides/renderers/` and reference pages under `reference/`. The site has 96 pages: 3 routing, 3 tutorials, 54 how-to
guides, 28 reference and 8 explanation.

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

| Feature                                   | Public surface                                                                               | Page                                                       | Demo         | Verified |
| ----------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------ | -------- |
| Install, peers, entry points              | `package.json` `exports`                                                                     | `getting-started/installation`                             | n/a          | n/a      |
| Engine start, handles, fonts, frame calls | `glyph.init`, `glyph.handle`, `glyph.fontFace`, `glyph.prepare`, `glyph.shape`               | `reference/glyph`                                          | n/a          | n/a      |
| Roots                                     | `ThreeHandle`, `ThreeRoot`, `attach`, `onInvalidate`, `dispose`                              | `reference/three-root`, `guides/renderers/three`           | `groups`     | yes      |
| When layout runs                          | deferred, never-stale preparation; `commitState()`                                           | `explanation/when-layout-runs`                             | n/a          | n/a      |
| Renderer config                           | `defineThreeConfig`, `ThreeConfig`, `capacity`, `transformMode`, `msdfAtlas`, `maxTextUnits` | `reference/three-config`                                   | n/a          | n/a      |
| First text                                | React and three.js                                                                           | `tutorials/first-text-react`, `tutorials/first-text-three` | `first-text` | yes      |

### Fonts

| Feature                           | Public surface                                                                     | Page                                                    | Demo                                                             | Verified |
| --------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------- | -------- |
| Declaring and loading a face      | `glyph.fontFace`, `FontFace.load`, hooks                                           | `guides/fonts/load-a-font`, `reference/font-face`       | `first-text`                                                     | yes      |
| Formats                           | `bitmap`, `msdf`, `slug`                                                           | `explanation/formats`, `reference/formats`              | `techniques`, `text-ladder`, `zoom`, `slug-anatomy`              | yes      |
| Bitmap strikes and pixel snapping | `bitmap({ strikes })`, `rasterPixelRatio`, `pixelSnapping`                         | `guides/fonts/pixel-perfect-bitmap`                     | `fonts-bitmap-strikes`                                           | yes      |
| Fallback stacks                   | `createFontStack`, `missingGlyphCount`                                             | `guides/fonts/fallback-stacks`, `reference/font-stack`  | `fonts-fallback`                                                 | yes      |
| Icon fonts                        | private-use code points, stacks and spans                                          | `guides/fonts/icons`                                    | `fonts-icons`                                                    | yes      |
| Baking with the CLI               | `glyph bake`, `glyph glyphs`, project discovery                                    | `guides/fonts/bake-fonts`, `reference/cli`              | n/a                                                              | n/a      |
| Baking from Node                  | `bakeFont`, `bakeProject`, `inspectFont`, `fontIsUpToDate`, `validateFontArtifact` | `reference/bake`                                        | n/a                                                              | n/a      |
| Raster bakers                     | `bakers/{bitmap,msdf,slug}`, `rasterBake`, `defineRasterBaker`                     | `reference/bakers`                                      | n/a                                                              | n/a      |
| Coverage subsets                  | `--unicodes`, `unicodeRanges`, `RasterCoverage`                                    | `guides/fonts/subset-coverage`                          | n/a                                                              | n/a      |
| Runtime baking                    | `bakeFontInWorker`, `BakeProgress`                                                 | `guides/fonts/runtime-baking`, `reference/runtime-bake` | none (the worker bundle does not resolve on the built docs host) | n/a      |

### Text content and style

| Feature                               | Public surface                                         | Page                                                | Demo                                                         | Verified |
| ------------------------------------- | ------------------------------------------------------ | --------------------------------------------------- | ------------------------------------------------------------ | -------- |
| Style properties                      | `TextStyle` size, line height, spacing, color, opacity | `guides/text/style-text`, `reference/text-style`    | `text-style-basics`                                          | yes      |
| Property lists and named rules        | `PropertyList`, `TextStyle.create`                     | `guides/text/reuse-styles`                          | `text-style-composition`                                     | yes      |
| Inline spans                          | `span`, `txt`, nested `<Text>`                         | `guides/text/rich-text`, `reference/formatted-text` | `text-spans`                                                 | yes      |
| Outline and shadow                    | `TextStyle.outline`, `TextStyle.shadow` (MSDF)         | `guides/text/outline-and-shadow`                    | `text-outline-shadow`                                        | yes      |
| Decorations                           | `TextStyle.decoration`                                 | `guides/text/decorations`                           | `decorations`                                                | yes      |
| OpenType features                     | `TextStyle.features`, `FontFeature`                    | `guides/text/opentype-features`                     | `text-opentype-features`                                     | yes      |
| Languages, scripts, CJK line breaking | `TextStyle.language`, UAX #14                          | `guides/text/languages-and-scripts`                 | `text-language-shaping`, `text-cjk-line-breaking`, `shaping` | yes      |
| Direction and bidi                    | `TextStyle.direction`                                  | `guides/text/bidirectional-text`                    | `text-bidi`                                                  | yes      |

### Paragraph layout

| Feature                 | Public surface                                       | Page                                                         | Demo                                              | Verified |
| ----------------------- | ---------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------- | -------- |
| Constraints             | `Constraints.width` / `height` modes                 | `guides/layout/size-a-paragraph`, `reference/constraints`    | `layout-constraints`                              | yes      |
| Anchor                  | `Constraints.anchor`, `anchorOffset`                 | `guides/layout/anchor-text`                                  | `layout-anchor`, `layout-anchor-references`       | yes      |
| Wrapping and alignment  | `wrap`, `align`                                      | `guides/layout/wrap-and-align`, `reference/paragraph-layout` | `layout-wrap`, `layout-align`, `paragraph-layout` | yes      |
| Justification           | `justify` bounds, `lastLine`                         | `guides/layout/justify`                                      | `justify`, `layout-justify-bounds`                | yes      |
| Overflow and truncation | `overflow`, `maxLines`                               | `guides/layout/truncate`                                     | `layout-truncate`                                 | yes      |
| Indent and spacing      | `firstLineIndent`, `spaceBefore`, `spaceAfter`       | `guides/layout/indent-and-spacing`                           | `layout-indent-spacing`                           | yes      |
| Columns                 | `columns`                                            | `guides/layout/columns`                                      | `layout-columns`                                  | yes      |
| Flow regions            | `flow.regions`                                       | `guides/layout/flow-through-regions`, `reference/text-flow`  | `layout-flow-regions`                             | yes      |
| Exclusions              | `TextFlowExclusion`, `wrapSide`                      | `guides/layout/wrap-around-shapes`                           | `layout-exclusion`, `layout-wrap-side`            | yes      |
| Projected flow          | `projectTextFlowBounds`, `projectTextFlowSilhouette` | `guides/layout/wrap-around-3d-objects`                       | `layout-projected-exclusion`                      | yes      |
| Drop caps               | `dropCap`                                            | `guides/layout/drop-caps`                                    | `layout-drop-cap`                                 | yes      |

### Measurement and inspection

| Feature                    | Public surface                                              | Page                                                   | Demo                                  | Verified |
| -------------------------- | ----------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------- | -------- |
| Paragraph and line metrics | `text.measure()`                                            | `guides/inspect/measure-text`, `reference/measurement` | `measurement`, `inspect-line-metrics` | yes      |
| Glyph inspection           | `glyphs()`, `readGlyphs()`, `measureGlyphs()`, `glyphFlags` | `guides/inspect/read-glyphs`                           | `inspect-glyphs`                      | yes      |
| Glyph outlines             | `outlineAt`                                                 | `guides/inspect/glyph-outlines`                        | `inspect-outlines`                    | yes      |
| Layout callback            | `onLayout`, `GlyphLayoutPhaseError`                         | `guides/inspect/react-to-layout`                       | `inspect-on-layout`                   | yes      |

### Editing

| Feature                       | Public surface                              | Page                                                      | Demo                                           | Verified |
| ----------------------------- | ------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------- | -------- |
| Hit testing, caret, selection | `hitTest`, `caret`, `rangeRects`            | `guides/editing/caret-and-selection`, `reference/editing` | `caret`, `editing-bidi-caret`                  | yes      |
| Movement and boundaries       | `move`, `boundary`                          | `guides/editing/keyboard-movement`                        | `editing-movement`, `editing-boundary`         | yes      |
| Exact edits                   | `replace`, `TextOffsetError`                | `guides/editing/edit-text`                                | `editing`                                      | yes      |
| Input methods                 | composition over `replace` and `rangeRects` | `guides/editing/input-methods`                            | none (the host forwards no composition events) | n/a      |
| An editable field, end to end | all of the above                            | `tutorials/editable-text-field`                           | `editing-field`                                | yes      |

### In a scene

| Feature                      | Public surface                                        | Page                                                         | Demo                                                                                     | Verified |
| ---------------------------- | ----------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | -------- |
| Text as scene objects        | transforms, depth, perspective                        | `guides/scene/place-text-in-3d`                              | `depth`, `off-axis`, `orbit`                                                             | yes      |
| Labels                       | billboards, anchors                                   | `guides/scene/labels`                                        | `labels`                                                                                 | yes      |
| Groups, batching, draw order | `TextGroup`, `batching`, `renderOrder`                | `guides/scene/group-and-batch`, `reference/three-text-group` | `groups`, `batching`, `scene-draw-order`                                                 | yes      |
| Frustum culling              | default culling, `frustumCulled`, `boundsPadding`     | `guides/scene/culling`                                       | `scene-culling`                                                                          | yes      |
| Materials and positions      | `defineTextMaterial`, `position`, `paragraphPosition` | `guides/scene/custom-materials`, `reference/three-materials` | `materials`, `relief`, `ripple`, `scene-material-positions`, `card-cycle`, `marble-type` | yes      |
| Post-processing              | bloom                                                 | `guides/scene/post-processing`                               | `bloom`                                                                                  | yes      |
| Detached glyphs              | `split()`, `Glyphs`, `Decorations`                    | `guides/scene/animate-glyphs`, `reference/three-glyphs`      | `break-apart`, `arc`, `ribbon`                                                           | yes      |
| `Text`                       | every property and method                             | `reference/three-text`                                       | n/a                                                                                      | n/a      |

### Renderers and frameworks

| Feature                       | Page                                                    | Demo                                                 | Verified |
| ----------------------------- | ------------------------------------------------------- | ---------------------------------------------------- | -------- |
| three.js                      | `guides/renderers/three`                                | every scene's `three.ts` twin (typechecked, not run) | n/a      |
| React Three Fiber             | `guides/renderers/react-three-fiber`, `reference/react` | every scene                                          | yes      |
| Vue and TresJS                | `guides/renderers/vue`, `reference/vue`                 | n/a (`apps/tres-playground`)                         | n/a      |
| TypeGPU                       | `guides/renderers/typegpu`, `reference/typegpu`         | n/a (`apps/typegpu-hello-world`)                     | n/a      |
| three.js with TypeGPU shaders | `guides/renderers/three-typegpu`                        | n/a                                                  | n/a      |
| PixiJS 3D                     | `guides/renderers/pixi3d`, `reference/pixi3d`           | n/a                                                  | n/a      |

### Errors, project tasks, integrators, explanation

| Topic                   | Page                                                 |
| ----------------------- | ---------------------------------------------------- |
| Error classes and codes | `reference/errors`                                   |
| Handling errors         | `guides/project/handle-errors`                       |
| Performance tasks       | `guides/project/performance`                         |
| Testing                 | `guides/project/testing`                             |
| TypeScript              | `guides/project/typescript`                          |
| Troubleshooting         | `guides/project/troubleshooting`                     |
| Migrating from 0.1      | `guides/project/migrate-from-0.1`                    |
| Custom raster format    | `guides/project/custom-format`                       |
| `@pmndrs/glyph/core`    | `reference/core`                                     |
| Shader libraries        | `reference/shaders`                                  |
| How it works            | `explanation/how-it-works` (demo `shaping`)          |
| Coordinate spaces       | `explanation/coordinate-spaces`                      |
| Render plan             | `explanation/render-plan`                            |
| Renderer integration    | `explanation/renderer-integration`                   |
| Performance model       | `explanation/performance` (demos `batching`, `zoom`) |
| Topologies              | `explanation/topologies`                             |

## Open items

- Demos still missing: runtime baking (needs the worker and its imports to be emitted beside each other by the site
  build) and input methods (needs composition events forwarded by the proxy).
- Vue, TypeGPU and PixiJS 3D snippets that import their peer (`vue`, `@tresjs/core`, `typegpu`, `@pixi/3d`, `pixi.js`)
  are marked `ts ignore` (11 fences) because those peers are not dependencies of the site package.
- The `three.ts` twins are typechecked and never executed.
