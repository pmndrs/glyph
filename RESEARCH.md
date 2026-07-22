# Research sources

Status: living annotated bibliography
Last reviewed: 2026-07-22

This document is the source reference for the project. It records articles, specifications, papers, codebases, and tools examined during research, with a brief abstract and the useful observations extracted from each.

It does not define product scope or architecture. Those live under [`docs/planning`](docs/planning/README.md). The historical discussion is preserved in [`DISCUSSION_EXTRACTION.md`](docs/planning/DISCUSSION_EXTRACTION.md), and the initial design synthesis is preserved in [`DESIGN_SYNTHESIS.md`](docs/planning/DESIGN_SYNTHESIS.md).

## How to maintain this file

For every source:

- link to the original or authoritative source;
- state what kind of source it is;
- summarize it briefly rather than restating the project plan;
- record only what was extracted from that source;
- distinguish a source's claim from our inference;
- add a review date when current project status matters;
- link measurements to their raw benchmark artifacts once they exist.

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

Type: authoritative tool/API documentation and source repository

Abstract: `hb-shape` exposes shaped glyph output for diagnostics. The subsetter reduces code-point/glyph coverage and supports OpenType layout tables. The main repository also contains shaping tests, fuzzing infrastructure, raster/vector/GPU experiments, and configurable builds.

Extracted:

- `hb-shape` is suitable for generating and inspecting oracle output.
- Subsetting must preserve reachable shaping behavior, not only cmap-selected glyphs.
- HarfBuzz's current repository includes GPU Slug work and experimental raster/vector components; renderer comparisons should use current upstream rather than assumptions from older architecture surveys.

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
- It primarily consumes OpenType at runtime rather than providing the renderer-independent baked representation explored here.
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

Source: [glTF 2.0 specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)
Type: Khronos specification

Abstract: Defines JSON descriptors, binary buffers/buffer views/accessors, GLB packaging, alignment, images, and an extension mechanism optimized for runtime asset delivery.

Extracted:

- GLB is a viable transport for font data alongside GPU resources.
- glTF's extension system permits project-specific root data and technique-specific payloads.
- Alignment and accessor rules can enable direct typed-array views, but compact CPU shaping records do not necessarily need to be expressed as generic accessors.
- glTF is not itself a streaming protocol; progressive presentation delivery requires explicit asset design.

## Glyph rendering and presentation

### Three Flatland Slug implementation

Sources:

- [Three Flatland Slug package](https://github.com/thejustinwalsh/three-flatland/tree/c596ac2313e33cace825fe197a6d730269019175/packages/slug)
- [Local file-level audit](docs/planning/SLUG_AUDIT.md)

Type: project source code and derived audit
Reviewed revision: `c596ac2313e33cace825fe197a6d730269019175`

Abstract: Existing TypeScript/TSL implementation of baked quadratic glyph curves, band acceleration, GLB storage, runtime fallback, layout helpers, and Three.js rendering.

Extracted:

- Curve/band generation, texture packing, shader references, narrow GLB reading, and baked-first loading are valuable prior art.
- The current text path is intentionally basic: UTF-16-unit cmap, disabled GSUB on the runtime path, explicit pair kerning, and shaping coupled with wrapping/alignment.
- Flat GPU texture bytes are already available, but the loader reconstructs per-glyph maps and nested band objects.
- The package supplies useful real-font equivalence tests and baseline Slug payload measurements.

### Slug Library

Source: [Slug Library](https://sluglibrary.com/)
Type: original/commercial technique documentation and implementation reference

Abstract: Eric Lengyel's resolution-independent GPU text-rendering technique based on evaluating glyph outline data rather than sampling a fixed-resolution atlas.

Extracted:

- Slug is a presentation/rasterization technique, not a Unicode shaping or paragraph-layout engine.
- Its ability to remain sharp under scale and perspective makes it a useful high-quality presentation backend.
- Licensing and the exact provenance of algorithms ported from Three Flatland require explicit review.

### Vello and sparse strips

Sources:

- [Linebender May–July 2024 roadmap](https://linebender.org/blog/roadmap-may-2024/)
- [Linebender March 2025 update](https://linebender.org/blog/tmil-15/)
- [Vello repository](https://github.com/linebender/vello)

Type: project roadmap/update and source repository

Abstract: Vello is a GPU vector renderer. Sparse strips are a rendering/rasterization direction intended to improve path-rendering memory and performance; later updates describe glyph-rendering integration.

Extracted:

- Sparse strips are relevant presentation prior art, not an alternative to HarfBuzz shaping.
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

Type: original implementation, paper/thesis, and atlas tool

Abstract: Generates SDF, PSDF, MSDF, and MTSDF representations of vector shapes. MSDF uses multiple color channels to retain sharp corners; MTSDF adds a true signed-distance value in alpha.

Extracted:

- MSDF/MTSDF presentation needs plane bounds, atlas bounds, page, and distance-range metadata distinct from shaping advances.
- Distance channels must be sampled as linear data rather than sRGB color.
- Atlas generation is useful prior art, but a Rust/Wasm implementation must be evaluated for licensing, determinism, size, quality, and performance.

## Related deployment and ecosystem comparisons

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
- Review should compare shaping ownership, font loading, paragraph behavior, presentation backends, worker use, and renderer coupling.

## Research queue

Open investigations, prototype questions, and deferred topics are maintained in [`OPEN_QUESTIONS.md`](docs/planning/OPEN_QUESTIONS.md). New sources should be added here only after they have been reviewed and annotated.
