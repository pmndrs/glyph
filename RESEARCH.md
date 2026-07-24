# Research sources

Status: living annotated bibliography
Last reviewed: 2026-07-23

This document is the source reference for the project. It records articles, specifications, papers, codebases, and tools examined during research, with a brief abstract and the useful observations extracted from each.

It does not define product scope, architecture, or API. Start at the [project README](README.md); use this file only to inspect the sources behind project decisions.

## How to maintain this file

For every source:

- link to the original or authoritative source;
- state what kind of source it is;
- summarize it briefly rather than restating the project plan;
- record only what was extracted from that source;
- distinguish a source's claim from our inference;
- add a review date when current project status matters;
- link measurements to their raw benchmark artifacts once they exist.

## TypeScript API design

### Koota

Sources:

- [pmndrs/koota](https://github.com/pmndrs/koota)
- [Trait type definitions](https://github.com/pmndrs/koota/blob/main/packages/core/src/trait/types.ts)
- [Query type definitions](https://github.com/pmndrs/koota/blob/main/packages/core/src/query/types.ts)
- [World type definitions](https://github.com/pmndrs/koota/blob/main/packages/core/src/world/types.ts)
- [React query hook](https://github.com/pmndrs/koota/blob/main/packages/react/src/hooks/use-query.ts)

Type: authoritative source repository
Reviewed: 2026-07-23

Abstract: Koota is a TypeScript ECS whose public runtime values carry inferred schema information through entity, query, action, relation, and React APIs. Its type layer uses conditional types, ordered tuple mapping, overloads, and small extraction helpers so callers normally receive precise inference without supplying generic arguments.

Extracted:

- A user-supplied runtime capability can be the stable token from which associated input and output types are inferred.
- Variadic tuple mapping is valuable when input order statically determines callback data order.
- Public overloads and mutually exclusive unions should encode meaningful call forms and reject states that have no runtime meaning.
- React adapters should preserve core generic values rather than inventing a second type model.
- Internal implementations may use targeted casts while public inference is protected by positive and negative compile-time tests.
- These patterns apply directly to raster and baker modules; they should not be extended to runtime-sized Wasm arrays or used to make the mutable `Text` object generic.

## Text shaping engines

### HarfBuzz manual

Source: [HarfBuzz manual](https://harfbuzz.github.io/)
Type: authoritative project documentation

Abstract: Documentation for HarfBuzz's object model, buffers, fonts, Unicode handling, shaping models, OpenType/AAT behavior, clusters, shape plans, and supporting tools.

Extracted:

- HarfBuzz shapes a run with consistent font, direction, script, language, and feature settings.
- Shaping returns glyph identity, clusters, advances, and offsets; it does not perform complete paragraph layout or choose a glyph renderer.
- Complex-script behavior includes engine-side Unicode and script logic in addition to font-table lookup execution.
- HarfBuzz is the appropriate behavioral oracle for modern OpenType shaping.

### HarfBuzz shaping and shape plans

Sources:

- [Shaping and shape plans](https://harfbuzz.github.io/shaping-and-shape-plans.html)
- [Plans and caching](https://harfbuzz.github.io/shaping-plans-and-caching.html)
- [`hb_shape_plan` reference](https://harfbuzz.github.io/harfbuzz-hb-shape-plan.html)

Type: authoritative API and conceptual documentation

Abstract: Describes shaped buffer output, OpenType feature application, shaper selection, and reusable plans created from a face, segment properties, and user features.

Extracted:

- The stable output fields are glyph ID, cluster, `x_advance`, `y_advance`, `x_offset`, and `y_offset`.
- Shape plans cache decisions and font capability inspection, but the public API does not document them as a portable serialized font program.
- Reusing plans is an existing optimization baseline that any custom compiled-data approach must beat.

### HarfBuzz clusters and unsafe breaks

Sources:

- [Clusters](https://harfbuzz.github.io/clusters.html)
- [Working with clusters](https://harfbuzz.github.io/working-with-harfbuzz-clusters.html)
- [Getting started with HarfBuzz](https://harfbuzz.github.io/getting-started.html)

Type: authoritative conceptual documentation

Abstract: Explains how input character clusters survive composition, decomposition, ligature formation, and reordering, and how unsafe flags inform clients about boundaries that require reshaping.

Extracted:

- One-character/one-glyph indexing is not a valid shaping contract.
- Cluster mapping is required by caret placement, selection, styling, line breaking, and source extraction.
- `UNSAFE_TO_BREAK` is a signal to paragraph layout that a selected boundary requires reshaping; it is not itself a complete line-breaking algorithm.

### HarfBuzz tools and subsetting

Sources:

- [`hb-shape` and utilities](https://harfbuzz.github.io/utilities.html)
- [`hb-subset`](https://harfbuzz.github.io/harfbuzz-hb-subset.html)
- [HarfBuzz repository](https://github.com/harfbuzz/harfbuzz)
- [HarfBuzz experimental libraries overview](https://github.com/harfbuzz/harfbuzz#experimental-libraries)

Type: authoritative tool/API documentation and source repository

Abstract: `hb-shape` exposes shaped glyph output for diagnostics. The subsetter reduces code-point/glyph coverage and supports OpenType layout tables. The main repository also contains shaping tests, fuzzing infrastructure, raster/vector/GPU experiments, and configurable builds.

Extracted:

- `hb-shape` is suitable for generating and inspecting oracle output.
- Subsetting must preserve reachable shaping behavior, not only cmap-selected glyphs.
- HarfBuzz's current experimental-library overview explicitly lists `libharfbuzz-gpu` as a Slug-algorithm GPU encoder alongside raster and vector libraries; renderer comparisons should use current upstream rather than assumptions from older architecture surveys.

### HarfRust

Source: [harfbuzz/harfrust](https://github.com/harfbuzz/harfrust)
Type: authoritative source repository
Reviewed: 2026-07-22

Abstract: Rust port of the HarfBuzz shaping engine, using Fontations `read-fonts` for font access. Its README documents tracked HarfBuzz compatibility, performance, safety, and known conformance differences.

Extracted:

- HarfRust contains shaping and Unicode logic without the whole C++ HarfBuzz integration platform.
- It shapes in units per em and leaves scaling to consumers.
- Known gaps include malformed-font fallback behavior, no Arabic fallback shaper, no Graphite, and no deprecated `mort` support as of the reviewed revision.
- It is a strong candidate for a Rust/Wasm reference shaper, but an alternate baked lookup-provider seam must be verified rather than assumed.

### RustyBuzz

Source: [harfbuzz/rustybuzz](https://github.com/harfbuzz/rustybuzz)
Type: source repository

Abstract: Rust port of HarfBuzz's shaping algorithm and the project from which HarfRust was originally forked.

Extracted:

- Demonstrates that a Rust-native HarfBuzz-compatible shaper is practical.
- HarfRust is the more strategically relevant baseline for this project because it is current under the HarfBuzz organization and aligned with Fontations; this is a project choice, not a criticism of RustyBuzz.

### Allsorts

Source: [yeslogic/allsorts](https://github.com/yeslogic/allsorts)
Type: source repository

Abstract: Rust font parser, shaping engine, and subsetter originating from Prince.

Extracted:

- Useful ecosystem comparison for Rust shaping and subsetting.
- It primarily consumes OpenType at runtime rather than providing the raster-independent baked representation explored here.
- Current maintenance and feature status should be rechecked before making comparative claims.

## Font formats and Rust font tooling

### OpenType specification

Sources:

- [OpenType specification index](https://learn.microsoft.com/en-us/typography/opentype/spec/)
- [OpenType Layout common table formats](https://learn.microsoft.com/en-us/typography/opentype/otspec190/chapter2)
- [GDEF table](https://learn.microsoft.com/en-us/typography/opentype/otspec190/gdef)
- [GSUB table](https://learn.microsoft.com/en-us/typography/opentype/otspec190/gsub)
- [GPOS table](https://learn.microsoft.com/en-us/typography/opentype/otspec190/gpos)

Type: normative/authoritative font-format specification

Abstract: Defines the binary font format and the script/language/feature/lookup organization used for glyph substitution, positioning, class definitions, coverage, glyph properties, attachments, variation data, and caret information.

Extracted:

- Pair kerning is only one GPOS operation; modern positioning also includes marks, cursive attachment, contextual positioning, and variation adjustments.
- Class definitions and coverage tables are compact source representations that should not automatically be expanded into explicit glyph pairs.
- GDEF properties affect lookup filtering, mark behavior, attachment, and ligature carets; a compiler cannot treat GSUB/GPOS in isolation.

### OpenType color and SVG glyph presentations

In this source-oriented section, “presentation” means font-authored glyph artwork and tables. The `pmndrs/text` public API calls its selectable drawing implementations raster modules.

Sources:

- [OpenType color glyph overview](https://learn.microsoft.com/en-us/typography/opentype/spec/overview)
- [COLR table](https://learn.microsoft.com/en-us/typography/opentype/spec/colr)
- [SVG table](https://learn.microsoft.com/en-us/typography/opentype/spec/svg)
- [CBDT table](https://learn.microsoft.com/en-us/typography/opentype/spec/cbdt)
- [CBLC table](https://learn.microsoft.com/en-us/typography/opentype/spec/cblc)
- [`sbix` table](https://learn.microsoft.com/en-us/typography/opentype/otspec180/sbix)

Type: normative/authoritative font-format specification

Abstract: OpenType can present a shaped glyph through layered or paint-graph vector compositions (`COLR`/`CPAL`), constrained SVG artwork, or embedded color bitmap strikes (`CBDT`/`CBLC` and `sbix`). These formats change how a glyph is drawn, not how text becomes a positioned glyph sequence.

Extracted:

- Color emoji and SVG icon fonts use the same font-scoped glyph IDs, clusters, advances, and offsets as monochrome glyphs.
- The baker should convert supported COLR and SVG vector artwork into Slug-compatible geometry plus explicit palette/paint/layer records.
- Embedded color bitmap strikes remain image presentations with their own atlas bounds and scale selection; they must not redefine shared advances.
- OpenType SVG intentionally restricts the broader SVG platform. The runtime should consume validated baked records, not execute arbitrary SVG DOM, script, animation, filters, or external resources.
- Color/SVG generators and runtime support remain optional dynamic imports even though the capability is part of the required post-slice Slug feature set.

### Fontations

Source: [googlefonts/fontations](https://github.com/googlefonts/fontations)
Type: authoritative source repository
Reviewed: 2026-07-22

Abstract: Rust workspace for reading, writing, subsetting, and accessing OpenType fonts. Important crates include `font-types`, `read-fonts`, `write-fonts`, Skrifa, and Skera.

Extracted:

- `read-fonts` is designed for allocation-free, zero-copy font access suitable for shaping.
- Skrifa supplies higher-level metadata and glyph-outline access and is a likely source abstraction for a shared baker.
- Skera and `write-fonts` are relevant to subsetting and static-instance output; exact division of responsibility requires a prototype.

## Unicode and paragraph algorithms

### UAX #9: Unicode Bidirectional Algorithm

Source: [Unicode UAX #9](https://www.unicode.org/reports/tr9/)
Type: Unicode Standard Annex

Abstract: Specifies resolution of paragraph embedding levels and display ordering for bidirectional text.

Extracted:

- Bidi analysis is paragraph-scoped, while visual reordering is applied after line boundaries are known.
- Source text must remain in logical order.
- Whether the package owns UAX #9 or accepts pre-segmented directional runs remains a product decision.

### UAX #14: Unicode Line Breaking Algorithm

Source: [Unicode UAX #14](https://www.unicode.org/reports/tr14/)
Type: Unicode Standard Annex

Abstract: Defines line-break classes and ordered rules that produce mandatory, allowed, and prohibited break opportunities. It distinguishes finding opportunities from selecting a break that fits a line.

Extracted:

- Paragraph layout chooses among legal opportunities; the shaper does not perform this job.
- The algorithm is contextual and has non-tailorable and tailorable behavior.
- Version-matched `LineBreakTest.txt` is required for conformance testing.
- Legal Unicode opportunities must still be combined with shaping cluster/unsafe-boundary information.

### UAX #29: Unicode Text Segmentation

Source: [Unicode UAX #29](https://www.unicode.org/reports/tr29/)
Type: Unicode Standard Annex

Abstract: Defines default extended grapheme, word, and sentence boundaries and the rules for declaring tailored profiles.

Extracted:

- Extended grapheme boundaries are the relevant emergency-break/caret safety baseline, but shaped clusters remain a distinct concept.
- Locale-sensitive scripts can require tailoring or dictionary behavior beyond default segmentation.
- Version-matched grapheme test data should be included in the paragraph conformance suite.

### Unicode Character Database test files

Source: [Unicode Character Database](https://www.unicode.org/ucd/)
Type: normative data and conformance fixtures

Abstract: Versioned Unicode properties and test files, including bidi, line-break, normalization, and grapheme-break data.

Extracted:

- Unicode properties and tests must be pinned to an explicit version alongside HarfRust/HarfBuzz.
- Test data should be vendored or fetched by immutable version/hash rather than silently following a latest URL.

## WebAssembly and code generation

### WebAssembly core and JavaScript interface

Sources:

- [WebAssembly core specification](https://www.w3.org/TR/wasm-core/)
- [WebAssembly JavaScript interface](https://www.w3.org/TR/wasm-js-api-1/)

Type: W3C specifications

Abstract: Defines Wasm's portable low-level execution model and the JavaScript APIs for modules, instances, memories, tables, and exported functions.

Extracted:

- Wasm is suitable for a portable Rust shaping/baking core.
- Boundary design and memory ownership are product concerns; the specifications do not make fine-grained JS/Wasm calls free.
- Persistent linear-memory buffers and batched calls should be measured against ordinary JavaScript implementations.

### WebAssembly SIMD

Source: [WebAssembly SIMD proposal](https://github.com/WebAssembly/simd)
Type: specification proposal/history and tests

Abstract: Defines portable 128-bit vector operations across integer and floating lane widths.

Extracted:

- Bulk scans, range operations, classification, adjustments, and prefix work are plausible SIMD targets.
- General arbitrary indexed gather is not supplied by baseline 128-bit SIMD, limiting direct vectorization of cmap, class, and pair lookups.
- SIMD value must be established per kernel and for whole shaping; it is not an architecture by itself.

### Andy Wingo: just-in-time code generation within WebAssembly

Source: [“just-in-time code generation within WebAssembly”](https://www.wingolog.org/archives/2022/08/18/just-in-time-code-generation-within-webassembly)
Type: technical article by an engine implementer

Abstract: Explores runtime code generation when Wasm code is not addressable writable memory, using generated modules, indirect function tables, and late linking/snapshotting concepts.

Extracted:

- A Wasm-hosted JIT does not simply write native instructions into executable memory.
- Runtime specialization implies module generation/compilation/linking and asynchronous/cache complexity.
- The technique is relevant prior art, but typical short shaping runs may not amortize browser-time JIT cost; this requires measurement.

### HarfBuzz Wasm examples

Source: [harfbuzz/harfbuzz-wasm-examples](https://github.com/harfbuzz/harfbuzz-wasm-examples)
Type: upstream experimental examples

Abstract: Examples related to HarfBuzz's experimental Wasm shaper/programmatic-font work.

Extracted:

- Wasm has been explored as an execution environment for font-provided shaping behavior.
- This is adjacent to, but different from, compiling a shared shaper or font lookup data to Wasm.
- Current API, security model, and upstream status must be reviewed before citing it as more than related research.

## Containers and binary layout

### glTF 2.0 specification

Sources:

- [glTF 2.0 specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)
- [Khronos glTF extension registry and naming guidance](https://github.com/KhronosGroup/glTF/blob/master/extensions/README.md)

Type: Khronos specification

Abstract: Defines JSON descriptors, binary buffers/buffer views/accessors, GLB packaging, alignment, images, and an extension mechanism optimized for runtime asset delivery.

Extracted:

- GLB is a viable transport for font data alongside GPU resources.
- glTF's extension system permits project-specific root data and technique-specific payloads.
- New extension names use an uppercase registered prefix followed by lowercase snake case. `KHR` is reserved for Khronos, `EXT` for multi-vendor work, and project-owned extensions should request a vendor prefix; this supports provisional `PMNDRS_font` naming rather than carrying Three Flatland's `FL_` prefix forward.
- Alignment and accessor rules can enable direct typed-array views, but compact CPU shaping records do not necessarily need to be expressed as generic accessors.
- glTF is not itself a streaming protocol; progressive raster-resource delivery requires explicit asset design.

## Glyph rendering and rasterization

### KTX2, Basis Universal, and GPU-native texture compression

Sources:

- [KTX 2.0 specification](https://registry.khronos.org/KTX/specs/2.0/ktxspec.v2.html)
- [Khronos KTX overview](https://www.khronos.org/ktx/)
- [Khronos Basis Universal/KTX2 Vulkan sample](https://github.khronos.org/Vulkan-Site/samples/latest/samples/performance/texture_compression_basisu/README.html)
- [WebGPU specification](https://gpuweb.github.io/gpuweb/)
- [Three.js KTX2Loader](https://threejs.org/docs/pages/KTX2Loader.html)
- [WebGL compressed-texture extension registry](https://registry.khronos.org/webgl/extensions/)

Type: Khronos/WebGPU specifications, official implementation guidance, and Three.js loader documentation

Abstract: KTX2 can contain native GPU texture blocks or Basis Universal transmission data. Basis ETC1S/UASTC payloads are transcoded at runtime into a GPU-supported BC, ETC2, ASTC, or uncompressed target; KTX2 lossless supercompression instead reduces delivery size but must be inflated before sampling.

Extracted:

- Download compression and GPU-resident compression are separate measurements.
- WebGPU guarantees either BC or both ETC2 and ASTC support, enabling capability-selected native targets; WebGL2 still depends on extensions and fallback policy.
- Basis Universal is portable but requires a transcoder; its module, transcode time, selected target, and resulting GPU bytes belong in the payload report.
- Standard GPU block formats are lossy and are inappropriate for exact Slug band addresses/counts.
- High-quality UASTC-derived curve or distance-field textures are plausible experiments, but geometry/edge errors require output-based quality gates and an uncompressed fallback.
- The concrete Slug strategy and Lucide sizing model are recorded in [GPU compression and compact Slug storage](docs/planning/gpu-compression.md).

### Three Flatland Slug implementation

Sources:

- [Three Flatland Slug package](https://github.com/thejustinwalsh/three-flatland/tree/c596ac2313e33cace825fe197a6d730269019175/packages/slug)
- [`SlugFontLoader` baked-first and dynamic fallback path](https://github.com/thejustinwalsh/three-flatland/blob/c596ac2313e33cace825fe197a6d730269019175/packages/slug/src/SlugFontLoader.ts)
- [Slug Node bake module](https://github.com/thejustinwalsh/three-flatland/blob/c596ac2313e33cace825fe197a6d730269019175/packages/slug/src/bake.ts)
- [Shared browser-safe/Node-split bake package](https://github.com/thejustinwalsh/three-flatland/tree/c596ac2313e33cace825fe197a6d730269019175/packages/bake)
- [Slug package exports and baker registration](https://github.com/thejustinwalsh/three-flatland/blob/c596ac2313e33cace825fe197a6d730269019175/packages/slug/package.json)
- [Local file-level audit](docs/planning/slug-audit.md)

Type: project source code and derived audit
Reviewed revision: `c596ac2313e33cace825fe197a6d730269019175`

Abstract: Existing TypeScript/TSL implementation of baked quadratic glyph curves, band acceleration, GLB storage, runtime fallback, layout helpers, and Three.js rendering.

Extracted:

- Curve/band generation, texture packing, shader references, narrow GLB reading, and baked-first loading are valuable prior art.
- The browser-safe loader, Node-only bake subpath, package-declared baker, and thin standalone/unified CLI demonstrate a sound host/dependency split worth retaining.
- The current fallback dynamically imports heavy modules but creates a separate in-memory runtime model. The new plan improves this by dynamically loading a runtime baker library, executing it in a Worker, and returning the same canonical bytes used by the pre-baked asset path.
- The current `forceRuntime` option is not carried forward: baked asset miss is automatic fallback with a development warning, not a user-selectable delivery policy.
- The current text path is intentionally basic: UTF-16-unit cmap, disabled GSUB on the runtime path, explicit pair kerning, and shaping coupled with wrapping/alignment.
- Flat GPU texture bytes are already available, but the loader reconstructs per-glyph maps and nested band objects.
- The package supplies useful real-font equivalence tests and baseline Slug payload measurements.

### Three Flatland uikit SVG icon baker

Sources:

- [uikit fork at the reviewed revision](https://github.com/thejustinwalsh/three-flatland/tree/2935a89fcd9999e8a8b3d3b733f7f7302285cd60)
- [SVG bake pipeline plan](https://github.com/thejustinwalsh/three-flatland/blob/2935a89fcd9999e8a8b3d3b733f7f7302285cd60/planning/superpowers/plans/svg-bake-pipeline.md)
- [SVG bake evidence](https://github.com/thejustinwalsh/three-flatland/blob/2935a89fcd9999e8a8b3d3b733f7f7302285cd60/planning/superpowers/specs/svg-bake-pipeline-evidence.md)
- [uikit Lucide package and baked set](https://github.com/thejustinwalsh/three-flatland/tree/2935a89fcd9999e8a8b3d3b733f7f7302285cd60/packages/uikit-lucide)
- [Glyph paging design](https://github.com/thejustinwalsh/three-flatland/blob/2935a89fcd9999e8a8b3d3b733f7f7302285cd60/planning/perf/glyph-paging-design.md)

Type: project source code, design records, and measured artifact
Reviewed revision: `2935a89fcd9999e8a8b3d3b733f7f7302285cd60`

Abstract: Extends the Slug pipeline from font outlines to standalone SVG icons. The CLI accepts files or directories, parses SVG paths into a shared `SlugShapeSet`, and writes named shape, fill, and view-box metadata plus flat curve/band columns into `FL_slug_shapes` GLB data.

Extracted:

- SVG icon baking is implemented prior art, not a hypothetical future path: the fork includes a checked-in 1,594-shape Lucide asset.
- One shared shape set allows icons to share GPU resources and batching rather than creating a renderer resource per icon.
- The baked path removes SVG parsing and DOM work from runtime, while preserving names, multiple handles/fills, fill rules, and view boxes.
- Full-library and imported-subset costs must be measured separately. The checked-in Lucide artifact is a stress case, not the expected payload for an application importing a few icons.
- The fork's RGBA16F curve and R32F band texture layout is the relevant optimized Slug baseline; older font artifacts used a larger RG32F band texture.
- The [font payload budget](docs/planning/payload-budget.md) records the current Inter, Font Awesome, and Lucide measurements and keeps serialized geometry separate from GPU-resident textures.

### Slug Library

Source: [Slug Library](https://sluglibrary.com/)
Type: original/commercial technique documentation and implementation reference

Abstract: Eric Lengyel's resolution-independent GPU text-rendering technique based on evaluating glyph outline data rather than sampling a fixed-resolution atlas.

Extracted:

- Slug is a rasterization technique, not a Unicode shaping or paragraph-layout engine.
- Its ability to remain sharp under scale and perspective makes it a useful high-quality raster backend.
- Licensing and the exact provenance of algorithms ported from Three Flatland require explicit review.

### Windfoil

Sources:

- [Windfoil repository](https://github.com/texel-org/windfoil)
- [Interactive WebGPU demo](https://texel-org.github.io/windfoil/)
- [Algorithm notes](https://github.com/texel-org/windfoil/blob/main/docs/ALGORITHM.md)
- [Benchmark methodology and results](https://github.com/texel-org/windfoil/blob/main/bench/README.md)
- [Development notes and prior art](https://github.com/texel-org/windfoil/blob/main/docs/NOTES.md)
- [Matt DesLauriers on the renderer's correctness and print-workflow goals](https://x.com/mattdesl/status/2070470499772080512)
- [Matt DesLauriers on large, tiled browser output](https://x.com/mattdesl/status/2071199412785684630)
- [Three Flatland comparison: Windfoil vs. Slug](https://publishing.tjw.dev/windfoil-vs-slug/)
- [Three Flatland Slug/uikit performance plan](https://github.com/thejustinwalsh/three-flatland/blob/feat/uikit-fork/planning/perf/slug-uikit-shader-perf-plan.md)
- [Three Flatland uikit execution plan and Windfoil footprint spike](https://github.com/thejustinwalsh/three-flatland/blob/feat/uikit-fork/planning/superpowers/plans/uikit-fork-tsl-slug-execution.md)

Type: 2026 experimental open-source renderer and reference implementation (Apache-2.0), author commentary, and project-derived comparative research
Reviewed: 2026-07-22

Abstract: Windfoil analytically fills quadratic Bézier contours in a fragment shader. The CPU subdivides curves into pieces monotone in both axes and builds a single-axis row-band index; each fragment gathers relevant pieces and integrates their winding contribution over the pixel footprint. It is intended to improve on the public Slug algorithm for some high-quality 2D vector-art and print workloads. It is currently a WebGPU/WGSL research implementation and demo rather than a complete text system.

Classification:

- Experimental analytic vector-fill and antialiasing technique.
- Relevant to general vector editors, generative art, print-scale output, deeply magnified paths, overlapping strokes, and hairlines.
- Not a font shaper, paragraph engine, font container, or general font-loading API. Its demo uses `opentype.js` to obtain glyph outlines and metrics, but the core algorithm is generic 2D path rendering.
- Research reference, not a planned `pmndrs/text` raster backend.

Extracted from the official project:

- Windfoil computes a closed-form box-filtered winding integral per fragment using ordinary painter's-order rendering. It does not require a compute pass, scatter stage, or prefix sum.
- Its row-band acceleration structure is approximately half the size of Slug's dual-axis bands in the project's tiger example: about 0.84 MB versus 1.54 MB. This is a source-reported example, not a general payload guarantee.
- The method can remove CPU sweep/union preprocessing for overlapping and self-overlapping strokes in the author's vector-art engine.
- “Exact” needs a narrow interpretation. The edge integral is analytic, but converting averaged winding into coverage is exact only for ordinary adjacent winding levels. Opposite-sign overlap, absolute winding above one, some self-intersections, and even-odd transitions across non-adjacent levels expose limitations in the winding fold.
- The shader performs more arithmetic per candidate curve than public Slug, including square roots. Windfoil therefore trades atlas memory and some coverage behavior against fragment ALU cost rather than universally improving frame time.
- The benchmark's own summary reports Slug ahead for minified and ordinary small/legible text, with Windfoil becoming competitive or faster as shapes are magnified. Deep minification uses an approximate banded-ink guard to bound worst-case work, so that result is not equivalent to exact filtering.
- Rotated and sheared transforms integrate the axis-aligned local-space preimage of the fragment footprint rather than a device-pixel-oriented footprint. Deep zoom can also expose `f32` precision wobble far from the origin.
- The author's stated application is a correctness- and flexibility-oriented 2D vector engine for generative artwork and very large browser-generated print images, not primarily a UI text renderer.
- The published text benchmark favors Slug for ordinary 8–64 px text and shows Windfoil's text advantage only under high magnification. It contains no XR benchmark; stereo cost, perspective/off-axis footprints, foveation, and headset GPUs remain unvalidated.
- The repository states that the core was generated by Claude “Fable” in an approximately 1.5-hour uninterrupted session and then iterated and tuned by the author. The project also explicitly warns that novelty and possible collisions with prior techniques or patents have not been established. Adoption therefore requires technical validation and a separate provenance/legal review; AI provenance is not evidence for or against correctness.

Prior Three Flatland evaluation (project-derived, not an independent source claim):

- The Slug/uikit performance work found the public Slug approach faster for ordinary legible 8–64 px UI text in its tested scenes, while Windfoil was more attractive for magnification, exact overlap/self-intersection behavior, hairline graphics, and smaller band data.
- It found no basis for treating Windfoil as an automatic replacement for Slug, particularly for CJK, perspective/off-axis use, or minification. The tested performance crossover occurred only at high magnification and depends on workload.
- Windfoil is not a shader-only swap. It requires its own CPU preprocessing, xy-monotone subdivision, band representation, glyph/path payload, and draw bucket.
- A later footprint spike found that fragment derivatives were already available for the existing Slug path, while vertex dilation could not use derivatives. The useful lesson was to evaluate individual Windfoil concepts independently rather than assuming the entire renderer should be adopted.
- The published comparison and planning notes were produced by Three Flatland contributors and include project-specific judgments. They are valuable prior evaluation, but should not be presented as independent validation of either renderer.

Limits on use:

- The current implementation targets WebGPU/WGSL and Deno tooling. A production package would need browser/runtime compatibility, API stability, WebGL strategy if required, deterministic baking, font-corpus coverage, and maintainability measurements.
- The official benchmark compares against a verified public Slug reference, but its scenes and GPU results should not be generalized to all fonts, transforms, devices, or raster sizes.
- Public X posts establish the author's print-scale and correctness motivations. Replies or threads requiring authentication were not treated as evidence unless their content was available from an attributable public source.

Project inference, not a Windfoil claim:

- Do not implement Windfoil in `pmndrs/text` under the current product scope. It solves high-quality general vector filling, not a missing shaping, paragraph, or ordinary text-rendering capability.
- The shared shaping, paragraph, glyph-ID, and `PMNDRS_font` container layers should remain independent of Windfoil, Slug, MSDF, and bitmap rendering.
- Reconsider only if the product expands into deeply zoomable, overlap-heavy vector graphics or a real workload proves that Slug's coverage, CPU union work, or band memory is a material blocker.
- Any future implementation must be a separate, explicitly imported vector package and prove perspective/XR behavior, WebGL/WebGPU deployment, quality, and end-to-end performance first.

### Alvin: Rendering Resolution Independent Fonts in Games and 3D-Applications

Sources:

- [Lund University publication record](https://lup.lub.lu.se/student-papers/record/9024910)
- [Full thesis PDF](https://lup.lub.lu.se/luur/download?func=downloadFile&recordOId=9024910&fileOId=9024911)

Type: 2020 master's thesis by Olle Alvin, Lund University; work carried out at EA DICE

Abstract: Implements and compares pre-rasterized glyph atlases, SDF/MSDF, Slug, and three experimental SDF/Slug hybrids. It evaluates GPU time and image error across several sizes and three fonts of increasing outline complexity, then discusses small-size text and text viewed at an angle in world space.

Extracted:

- No tested technique dominates across every font, scale, and workload. Pre-rasterized glyphs were the performance baseline; SDF/MSDF traded atlas resolution and some quality for near-baseline rendering cost; Slug preserved outline detail and scaling more consistently but required substantially more shader work.
- Slug cost was highly sensitive to outline complexity and antialiasing strategy in this implementation. The gap widened sharply for the detailed Elzevier Caps font, while the author notes that the implementation omitted some optimizations used by the commercial Slug library.
- SDF quality degraded around sharp corners, thin features, extreme magnification, and minification. MSDF improved corner reproduction at larger sizes but did not remove every thin-feature or small-size failure and increased texture/shader cost.
- The SDF/Slug hybrids improved the quality/performance tradeoff for a relatively simple font, but did not generalize to complex glyphs: dense corners caused most of a glyph to fall back to Slug while retaining the hybrid's overhead.
- For very small text, the thesis recommends hinted pre-rasterized glyphs because outline alteration and pixel-grid alignment matter even when the underlying rasterizer is mathematically accurate.
- For text viewed at an angle in world space, SDF and Slug can use screen-space derivatives for antialiasing, while a fixed bitmap strike can become blurry or undersampled across the glyph.
- The quality metric was RMSE against a supersampled reference. The author explicitly warns that RMSE does not fully model perceptual importance, so visual inspection remains necessary.

Limits on use:

- The work studies glyph rasterization, not Unicode shaping, paragraph layout, or font fallback.
- Its corpus is ASCII from three TrueType fonts, and the primary benchmarks use a 2020 OpenGL implementation on a GTX 1070 with text parallel to the screen. Its numeric timings are historical evidence, not current WebGPU/WebGL performance targets.
- The results justify benchmarking several rasters against representative fonts and viewing conditions; they do not establish a universal selection threshold or prove that automatic selection cannot work.

Project inference, not a thesis claim:

- Preserve a sound raster-independent text API while allowing callers to choose a raster module explicitly.
- Treat any future automatic selector as optional policy rather than a requirement of the core API.
- Keep raster engines separable enough that applications can tree-shake unused engines or load them dynamically. This delivery concern is not evaluated by the thesis and requires bundler and runtime measurements.

### Vello and sparse strips

Sources:

- [Linebender May–July 2024 roadmap](https://linebender.org/blog/roadmap-may-2024/)
- [Linebender March 2025 update](https://linebender.org/blog/tmil-15/)
- [Vello repository](https://github.com/linebender/vello)

Type: project roadmap/update and source repository

Abstract: Vello is a GPU vector renderer. Sparse strips are a rendering/rasterization direction intended to improve path-rendering memory and performance; later updates describe glyph-rendering integration.

Extracted:

- Sparse strips are relevant rasterization prior art, not an alternative to HarfBuzz shaping.
- Renderer evolution reinforces the need to keep shaped glyph identity and positioning independent of a particular rasterization backend.
- Current Vello/Glifo status should be rechecked before selecting any dependency.

### Parley

Source: [linebender/parley](https://github.com/linebender/parley)
Type: source repository

Abstract: Rust text layout library in the Linebender ecosystem, covering styled text and layout on top of font/shaping infrastructure.

Extracted:

- Important comparison for paragraph APIs, bidi, line breaking, fallback, and layout caching.
- The project should audit Parley directly before implementing its own paragraph algorithms to avoid recreating solved work unnecessarily.

### Swash

Source: [dfrg/swash](https://github.com/dfrg/swash)
Type: source repository

Abstract: Rust font introspection, shaping support, scaling, and glyph rasterization library.

Extracted:

- Relevant comparison for bitmap generation, hinting/scaling, and Rust/Wasm feasibility.
- Dependency choice should be based on deterministic native/Wasm output, binary size, license, and current maintenance rather than ecosystem familiarity.

### msdfgen

Sources:

- [Chlumsky/msdfgen](https://github.com/Chlumsky/msdfgen)
- [Viktor Chlumský's thesis](https://github.com/Chlumsky/msdfgen/files/3050967/thesis.pdf)
- [msdf-atlas-gen](https://github.com/Chlumsky/msdf-atlas-gen)
- [MSDF preview shader by Viktor Chlumský](https://gist.github.com/Chlumsky/263c960ae0a7df59afc2da4051eb0553)
- [WebGPU texture formats](https://gpuweb.github.io/types/types/GPUTextureFormat.html)

Type: original implementation, paper/thesis, and atlas tool

Abstract: Generates SDF, PSDF, MSDF, and MTSDF representations of vector shapes. MSDF uses multiple color channels to retain sharp corners; MTSDF adds a true signed-distance value in alpha.

Extracted:

- MSDF/MTSDF raster data needs plane bounds, atlas bounds, page, and distance-range metadata distinct from shaping advances.
- Distance channels must be sampled as linear data rather than sRGB color.
- The author's preview shader demonstrates runtime thickness, border/outline, gradient fill, displaced soft shadow, and perspective reconstruction. Every distance-based effect remains bounded by the field's encoded range and atlas padding.
- Atlas generation is useful prior art, but a Rust/Wasm implementation must be evaluated for licensing, determinism, size, quality, and performance.
- MTSDF retains the complete RGB MSDF and adds true signed distance in alpha. One texture can therefore use RGB median distance for sharp fill boundaries and alpha for effects that need true distance.
- WebGPU exposes `rgba8unorm` but no ordinary `rgb8unorm` sampled format. For the lossless V1 GPU baseline, retaining MTSDF alpha does not increase residency over an RGB MSDF uploaded through RGBA8.
- Project decision: expose one module-valued MSDF raster and bake only MTSDF resources in V1. Plain MSDF and parallel MSDF/MTSDF batches remain unsupported unless a complete compression benchmark proves a material quality-preserving end-to-end win.

## Related deployment and ecosystem comparisons

### js-physics-benchmarks

Source: [isaac-mason/js-physics-benchmarks](https://github.com/isaac-mason/js-physics-benchmarks)
Type: source repository and interactive benchmark application
Reviewed: 2026-07-23

Abstract: A browser benchmark lab for JavaScript and WebAssembly physics engines. It compares multiple implementations through a common adapter API and shared scenario catalog, exposes capability-gated unsupported scenarios, keeps scenario state in shareable URL parameters, displays live phase timings, measures JavaScript and Wasm bundle sizes separately, and deploys the built application as a static site.

Extracted:

- `pmndrs/text` needs a benchmark product, not only scripts and prose reports: an interactive browser lab plus a headless runner over the same scenario definitions.
- Renderer, shaper, delivery-path, and GPU-backend variants should implement stable target adapters rather than duplicate benchmark scenarios.
- Scenarios must declare required capabilities and show unsupported combinations explicitly; silently omitting a weak or unsupported case would make comparisons misleading.
- Live timing should separate pipeline phases such as shaping, paragraph layout, upload, rendering, and total frame cost.
- Bundle-size measurement needs independent entry points and must report JavaScript and Wasm separately. This project additionally requires raw, gzip, and Brotli sizes plus font/raster payload and GPU residency.
- Query-addressable scenario, target, and parameter state makes measurements reviewable and easy to reproduce.
- We adopt the harness architecture as precedent, not its physics-specific API, timing assumptions, or implementation verbatim.

## Declarative text API references

### React Native `Text`

Source: [React Native Text](https://reactnative.dev/docs/text)
Type: authoritative framework documentation

Abstract: React Native's text component supports nested text, inherited inline styles, wrapping, measurement, and interaction. Nested text is flattened into one attributed string rather than treated as independent layout boxes.

Extracted:

- A root text container with nested text spans is the most familiar declarative model for mixed styles.
- Text-style inheritance should remain inside a text subtree and not leak through arbitrary scene objects.
- A nested text element should contribute a source range and style, not create another paragraph or Three.js object.

### React Native Skia Paragraph

Source: [React Native Skia Paragraph](https://shopify.github.io/react-native-skia/docs/text/paragraph/)
Type: authoritative project documentation

Abstract: Skia exposes an imperative paragraph builder with pushed text styles, explicit layout width, measurement, line metrics, paints, and a declarative render component.

Extracted:

- Paragraph construction and paragraph rendering are separate operations; layout width is an explicit input.
- Builder-style text/style runs are a useful low-level/core representation, but are too verbose for the primary JSX API.
- React children can compile to the same flat string and span records a lower-level builder would produce.

### Drei `Text`

Source: [Drei Text](https://drei.docs.pmnd.rs/abstractions/text)
Type: authoritative pmndrs documentation

Abstract: Drei wraps a Three.js text object as a Suspense-based React Three Fiber component, accepts direct text/render props, and uses string children for content.

Extracted:

- `<Text>hello</Text>` with direct props is already familiar to React Three Fiber users.
- Font loading may suspend while the rendered object retains normal R3F transform and scene semantics.
- A pmndrs text component should avoid a parallel CSS/layout wrapper when the core object can own the behavior.

### pmndrs uikit React/vanilla split

Sources:

- [uikit components and properties](https://pmndrs.github.io/uikit/docs/getting-started/components-and-properties)
- [uikit vanilla Three.js architecture](https://pmndrs.github.io/uikit/docs/getting-started/vanilla)

Type: authoritative pmndrs documentation

Abstract: uikit makes the framework-neutral Three.js implementation the core product and supplies a slim React wrapper. Its React `Text` uses direct properties and children while the underlying text object participates in measurement and layout.

Extracted:

- `@pmndrs/text` should own all loading, shaping, layout, raster selection, and Three.js behavior.
- `@pmndrs/text/react` should be a subpath with peer dependencies that only reconciles props, children, refs, Suspense, and disposal.
- React and vanilla Three.js users should receive the same features and data contracts.

### pmndrs uikit text layout implementation

Sources at reviewed commit `0d4d887343d4492234ac9f35a4c470cea4176ca0`:

- [Text component](https://github.com/pmndrs/uikit/blob/0d4d887343d4492234ac9f35a4c470cea4176ca0/packages/uikit/src/components/text.ts)
- [text layout setup](https://github.com/pmndrs/uikit/blob/0d4d887343d4492234ac9f35a4c470cea4176ca0/packages/uikit/src/text/layout/index.ts)
- [text measurement and wrapping](https://github.com/pmndrs/uikit/blob/0d4d887343d4492234ac9f35a4c470cea4176ca0/packages/uikit/src/text/layout/measure.ts)
- [FlexNode and Yoga integration](https://github.com/pmndrs/uikit/blob/0d4d887343d4492234ac9f35a4c470cea4176ca0/packages/uikit/src/flex/node.ts)
- [font and BMFont/MSDF metrics](https://github.com/pmndrs/uikit/blob/0d4d887343d4492234ac9f35a4c470cea4176ca0/packages/uikit/src/text/font.ts)
- [instanced text rendering](https://github.com/pmndrs/uikit/blob/0d4d887343d4492234ac9f35a4c470cea4176ca0/packages/uikit/src/text/render/instanced-text.ts)
- [caret, selection, and hit-testing queries](https://github.com/pmndrs/uikit/blob/0d4d887343d4492234ac9f35a4c470cea4176ca0/packages/uikit/src/text/layout/query.ts)

Type: authoritative project source code

Abstract: uikit's current `Text` component connects a reactive `CustomLayouting` object to its `FlexNode` Yoga measure function. Yoga's resolved node size, padding, and border signals then drive a separate computed positioned-glyph layout used by the MSDF renderer and editing queries. The current font object combines BMFont character metrics, pair kerning, and atlas ownership, while caret and selection logic assumes one positioned entry per JavaScript character.

Extracted:

- The adoption seam should preserve uikit's `CustomLayouting → FlexNode/Yoga → resolved content-box signals` flow rather than introduce an unrelated imperative lifecycle.
- Core needs a synchronous allocation-light measurement operation separate from final positioned layout so repeated host measurements do not create glyph arrays.
- uikit should own signal adaptation, point-scale rounding, padding/border removal, centered-coordinate conversion, transforms, clipping, and render-group integration.
- `pmndrs/text` must not expose Yoga, Preact Signals, or uikit-specific types merely to support this consumer.
- Current character-entry caret and selection code cannot represent ligatures, combining marks, reordered glyphs, or cluster boundaries; a later migration step must use cluster-aware queries rather than adapting glyph IDs back into character entries.
- See the [uikit integration explanation](docs/planning/uikit-integration.md) for the resulting incremental migration.

### harfbuzzjs

Source: [harfbuzz/harfbuzzjs](https://github.com/harfbuzz/harfbuzzjs)
Type: source repository

Abstract: JavaScript/Wasm packaging of HarfBuzz for browser and server environments.

Extracted:

- Provides a practical baseline for browser HarfBuzz deployment, API shape, and artifact size.
- Benchmark comparisons should include current harfbuzzjs rather than only theoretical “full HarfBuzz Wasm” estimates.

### three-text

Source: [countertype/three-text](https://github.com/countertype/three-text)
Type: related project source repository

Abstract: High-fidelity 3D font rendering and text layout for the web with Three.js and other adapters; currently advertises HarfBuzz Wasm integration.

Extracted:

- Directly relevant product and API comparison that was absent from the early discussion.
- Must be evaluated before making novelty claims or committing to duplicate surface area.
- Review should compare shaping ownership, font loading, paragraph behavior, raster backends, worker use, and renderer coupling.

## Research queue

Open investigations, prototype questions, and deferred topics are maintained in [`open-questions.md`](docs/planning/open-questions.md). New sources should be added here only after they have been reviewed and annotated.
