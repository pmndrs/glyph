---
type: Implementation Plan
title: Documentation site outline
description: Every page of the published @pmndrs/glyph docs site — purpose, sections, code evidence, example, and source — organized by value to the reader and stubbed under site/docs.
documentation_type: reference
tags: [docs-site, outline, examples, api, react, three]
status: draft
generated:
  by: 'anthropic/claude-fable-5-1'
  at: '2026-09-02T00:00:00Z'
sources:
  - id: docs-site-plan
    resource: docs-site.md
    title: Documentation site and landing page plan
  - id: three-api
    resource: three-api.md
    title: Three.js text API
  - id: core-api
    resource: core-api.md
    title: Core text API
  - id: decisions
    resource: decision-register.md
    title: Decision register
  - id: pmndrs-docs
    resource: https://github.com/pmndrs/docs
    title: "@pmndrs/docs 4.1.2"
  - id: r3f-docs
    resource: https://r3f.docs.pmnd.rs
    title: React Three Fiber documentation
  - id: uikit-docs
    resource: https://github.com/pmndrs/uikit/tree/main/docs
    title: uikit documentation source
---

# Documentation site outline

This is the map of the published site. Every page below exists as a stub under `site/docs/` with the section headings,
code evidence, and reader guidance already in place; the prose is what remains to write. Pages are ordered by value to
a reader who has never seen the library: what it is, how to get text on screen, how to feed it fonts, how to shape
what it draws, and only then how it works underneath.

The API it documents is the one on the `pmndrs-text-font-baker-core` working tree, read from its source rather than
its planning documents, several of which lag the code. The facts the pages rest on, with the decision that fixed each:
`glyph.fontFace(source, { family?, format? })` as the one load boundary with `face.default === face` and every other
declared format a distinct member (D-297, D-310); lowercase `useMsdf`/`useBitmap`/`useSlug` over
`useFont(source, { format })`, and a `GlyphProvider` that takes `handle | root`, `fontFaces`, `fallback`, and
`errorFallback` (D-301, D-302); a handle that owns an anonymous root and yields named siblings through `handle(name)`,
with `TextGroup` demoted to a scene-hierarchy parent (D-307); `glyph.shape()` as the sole publication call, with no
`shape()` on `Text` (D-312); `RasterFormat` as the public vocabulary and a material context discriminated on `kind`
then `format` (D-306, D-308, D-311); `GlyphConfig` as `schema / fonts / encode / resolve / renderer / root` with no
decode hook and no `/core` subpath (D-309, D-314); explicit `face.clone()` for cross-realm transfer (D-313). The
current `three-api.md` there still describes `label.shape()` and group-owned capacity; the stubs follow the code.

## House style

Composition follows the pmndrs sites, measured from the r3f and uikit sources rather than remembered:

| Element | Convention | Where it came from |
| --- | --- | --- |
| Frontmatter | `title`, `description`, `nav` (global sort key), optional `sourcecode`, `image` | `@pmndrs/docs` `utils/docs.tsx` reads exactly these |
| Sidebar order | one global `nav` sort; a category appears where its lowest-`nav` page appears | `docs.sort((a, b) => a.nav - b.nav)` |
| Opening | `<Intro>` one-paragraph claim, then `<Keypoints title="…">` with `<KeypointsItem>` | r3f introduction; `Keypoints.tsx` |
| Callouts | GitHub alert syntax `> [!NOTE]` / `TIP` / `IMPORTANT` / `WARNING` / `CAUTION` (rehypeGha) | `Gha/rehypeGha.ts` |
| Live example | `<Sandpack>` for tiny dependency-free snippets; hosted `/examples/<slug>/` iframe for anything needing Wasm or WebGPU | Sandpack cannot load our Wasm or a WebGPU device |
| Long tables | wrap in `<details><summary>` | uikit components-and-properties |
| Comparison | a three-column table: approach, best for, tradeoff | uikit custom-fonts |
| Tutorial voice | short claim, then the code that proves it, then what happened; "Let's…" only in tutorials | r3f your-first-scene |
| Reference voice | signature, table of members, one snippet per behaviour, no narration | r3f objects/hooks |

Tone: a trusted mentor teaching a capable peer. State the fact, show the code, move on.

## Site map

Global `nav` numbers are assigned in blocks so a page can be inserted without renumbering a section.

| nav | Path | Title | Purpose |
| --- | --- | --- | --- |
| 0 | getting-started/introduction | Introduction | What it is, why it exists, hello world, FAQ |
| 1 | getting-started/installation | Installation | Package, subpaths, bundlers, WebGPU entry, TypeScript |
| 2 | getting-started/your-first-text | Your first text | Tutorial: bake → load → render → style → measure |
| 3 | getting-started/examples | Examples | Gallery of every hosted example |
| 10 | fonts/baking | Baking fonts | `glyph bake` flags, `glyph glyphs`, subsetting, `--check`, discovery, Node API and report, errors, what is in the GLB — finished prose |
| 11 | fonts/techniques | Raster formats | Bitmap, MSDF, Slug: choosing table, per-format facts, measured costs, identity, mixing — finished prose |
| 12 | fonts/loading | Loading fonts | `loadFont`, hooks, preload, libraries, `FontLoader`, FontFace (pending) |
| 13 | fonts/fallback-stacks | Fallback stacks | `createFontStack`, per-cluster resolution, icons, CJK |
| 14 | fonts/runtime-baking | Runtime baking | Source fonts in the browser, Worker, CacheStorage |
| 20 | text/text-and-groups | Text, roots, and TextGroup | Handles, roots, `glyph.shape()`, capacity, compositing, ownership |
| 21 | text/styling | Styling | `TextStyle`: size, spacing, color, opacity, outline, shadow, decoration, features |
| 22 | text/paragraph-layout | Paragraph layout | `ParagraphLayout` + `Constraints`: wrap, align, overflow, justify, columns |
| 23 | text/rich-text | Rich text | Spans, `txt`/`span`, nested `<Text>`, cluster rule, editing |
| 24 | text/measurement | Measurement | `measure()`, `glyphs()`, `Paragraph`, summary fields, cost |
| 25 | text/interaction | Interaction | `caretAt`, `selectionRects`, editing loop |
| 26 | text/materials | Materials | `defineTextMaterial`, per-technique TSL nodes, lighting |
| 27 | text/in-3d | Text in 3D | depth and occlusion, render order, billboarded labels, fog, steep angles, post-processing |
| 28 | text/break-apart | Break apart | `breakApart()` → `Glyphs`/`Decorations`, matrices, physics, text on a path |
| 29 | text/errors | Errors | `TextFrameError`, `onError`, retention, capacity |
| 40 | react/components | Components | `GlyphProvider`, `<Text>`, `<TextGroup>`, props, nesting |
| 41 | react/hooks | Hooks | `useFont`, `useMSDF`, `useBitmapFont`, `useSlug`, preload/clear |
| 50 | advanced/performance | Performance | Batching, capacity, DPR, pixel snapping, transform-only path |
| 51 | advanced/pitfalls | Pitfalls | The mistakes the API lets you make, and their fix |
| 52 | advanced/how-it-works | How it works | Shaper → planner → render plan → renderer, with diagrams |
| 53 | advanced/topologies | Deployment topologies | Handles, canvases, workers, OffscreenCanvas |
| 54 | advanced/custom-renderers | Integrating a renderer | `defineGlyphConfig` field by field, the schema callbacks, the lifecycle, root rules, read through `@pmndrs/glyph-example-renderer` — finished prose |
| 55 | advanced/codec | Building a codec | technique schema, `techniqueProgram`, semantics and bindings, `compile`, `createCodecProgram`, masks, ids, limits |
| 56 | advanced/render-plan | Reading the render plan | the publication: header, six tables, batching, checkpoints, expiry, the consume transaction, the ten guarantees |
| 57 | advanced/custom-techniques | Custom raster formats | `defineRasterFormat`, the plan program (`codecBody` + `compileFont`), `registerRasterPlanProgram`, identity, artifact, bakers, shaders — read through `@pmndrs/glyph-example-raster` — finished prose |
| 58 | advanced/typescript | TypeScript | Technique inference, `PropertyList`, branded ids |
| 59 | advanced/testing | Testing | Node, test-renderer, headless GPU |
| 60 | advanced/migration | Migration | From the pre-handle API |

The earlier `core-api/introduction.mdx` shell is superseded by `text/measurement`, `advanced/how-it-works`, and
`advanced/custom-renderers`, and is removed.

## Examples

Examples are small, one feature each, and run as React Three Fiber scenes in the maintained examples package
(`apps/r3f-hello-world`, published as `@pmndrs/glyph-examples`, D-304), which selects a scene by `?example=<slug>`. The
site build hosts that app at `/examples/` so the docs can iframe `/examples/?example=<slug>` from the same origin. Each
example ships two files: the R3F scene that runs, and a three.js twin that is typechecked but never executed, so a
reader sees the imperative parallel beside the component. A shared stage owns the canvas, camera, lights, and dark
ground, so each scene file is only the text it demonstrates. Art is generated — gradients, noise, simple lit
materials — never loaded, to keep the bundle small.

| Slug | Page | Shows |
| --- | --- | --- |
| hello | getting-started/introduction | one `<Text>`, one font, one line |
| first-text | getting-started/your-first-text | the tutorial's finished state |
| techniques | fonts/techniques | the same word in Bitmap, MSDF, Slug at three sizes |
| text-ladder | fonts/techniques | 8 → 1024 px, one technique per row |
| fallback-stack | fonts/fallback-stacks | Latin + icon + CJK stack, per-cluster face |
| runtime-bake | fonts/runtime-baking | load a TTF, watch the Worker bake it |
| groups | text/text-and-groups | many labels, draw count with and without a group |
| styling | text/styling | every `TextStyle` property, one control each |
| decorations | text/styling | underline, overline, line-through, every line style, thickness and offset, a gradient decoration material |
| paragraph-layout | text/paragraph-layout | wrap/align/overflow/columns on an animated box |
| justify | text/paragraph-layout | justification bounds and last-line policy |
| rich-text | text/rich-text | `txt`/`span` and nested `<Text>`, per-span font and material |
| editing | text/rich-text | keystroke editing with retained spans |
| measurement | text/measurement | `measure()` box vs ink bounds, live |
| caret | text/interaction | caret, selection rects, click to place |
| materials | text/materials | lit PBR material over MSDF coverage |
| effects | text/materials | outline, shadow, animated color |
| depth | text/in-3d | a sphere passing in front of and behind a depth-tested word and a default one |
| labels | text/in-3d | billboarded, depth-tested labels on orbiting bodies, in fog |
| off-axis | text/in-3d | a Slug paragraph turning away from the camera |
| bloom | text/in-3d | one bright word through `bloom`, strength animated as a uniform |
| break-apart | text/break-apart | explode, physics-free tumble, reset |
| arc | text/break-apart | a line bent into a ring: advance → angle, radius from `measure().contentWidth` |
| errors | text/errors | provoke each `TextFrameError` cause |
| provider | react/components | two handles, two providers, one font |
| hooks | react/hooks | preload, Suspense, StrictMode |
| batching | advanced/performance | the same labels in a `TextGroup`, materials interleaved (30 draws) vs sorted into runs (2) |
| raster-ratio | advanced/performance | DPR and `rasterPixelRatio` on a paragraph seen larger than authored |
| zoom | advanced/performance | continuous zoom across techniques |
| shaping | advanced/how-it-works | Arabic joining, Indic reordering, mixed bidi, CJK breaks |

## Pages

Each entry: what the page is for, its sections with the fact or code each carries, the example it embeds, and the
source that proves it. Sections match the H2s in the stub.

### getting-started/introduction (nav 0)

Purpose: a reader decides in one screen whether this solves their problem.

- `<Intro>`: shapes and lays out text in Rust/Wasm, publishes a render plan, Three.js draws it; Bitmap, MSDF, Slug; WebGPU with WebGL2 fallback.
- Install: `npm install three @react-three/fiber @pmndrs/glyph`.
- What does it look like: hello example, R3F form (`useMSDF` + `<Text>`), then the same in vanilla (`glyph.init()` → `glyph.handle('main', ThreeConfig)` → `createText`).
- FAQ as H2s, r3f-style: Does it need WebGPU? (no; WebGL2 fallback is Three's) · Is it slower than a texture atlas of sprites? (batching, one draw per technique/resource boundary) · Which scripts? (HarfRust; Arabic, Indic, CJK, bidi; horizontal) · Can I use my own shader? (`defineTextMaterial`) · Where does layout run? (Rust; JS owns Unicode analysis).
- Ecosystem: drei, uikit (integration doc), postprocessing via `useRenderPipeline`.
- Sources: ADR 0001–0003, `docs/packages/glyph.md` "Public package surfaces", `apps/r3f-hello-world/src/app.tsx`.

### getting-started/installation (nav 1)

- Package and peers: `three`, `@react-three/fiber` (WebGPU entry), React 19.
- Subpaths table: root, `/three`, `/three/{bitmap,msdf,slug}`, `/react`, `/react/{bitmap,msdf,slug}`, `/raster/*`, `/bake`, `/runtime-bake`, `/core`, `/tsl`, `/typegpu`, `/bakers/*`, the five `.wasm` exports — with what each pulls into a bundle.
- Bundlers: Vite (Wasm as asset, `?url`), Next (the paris-site workaround), `dedupe` for react/three.
- Renderer entry: `@react-three/fiber/webgpu`; `WebGPURenderer` falls back to WebGL2 on its own; secure-context note (`navigator.gpu` absent on plain http, WebGL2 still present).
- TypeScript: `exactOptionalPropertyTypes` friendliness, `const` generics on `defineFont`/`loadFont`.
- Sources: `packages/glyph/package.json` exports, ADR 0001, site/vite.config.ts.

### getting-started/your-first-text (nav 2)

Tutorial. Each step ends with what the reader now sees.

1. Bake: `glyph bake --input Inter.ttf --output public/inter.font.glb --msdf`.
2. Load: `const inter = useMSDF({ baked: '/inter.font.glb' })`.
3. Render: `<Text font={inter}>Hello</Text>` inside `<Canvas>` from the WebGPU entry.
4. Style: `style={{ fontSize: 48, color: '#ffd166' }}`.
5. Lay out: `layout={{ wrap: 'word', align: 'center' }} constraints={{ width: { mode: 'at-most', size: 6 } }}`.
6. Measure: `ref.current.measure().contentWidth` to center it.
7. The same in vanilla Three, side by side.

Sources: three-api.md "Create text", react.ts `R3fTextProps`.

### getting-started/examples (nav 3)

`<Grid cols={2}>` of every example above with a generated thumbnail; each card links to the hosted example and to
its docs page.

### fonts/baking (nav 10)

- Why bake: shaping data + rasters in one GLB; nothing platform-specific at runtime.
- `glyph bake` direct mode: the full flag table from `bakeUsage()`; examples for MSDF with `em-size=32,pixel-range=6`, Bitmap strikes, Slug, `--unicodes`.
- Subsetting: `glyph glyphs font.ttf --name globe --unicode-set` → `--unicodes`; code points not glyph ids.
- Discovery mode: `defineFont(input, technique)` tokens found statically; `--project-root`, `--entry`, `--asset-root`, `--output-root`.
- Node API: `@pmndrs/glyph/bake` — `bakeFont`, `bakeProject`, the JSON report.
- Reproducibility: `--check` rebuilds to temp and requires byte-identical output.
- Coverage: `RasterCoverage { unicodeRanges | text | glyphIds }` per raster request.
- Sources: `src/node/cli.ts` usage text, `src/font.ts` `defineFont`, D-296 CLI default note (pending).

### fonts/techniques (nav 11)

- The three-way table: technique · best at · sizes · texture format · options · cost.
- Bitmap: `{ strikes: [8, 16], coverage? }`, `r8unorm`, exact device-pixel strikes, `pixelSnapping`, fill and opacity only.
- MSDF: `{ emSize?: 64, pixelRange?: 8, coverage? }`, `rgba8unorm`, general default, outline/shadow support, bake-time cost of `emSize`.
- Slug: no options, curve/header/reference textures, analytic coverage, large and zoomed text.
- Identity: options are part of the raster key; a request must name the bake's options or it misses (`emSize` mismatch is the classic).
- Mixing techniques in one paragraph via a stack.
- Examples: techniques, text-ladder.
- Sources: `raster/*.ts`, `internal/msdf-contract.ts`, `internal/bitmap-contract.ts`, ADR 0003, D-110.

### fonts/loading (nav 12)

- `loadFont(input, technique, options?)` and the tuple form `loadFont(input, [msdf, slug])`.
- Inputs: `{ baked }` vs `{ source, runtimeBake }`; `FontLoadOptions.signal`.
- React: `useFont(input, technique, options?)`, typed `useMSDF`/`useBitmapFont`/`useSlug`, `.preload()`, `.clear()`; cache is R3F's `useLoader`; StrictMode safety.
- `FontLibrary` for explicit caching with leases; top-level `loadFont` only coalesces in-flight work.
- `FontLoader` (Three `Loader`) for `LoadingManager` users.
- Ownership: fonts are immutable root values; bind to any handle; dispose after text.
- `> [!NOTE]` FontFace (D-296): `glyph.fontFace({ family, src })`, `.load()`, `.bitmap/.msdf/.slug`, `GlyphProvider fonts={}` — approved, not yet implemented; shown as the direction.
- Example: hooks (shared with react/hooks).
- Sources: `loader.ts` overloads, `react.ts` `UseFont`, `three/font-loader.ts`, D-286, D-296.

### fonts/fallback-stacks (nav 13)

- `createFontStack(primary, ...fallback)`; resolution per grapheme cluster; `missingGlyphCount`.
- Icon fonts: bake a subset, put the icon face second; nested `<Text font={icon}>` for a single glyph.
- CJK: TrueType faces; the CFF caveat; vertical layout not yet.
- Emoji: Slug for outlines; color emoji not supported.
- Example: fallback-stack.
- Sources: `loaded-font.ts`, three-api.md "Mix fallback techniques", site chorus stack.

### fonts/runtime-baking (nav 14)

- When: source fonts you cannot pre-bake; never the production default.
- `loadFont({ source, runtimeBake: bakeFontInWorker }, msdf)`; the Worker boundary; nothing in the default bundle.
- CacheStorage: identity, persistence follows the source response's freshness, quota eviction.
- Cost table: uikit-style — approach · best for · tradeoff.
- Example: runtime-bake.
- Sources: `runtime-bake.ts`, `docs/packages/glyph.md` Worker paragraphs, `internal/runtime-font-cache.ts`.

### text/text-and-groups (nav 20)

- Runtime: `await glyph.init()`, `glyph.handle('main', ThreeConfig)`; R3F does this implicitly.
- `handle.createText(props)`, `handle.createTextGroup(options)`; `Text` and `TextGroup` are `Object3D`s and draw roots; meshes become their children.
- Group semantics: one planner per group, nested groups terminate collection, `compositing: 'ordered' | 'independent'`, `renderOrder`, group `material`.
- Capacity: `{ size, policy: 'grow' | 'chunk' | 'fixed' }`, defaults (256/grow standalone, 4096/chunk group), `setCapacity()`, `fixed` keeps the last draw.
- Lifecycle: desired state → traversal publishes → `shape()` for synchronous flush → transform-only path.
- Ownership table: Text/TextGroup/handle/Font dispose order.
- Example: groups.
- Sources: three-api.md "Create text", "Batch text", "Update retained values", "Ownership and disposal"; `three/text.ts` members; D-282.

### text/styling (nav 21)

- `TextStyle` member table with units (paragraph-local), inheritance into spans, `PropertyList` merging (`[base, override, condition && more]`), `TextStyle.create()`.
- Color and opacity: `ColorInput` string or linear RGBA tuple; opacity inherited independently.
- Outline and shadow: MSDF-supported; Bitmap rejects rather than degrades.
- Decoration: underline/overline/lineThrough from baked metrics; only `solid`; thickness/offset overrides.
- Features: `{ tag, value?, start?, end? }`; ligatures, small caps, tabular numbers.
- Language and direction.
- Example: styling, effects.
- Sources: `text-properties.ts`, `font-feature.ts`, D-246, D-248, ADR 0003 Bitmap note.

### text/paragraph-layout (nav 22)

- The three inputs figure: `style` (inherited) · `layout` (flow) · `constraints` (box).
- `Constraints`: `AxisConstraint` `unconstrained | at-most | exact`; flexible widths resolve to content width.
- `ParagraphLayout` table: `wrap`, `align`, `overflow` (+ellipsis), `maxLines`, `firstLineIndent`, `spaceBefore/After`, `lastLine`.
- Justification: `minWordSpaceRatio` (0,1], `maxWordSpaceRatio` ≥ 1, `letterSpaceExpansion`; the deficit spill rule.
- Columns: `{ count, gap }`, requires exact width, fills in order without balancing.
- Example: paragraph-layout, justify.
- Sources: `text-properties.ts` doc comments, D-291, editorial workload.

### text/rich-text (nav 23)

- Three ways to author: `spans: [{ start, end, style }]`, `txt`/`span` template tags, nested `<Text>`.
- Per-span overrides: `font`, `style`, `material`; precedence span → text → group.
- The cluster rule (D-265): a boundary moves forward to the end of its cluster; base's style wins; empty spans persist; `alignSpansToClusters` to inspect.
- Editing: assignment derives the minimal UTF-16 edit; `text` and `spans` authored together; the removed offset helpers.
- Example: rich-text, editing.
- Sources: three-api.md "Span offsets resolve to grapheme clusters", `formatted-text.ts`, D-265, D-268.

### text/measurement (nav 24)

- `measure()` → `ParagraphLayoutSummary` field table: ascent/descent/lineHeight, width/height, contentWidth/Height, first/lastBaseline, inkBounds, overflowed, min/maxContentWidth, glyphCount, lineCount, missingGlyphCount, `lines[]`.
- Ink vs advance figure: which to center on.
- `glyphs()` → `GlyphLayoutInspection`: the typed-array columns, copied per call, `glyphStableIds`.
- `Paragraph` without a renderer: `createParagraph()`, `measure(constraints)`, `glyphs(constraints)`, three-entry LRU.
- Timing: measure before the first frame, does not commit, `commitState()` union, `boundingBox`/`computeBoundingBox()`.
- Cost table: measure vs glyphs vs traversal.
- Example: measurement.
- Sources: `layout.ts`, `paragraph.ts`, three-api.md "Measure desired layout", D-282, D-288.

### text/interaction (nav 25)

- `caretAt(x, y)` → `GlyphCaret`; `selectionRects(start, end)` → `LayoutBox[]`; both over accepted placement, `undefined` while pending.
- Clusters not characters: ligatures and bidi.
- An editing loop: pointer → caret → keystroke → `text =` assignment → next frame.
- Example: caret.
- Sources: `three/text.ts`, `glyph-placement.ts`, three-api.md.

### text/materials (nav 26)

- `defineTextMaterial((context) => NodeMaterial)`; `context.technique` union; `createDefaultMaterial()`.
- Node table per technique: bitmap `position, clipPosition, atlasUv, coverage, color`; msdf `position, atlasUv, fillCoverage, outlineCoverage, shadowCoverage, color, opacity`; slug `position, renderCoordinate, coverage, color, opacity`.
- The base contract a custom material must keep: `DoubleSide`, `depthWrite: false`, `transparent`, `positionNode = context.position` (measured on the landing); `depthTest` is a choice, see text/in-3d.
- Lit text: `MeshPhysicalNodeMaterial` with `colorNode = shader.color`, `opacityNode = shader.opacity`, a normal from paragraph-local position; why per-glyph em space lights letters independently.
- Rules: synchronous, no reentrancy, shared identity, span → text → group precedence.
- Example: materials, effects.
- Sources: `three/material.ts`, `tsl/*-shader.ts`, site `scene.tsx`, three-api.md "Define a material".

### text/in-3d (nav 27)

- The default material is `MeshBasicNodeMaterial({ blending: NormalBlending, depthTest: false, depthWrite: false, side: DoubleSide, transparent: true })` (`three/internal/material-realizer.ts` `baseTextMaterial`); text draws over geometry and never writes depth.
- Occlusion is one line: `defineTextMaterial((c) => { const m = c.createDefaultMaterial(); m.depthTest = true; return m; })`; `depthWrite` must stay off (a transparent quad would write its rectangle).
- Render order: a `Text`'s draws take its `renderOrder`; `TextGroup({ renderOrder })` states one for every child; decorations under → glyphs → line-through (`three/text.ts` `renderOrderBase`).
- Labels: child of the body, a billboard group copying `camera.quaternion`, depth-tested; scene fog applies because the material is a `NodeMaterial`.
- Steep angles: Slug per-pixel, MSDF until the atlas stretches, Bitmap screen-space only; `rasterPixelRatio` for MSDF/Bitmap seen larger than authored.
- Post-processing: `useRenderPipeline` (r3f) / `PostProcessing` (three) with `bloom` from `three/examples/jsm/tsl/display/BloomNode.js`; `bloom().strength` is a uniform.
- Example: depth, labels, off-axis, bloom.
- Sources: `three/internal/material-realizer.ts`, `three/text.ts`, `three/material.ts`, `site/landing/src/effects.tsx`, the benchmark `off-axis-3d` workload.

### text/break-apart (nav 28)

- `breakApart()` → `[Glyphs, Decorations | undefined]`, committed only, atomic.
- `Glyphs` surface table: `count`, `glyphAt`, `get/setMatrixAt`, `get/setWorldMatrixAt`, `measurements`, `materials`, `dispose`.
- `ThreeGlyphMeasurement`: `originalMatrix`, `localInkBounds`, `localAdvanceBounds`, `anchorPoint(anchor, 'ink' | 'advance')`, `geometry`.
- World-space bulk writes: invert once, `worldToLocalMatrix`, `setMatrixAt`.
- Ownership: source stays live, may be disposed first; caller owns attachment, physics, reset.
- Text on a path: radius from `measure().contentWidth / 2π` (`width` is the resolved box, `contentWidth` the advance extent), each glyph's `originalMatrix` x as arc length → angle, one `setMatrixAt` per glyph.
- Example: break-apart, arc.
- Sources: detached-glyph-slice.md, `three/glyphs.ts`, `three/glyph-measurement.ts`, D-292.

### text/errors (nav 29)

- `TextFrameError.rejection` union table: `span-range`, `cluster-boundary`, `span-overlap`, `paragraph-root`, `font-stack-missing`, `font-metrics-missing`, `capacity`, `engine`; `subject` span/paragraph/unattributed.
- Where errors surface: construction and `set()` throw; traversal retains on `text.error`/`group.error` and calls `onError`; `shape()` throws.
- Retention: last accepted draw stays; unchanged frames are not retried; `commitState().status === 'failed'`.
- Example: errors.
- Sources: `three/frame-error.ts`, D-267, D-268, D-285.

### react/components (nav 40)

- `<Text>` props table from `R3fTextProps`; `<TextGroup>` props from `R3fTextGroupProps`; refs to the Three objects.
- Nesting: nested `<Text>` is an inline run — inherits font/style, accepts only `children`, `font`, `style`, `material`; no transform.
- `GlyphProvider handle={…}`: immutable, remount to change, never disposes; no handle prop on Text.
- Default handle: implicit `glyph.init()` + `ThreeConfig` on first use; Suspense.
- `Activity` pre-render; `onError`.
- `> [!NOTE]` D-296 `fonts={}` / `fallback` / `errorFallback` direction.
- Example: provider.
- Sources: `react.ts`, D-294, D-295, `docs/packages/glyph.md` R3F paragraphs.

### react/hooks (nav 41)

- `useFont`, `useMSDF`, `useBitmapFont`, `useSlug` signatures; options are part of the cache key.
- `preload()` before render; `clear()` semantics; lease ledger; StrictMode.
- Sources: `react.ts` `UseFont`, font-runtime-ownership "React and Suspense ownership".

### advanced/performance (nav 50)

- Where time goes: shaping (Wasm), publication, renderer commit, transform-only frames.
- Draw boundaries: technique, resource, material, clipping, compositing; `compositing: 'independent'` (505 → 121 draws on the landing).
- Capacity policy and `gpuBytes`; `rasterPixelRatio`; DPR clamp; `pixelSnapping` for Bitmap.
- Measurement cost and speculative transactions.
- Examples: batching, off-axis, zoom.
- Sources: three-api.md, site landing measurements, ADR 0004.

### advanced/pitfalls (nav 51)

Each pitfall: symptom → cause → fix, one paragraph.
Unloaded font at construction · outer `<Text>` without `font` · options not matching the bake (`emSize`) · `text` without `spans` clears spans · `fixed` capacity keeps the old draw · dispose order · measuring before attach (`Paragraph` instead) · WebGPU absent on http · CFF CJK fonts · `crypto.subtle` on non-secure origins (fixed on the identity branch).

### advanced/how-it-works (nav 52)

- Pipeline figure (mermaid): text → JS Unicode analysis (UAX 9/14/24/29) → Wasm HarfRust shaping → Rust layout in F26.6 → render plan (resources, buffers, patches, primitives, draws, retirements) → Three executor → meshes.
- Retained frame transaction: desired → publish → prepare → commit/discard; A/B slots.
- Why layout is exact: integer units, one rounding contract.
- Example: shaping.
- Sources: ADR 0002, D-254, D-285, core-api.md "Semantic render-plan surface".

### advanced/topologies (nav 53)

- Handles vs scenes vs renderers; two canvases; mirrored; OffscreenCanvas; workers; device loss. Mermaid figures from font-runtime-ownership.
- Cardinality table.

### advanced/custom-renderers (nav 54)

- `/core` in one screen: `GlyphConfig { encode, decode, resolve, renderer, createHandle }`, `Codec`, `defaultDecoder`, `BorrowedBoundCommandBuffer` phases, `applyGlyphPublication`.
- Pointer to the renderer-integration guide and the example renderer package.

### advanced/codec (nav 55)

- `defineTechniqueSchema({ technique, scope, binding, buffers, resources?, render?, glyphOrigin? })`; lanes 1–4 per buffer, lane count is the vector width; ids from `id.buffer/technique/program` (FNV-1a of names).
- `techniqueProgram(schema, { system, textEffects?, inverseFontSize? })` → `semantics` (inlineOrigin, blockOrigin, fontSize, color.rgba, outline?, shadow?, transformIndex, stableGlyphId), `binding`, `compile(stores)`; straight-line `f32`/`u32` ops; every lane written exactly once; ≤32 registers.
- `createCodecProgram(techniqueId, programId, body, buffers, { transformMode, allocationMode, partitionBy })` → `storageKeyMask`, `drawKeyMask`; bit values technique 1, resource 2, program 4, material 8, clip 16, depth 32, order 64, transform 128; `primitiveKind`, `resourceKindMask`.
- Limits: 8 capability sets, 32 programs, 16 buffers/program, 128 ops/program.
- Worked examples: three's decoration program; the MSDF glyph program.
- Sources: `config/schema.ts`, `config/codec-program.ts`, `config/codec.ts`, `three/codec.ts`, `raster/msdf.ts`.

### advanced/render-plan (nav 56)

- Header (144 B): flags.checkpoint, engineRevision, planRevision, requiredBaseRevision, publicationGeneration, outputSlot, codec identity, six offset/count pairs, fault ids.
- Tables and strides: resources 40, buffers 36, patches 36, primitives 64, draws 64, retirements 24; patch opcodes allocate-or-resize 1, write 2, fill 3, copy 4, retire 5.
- Batching: storage batch = technique · programVariant · programId · resource(id, generation) [+ material/clip/depth per storageKeyMask]; draw span ends on batch change, non-contiguous slots, a drawKeyMask key, or 65 535 records; independent compositing sorts draws by orderToken.
- Expiry: epoch advance, memory growth, transport disposal; lease expired in `finally` after accept; copy payloads during accept.
- Consume: source → project → decode → commit → settle; discard on throw; the ten guarantees.
- Sources: `internal/plan-view.ts`, `internal/handle-state.ts`, `internal/render-planner.ts`, `three/engine-plan-target.ts`, `rust/shaper/src/engine/{ordered_plan,render_plan,plan_draw}.rs`.

### advanced/custom-techniques (nav 55)

- `defineRasterTechnique`, `defineRasterResourceId`, bakers via `defineRasterBaker`/`rasterBake`, shader realizations in `/tsl` and `/typegpu`, `registerThreeRasterPlanProgram` and its registration-order rule (D-271).

### advanced/typescript (nav 56)

- `Font<typeof msdf>`, technique union inference through `FontStack`, `PropertyList<T>`, `const` generics, `TextInput` vs `FormattedText`, branded `GlyphKey`/`RasterKey`.

### advanced/testing (nav 57)

- Node: `@react-three/test-renderer/webgpu`; headless Chromium with a GPU; what CI has (no WebGPU; WebGL2 fallback).

### advanced/migration (nav 58)

- Table old → new: `new FontLoader().loadAsync` → `loadFont`/hooks; implicit domain → `glyph.handle`; `Text.layout()` → `measure()`; `insertText`/`deleteText`/`replaceText`/`setSpan`/`removeSpan` → assignment; `paint` → `style`.

## Findings for core (2026-09-02, codex tree at 4ed218c1d plus uncommitted planner/retention edits)

Measured while building the examples against `GLYPH_SOURCE=<codex>/packages/glyph`; each is reproducible from the named example.

| Finding | Evidence | Example |
| --- | --- | --- |
| Decoration draws collapse to nothing | the decoration draw's transform-index lane holds `0x80000009`-style values (a flag bit over the index) while glyph draws hold `1, 2, 3`; `indexedTransformNodes` multiplies the raw value, reads a zero matrix, and the quad collapses. `rect` (0, 0.387, 3.61, 0.023) and the packed color `#e7ecf6` are correct. | decorations |
| Only `solid` decoration style is implemented | `Text style decoration style 'double' is not implemented; only 'solid' is supported` is thrown at construction for `double`, `dotted`, `dashed`, `wavy` | decorations |
| `compositing: 'independent'` does not fold interleaved materials | thirty labels alternating two materials in one `TextGroup` plan 30 draws under both modes; sorted into two runs they plan 2; standalone Texts plan one draw each | batching |
| A thrown Text construction error in React becomes a retry loop | after the `'double'` throw, `Cannot convert undefined or null to object` repeats from the React layer (the rejected-promise eviction seen with fonts); the scene stays blank with no boundary | decorations, before its fix |
| React recovered from a render error | `Minified React error #520` (recovered by a synchronous render) with cause `#467` (update hook called on initial render), once, on the decorations page under the React Compiler | decorations |
| `measure().width` is the resolved box; `contentWidth` is the advance extent | a ring built from `width` left a gap; `contentWidth` closes it | arc |
| `/core` subpath is gone; the codec DSL and `defineGlyphConfig` are root exports | `package.json` exports and `tests/package/entry-point-boundaries.test.mjs` assert `exports['./core'] === undefined`; `docs/log.md` still names `/core` | — |
| `TextFrameError` is declared, never produced | `three/frame-error.ts` exports the cause union; `textFrameError()` has no caller; `shape()` failures surface as `GlyphEngineStatusError` on `text.error` / `onError` / `commitState()` | errors page carries the caveat |
| every font load requires `crypto.subtle` | `loader.ts` `_registerAsset` hashes the artifact on every load; `raster-identity.ts`, `compose-bake.ts`, `runtime-font-cache.ts` too; no pure-JS fallback in that tree (the `fix/font-identity-no-secure-context` branch here removes it) | installation page warns |
| no "every glyph rasterised empty" guard | bitmap and MTSDF bakers mark unreadable outlines absent silently; a CFF face bakes shaping data and an empty raster | baking page warns |

The pane the examples are verified in is hidden between tool calls (`document.hidden === true`, no rAF), and r3f's Canvas mounts children only once its container measures: take a throwaway screenshot before waiting, then the real one, and navigate with a fresh query string after every rebuild so cached HTML does not 404 on old chunks.

## Verification

- `pnpm --filter @pmndrs/glyph-site check:docs` compiles every MDX page.
- Every code sample names only exports present on the redesign tree's source.
- The examples are written against that tree and verified against it before it merges, two ways:
  `site/.examples-codex.tsconfig.json` (ignored; generated with `paths` into the other checkout) typechecks every
  scene and twin with `tsc -p`, and `GLYPH_SOURCE=<checkout>/packages/glyph pnpm build:examples` builds the real
  bundle through aliases read from that package's `exports` map. Both pass at zero errors. `check:examples` joins
  the site's `check` when the package on this branch carries the same surface.
