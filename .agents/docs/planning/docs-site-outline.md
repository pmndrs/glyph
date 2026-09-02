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
| 10 | fonts/baking | Baking fonts | `glyph bake`, `glyph glyphs`, Node API, discovery, `--check` |
| 11 | fonts/techniques | Raster formats | Bitmap, MSDF, Slug: what, when, options, cost |
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
| 27 | text/break-apart | Break apart | `breakApart()` → `Glyphs`/`Decorations`, matrices, physics |
| 28 | text/errors | Errors | `TextFrameError`, `onError`, retention, capacity |
| 40 | react/components | Components | `GlyphProvider`, `<Text>`, `<TextGroup>`, props, nesting |
| 41 | react/hooks | Hooks | `useFont`, `useMSDF`, `useBitmapFont`, `useSlug`, preload/clear |
| 50 | advanced/performance | Performance | Batching, capacity, DPR, pixel snapping, transform-only path |
| 51 | advanced/pitfalls | Pitfalls | The mistakes the API lets you make, and their fix |
| 52 | advanced/how-it-works | How it works | Shaper → planner → render plan → renderer, with diagrams |
| 53 | advanced/topologies | Deployment topologies | Handles, canvases, workers, OffscreenCanvas |
| 54 | advanced/custom-renderers | Custom renderers | `defineGlyphConfig`: schema, encode, resolve, renderer, root |
| 55 | advanced/custom-techniques | Custom raster formats | `defineRasterFormat`, bakers, `/tsl/*`, `/typegpu/*` |
| 56 | advanced/typescript | TypeScript | Technique inference, `PropertyList`, branded ids |
| 57 | advanced/testing | Testing | Node, test-renderer, headless GPU |
| 58 | advanced/migration | Migration | From the pre-handle API |

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
| paragraph-layout | text/paragraph-layout | wrap/align/overflow/columns on an animated box |
| justify | text/paragraph-layout | justification bounds and last-line policy |
| rich-text | text/rich-text | `txt`/`span` and nested `<Text>`, per-span font and material |
| editing | text/rich-text | keystroke editing with retained spans |
| measurement | text/measurement | `measure()` box vs ink bounds, live |
| caret | text/interaction | caret, selection rects, click to place |
| materials | text/materials | lit PBR material over MSDF coverage |
| effects | text/materials | outline, shadow, animated color |
| break-apart | text/break-apart | explode, physics-free tumble, reset |
| errors | text/errors | provoke each `TextFrameError` cause |
| provider | react/components | two handles, two providers, one font |
| hooks | react/hooks | preload, Suspense, StrictMode |
| batching | advanced/performance | draw calls vs compositing mode |
| off-axis | advanced/performance | steep angles, DPR, `rasterPixelRatio` |
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
- The base contract a custom material must keep: `DoubleSide`, `depthTest: false`, `transparent`, `positionNode = context.position` (measured on the landing).
- Lit text: `MeshPhysicalNodeMaterial` with `colorNode = shader.color`, `opacityNode = shader.opacity`, a normal from paragraph-local position; why per-glyph em space lights letters independently.
- Rules: synchronous, no reentrancy, shared identity, span → text → group precedence.
- Example: materials, effects.
- Sources: `three/material.ts`, `tsl/*-shader.ts`, site `scene.tsx`, three-api.md "Define a material".

### text/break-apart (nav 27)

- `breakApart()` → `[Glyphs, Decorations | undefined]`, committed only, atomic.
- `Glyphs` surface table: `count`, `glyphAt`, `get/setMatrixAt`, `get/setWorldMatrixAt`, `measurements`, `materials`, `dispose`.
- `ThreeGlyphMeasurement`: `originalMatrix`, `localInkBounds`, `localAdvanceBounds`, `anchorPoint(anchor, 'ink' | 'advance')`, `geometry`.
- World-space bulk writes: invert once, `worldToLocalMatrix`, `setMatrixAt`.
- Ownership: source stays live, may be disposed first; caller owns attachment, physics, reset.
- Example: break-apart.
- Sources: detached-glyph-slice.md, `three/glyphs.ts`, `three/glyph-measurement.ts`, D-292.

### text/errors (nav 28)

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

### advanced/custom-techniques (nav 55)

- `defineRasterTechnique`, `defineRasterResourceId`, bakers via `defineRasterBaker`/`rasterBake`, shader realizations in `/tsl` and `/typegpu`, `registerThreeRasterPlanProgram` and its registration-order rule (D-271).

### advanced/typescript (nav 56)

- `Font<typeof msdf>`, technique union inference through `FontStack`, `PropertyList<T>`, `const` generics, `TextInput` vs `FormattedText`, branded `GlyphKey`/`RasterKey`.

### advanced/testing (nav 57)

- Node: `@react-three/test-renderer/webgpu`; headless Chromium with a GPU; what CI has (no WebGPU; WebGL2 fallback).

### advanced/migration (nav 58)

- Table old → new: `new FontLoader().loadAsync` → `loadFont`/hooks; implicit domain → `glyph.handle`; `Text.layout()` → `measure()`; `insertText`/`deleteText`/`replaceText`/`setSpan`/`removeSpan` → assignment; `paint` → `style`.

## Verification

- `pnpm --filter @pmndrs/glyph-site check:docs` compiles every MDX page.
- Every code sample names only exports present on the handle/config tree; samples that depend on D-296 sit under a callout that says so.
- Each example folder builds under the site's Vite config and is linked from both its page and the gallery.
