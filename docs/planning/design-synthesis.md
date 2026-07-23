---
type: Historical Record
title: Text shaping and rendering design synthesis
description: Preserves the initial architecture synthesis, hypotheses, and alternatives that led to the current contracts.
status: historical
tags: [history, design, shaping, rendering]
---

# Text shaping and rendering design synthesis

Status: historical planning synthesis; not an accepted specification
Last reviewed: 2026-07-22

This document preserves the first architecture synthesis that led to `pmndrs/text`. It mixes sourced findings, proposed product direction, and performance hypotheses, so it is planning history rather than a research bibliography. Use [`RESEARCH.md`](../../RESEARCH.md) for annotated sources, [`discussion-extraction.md`](discussion-extraction.md) for the complete conversation record, and [`scope-lanes.md`](scope-lanes.md) for rescoping.

## Executive conclusion

The product should be a renderer-independent text system with four distinct layers:

```text
source font
    ↓
portable baker (offline or worker fallback)
    ↓
PMNDRS_font data in GLB
    ├── shared shaping and metrics
    ├── Slug presentation
    ├── MSDF/MTSDF presentation
    └── bitmap presentation
    ↓
one HarfRust-based Wasm shaper
    ↓
JS paragraph engine
    ↓
GPU renderer selected independently per glyph/run
```

The central invariant is:

> `PMNDRS_font` describes which glyphs result from text and where those glyphs go. Presentation payloads describe how each glyph is drawn.

This makes Slug one presentation backend rather than the package identity. The work in [`three-flatland/packages/slug`](https://github.com/thejustinwalsh/three-flatland/tree/main/packages/slug) is prior art to port, revise, and eventually replace. `pmndrs/text` is the intended shipping package and Three Flatland becomes a consumer.

## 1. Shaping, paragraph layout, and rendering are separate problems

Text shaping converts Unicode text into glyph IDs and positions. HarfBuzz defines shaped output as glyph information plus `x_advance`, `y_advance`, `x_offset`, and `y_offset`; each glyph also retains a cluster value that maps it back to input text. Its script-specific shaping models are internal engine logic, while OpenType GDEF/GSUB/GPOS data comes from the font. See the [HarfBuzz shaping guide](https://harfbuzz.github.io/shaping-and-shape-plans.html) and [shaping concepts](https://harfbuzz.github.io/shaping-concepts.html).

Paragraph layout then chooses line breaks, aligns and justifies lines, handles overflow, and positions shaped runs inside a region. Unicode [UAX #14](https://www.unicode.org/reports/tr14/) defines line-break opportunities but distinguishes those opportunities from choosing an actual break that fits a line. [UAX #29](https://www.unicode.org/reports/tr29/) defines grapheme segmentation, and [UAX #9](https://www.unicode.org/reports/tr9/) defines bidirectional behavior.

Rendering consumes positioned glyph IDs. It must not influence shaping advances or cluster mapping. Slug vector data, MTSDF atlas records, and bitmap strikes can therefore share a single shaping result.

### Required shaped-glyph model

The renderer-independent output needs at least:

```ts
interface ShapedGlyph {
  glyphId: number
  cluster: number // UTF-16 source offset
  xAdvance: number
  yAdvance: number
  xOffset: number
  yOffset: number
  flags: number
}
```

The one-character/one-glyph model is invalid for modern shaping. A character may become several glyphs, several characters may become one ligature, glyphs may reorder, and marks may have zero advance. HarfBuzz's [cluster documentation](https://harfbuzz.github.io/clusters.html) explains why cluster preservation is required for selection, caret placement, styling, line breaking, and extraction.

## 2. HarfRust is the proposed shaping baseline

[HarfRust](https://github.com/harfbuzz/harfrust) is the current Rust port of the HarfBuzz shaping engine. As of this review, its own README says it:

- tracks HarfBuzz behavior;
- uses Fontations `read-fonts` for font access;
- shapes in units-per-em;
- ports shaping and Unicode logic, not the entire HarfBuzz platform;
- passes most HarfBuzz tests and fuzzing suites, with documented differences;
- does not support Graphite, deprecated `mort`, or the Arabic fallback shaper.

These limitations are compatible with an initial baked-font scope because the baker controls and validates source fonts, static instances can be preferred, and unsupported shaping systems can be rejected explicitly.

The related [Fontations](https://github.com/googlefonts/fontations) project provides complementary building blocks:

- `read-fonts`: allocation-free, zero-copy OpenType access intended for shaping;
- `skrifa`: higher-level metadata and outline access;
- `write-fonts`: owned types and font writing;
- `skera`: subsetting.

### Why not write a new shaper first?

Complex-script shaping is not merely lookup-table evaluation. HarfBuzz carries normalization, script-specific preprocessing, feature scheduling, buffer mutation, reordering, cluster semantics, compatibility behavior, and fallback logic. Reimplementing those pieces would make conformance the project's largest risk.

The proposed path is to preserve HarfRust's script/buffer machinery and progressively replace font-specific lookup paths with baked data only after reference behavior and benchmarks exist.

### Conformance definition

There is no generic “modern shaping” assertion strong enough for tests. The project should define conformance as:

> For valid, supported, statically instantiated OpenType fonts, produce the same glyph IDs, clusters, advances, offsets, flags, and output length as a pinned HarfRust release for the same text, direction, script, language, features, variation location, buffer flags, and cluster level.

HarfBuzz should remain the second oracle. Its [`hb-shape`](https://harfbuzz.github.io/utilities.html) tool reports glyph IDs, clusters, displacements, and advances and is suitable for fixture generation. Test metadata must record the HarfRust, HarfBuzz, Unicode, compiler, and `PMNDRS_font` versions.

## 3. Bake font-specific work; retain shared shaping logic

The browser should not need the original source font on the normal path. The baker can perform expensive and validation-heavy work once:

- parse and validate source font data;
- instantiate variable-font coordinates by default;
- subset Unicode coverage and compute shaping closure;
- remap source glyph IDs into one dense packed glyph-ID space;
- compile cmap, metrics, glyph properties, coverage, class, GSUB, and GPOS data into runtime-oriented sections;
- generate requested presentation payloads;
- pack the result into a GLB.

The runtime retains shared logic that cannot be precomputed for arbitrary strings:

- UTF-16 decoding and cluster mapping;
- script and language behavior;
- normalization and reordering;
- joining and syllable state machines;
- feature scheduling;
- buffer mutation;
- contextual rule execution;
- final attachment and flag semantics.

HarfBuzz already uses reusable [shape plans and caching](https://harfbuzz.github.io/shaping-plans-and-caching.html) based on a font face, segment properties, and features. Shape plans are internal runtime objects, not a documented portable bytecode. `pmndrs/text` should not attempt to serialize HarfRust internals. Instead, the baked format should contain stable project-owned stage and lookup records from which runtime plans can be constructed or accelerated.

## 4. A compiled shaping IR is a hypothesis, not a V1 dependency

The conversation explored compiling OpenType layout into a high-level intermediate representation. This remains a valuable direction, but it should be introduced behind a reference path.

Useful high-level operations include:

```text
single substitution
multiple substitution
ligature trie
context automaton
single positioning
direct or class pair positioning
mark-to-base / mark-to-ligature / mark-to-mark
cursive attachment
```

This should not be a tiny stack VM with an instruction per compare or load. Coarse operations preserve opportunities for specialized scalar and SIMD kernels and avoid excessive dispatch.

Potential baked forms include:

- direct glyph-indexed class arrays;
- contiguous substitution ranges;
- dense class-pair matrices;
- CSR sparse-pair overrides;
- bitsets or ranges for coverage;
- packed ligature tries;
- shared anchor pools;
- contextual DFAs where semantics permit.

### Expected benefits

Benefits that are architectural rather than speculative:

- no source-font parsing on the normal runtime path;
- deterministic validation at bake time;
- one dense glyph-ID space shared with renderers;
- flat typed-array access;
- no per-glyph JavaScript objects;
- no generic OpenType offset walking in optimized lookup paths;
- simpler persistent caching of runtime-baked output.

Possible performance and size benefits must be measured. Whole-shape speedups are bounded because Unicode preprocessing, script logic, and buffer mutation remain. Earlier estimates such as “1.3–2×” are hypotheses, not project commitments.

### JIT versus AOT

Andy Wingo's article [“just-in-time code generation within WebAssembly”](https://www.wingolog.org/archives/2022/08/18/just-in-time-code-generation-within-webassembly) explains that Wasm code is not ordinary writable/executable memory. Dynamic generation involves producing and instantiating another Wasm module, then linking through an indirect function table.

For typical short text runs, browser-time module generation, validation, compilation, and caching may cost more than interpretation. Therefore:

- browser-time JIT is not in the initial plan;
- a shared high-level interpreter is the first optimized target;
- per-font ahead-of-time Wasm specialization is a later experiment;
- MLIR is not justified until a simple compiler proves specialization valuable.

## 5. Wasm and SIMD strategy

Wasm is the proposed execution target for the shaper and portable baker. The [WebAssembly specification](https://www.w3.org/TR/wasm-core/) describes a compact, safe, portable low-level format intended for efficient execution.

SIMD should assist regular kernels without defining the entire shaping model. Good candidates include:

- ASCII and non-ASCII scanning;
- UTF-16 validation fast paths;
- Unicode and glyph-property classification;
- range and bitset coverage checks;
- range/delta substitutions;
- bulk advance initialization;
- bulk offset/advance adjustment;
- prefix sums and positioned-instance generation.

Ligature matching, contextual substitution, mark attachment, Arabic/Indic state machines, and arbitrary table gathers remain branchy and stateful. They should retain scalar control flow unless profiling identifies a safe vector form.

Structure-of-arrays data is the precondition for useful SIMD:

```text
glyphIds     u16[]
clusters     u32[]
xAdvances    i32[]
yAdvances    i32[]
xOffsets     i32[]
yOffsets     i32[]
flags        u16[]
```

One JS/Wasm call should shape a run or paragraph batch. There must never be a boundary crossing per glyph. Width-only paragraph reflow should normally make zero Wasm calls; boundary-sensitive line reshaping should batch all changed ranges into one call.

## 6. `PMNDRS_font`: one shaping payload, multiple presentations

glTF is explicitly extensible and separates JSON descriptors from binary buffers. The [glTF 2.0 specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html) also emphasizes runtime efficiency and aligned binary data. A custom extension is therefore a reasonable transport for immutable font sections and GPU resources.

Proposed extension split:

```text
PMNDRS_font                  shared shaping, metrics, glyph identity
PMNDRS_font_slug             Slug curve/band presentation
PMNDRS_font_distance_field   SDF/MSDF/MTSDF atlases and records
PMNDRS_font_bitmap           generated bitmap strikes and records
```

The names are provisional until the extension specification is reviewed.

### One packed glyph-ID space

The baker remaps source glyph IDs into a dense packed space. Every section uses that same value:

```text
source glyph ID → packed glyph ID
```

The packed ID indexes shared metrics, glyph properties, Slug geometry, distance-field records, bitmap records, and post-slice color presentations. `u16` is the likely common representation; the format must define how larger fonts are rejected or upgraded.

### Shared data must not be duplicated

Store once:

- cmap;
- advances;
- logical and ink bounds;
- glyph class and mark attachment class;
- shaping lookups and feature metadata;
- per-glyph presentation availability.

Presentation sections contain only what is needed to draw a packed glyph. Atlas-generator advances or kerning should be discarded after validation because they duplicate canonical shared data.

### Direct-to-GPU means no transformation, not no upload

The browser still creates GPU resources and copies or decodes bytes. The requirement means:

- exact GPU scalar formats and strides are recorded;
- no per-glyph object construction;
- no deinterleaving or numeric conversion;
- no atlas metadata JSON parsing;
- no Slug band/curve reconstruction;
- upload ranges are directly addressable from the GLB binary chunk.

CPU shaping sections should be extension-defined flat binary blocks. GPU sections may use glTF buffer views/accessors where that improves interoperability. Section alignment should satisfy both typed-array and GPU upload constraints.

## 7. Presentation backends

### Slug

Slug is a vector-curve presentation derived from the Three Flatland work. The existing implementation demonstrates preprocessing geometry and band data into a GLB, but the new package should revise it around flat ranges, one packed glyph-ID space, and no reconstructed `Map`/nested glyph object graph.

Vello's sparse-strip research is relevant as renderer prior art, not as a shaper. Linebender described sparse strips as a path-rendering direction intended to improve memory and performance in its [2024 roadmap](https://linebender.org/blog/roadmap-may-2024/), and later reported text/glyph rendering work in the [March 2025 update](https://linebender.org/blog/tmil-15/). This supports keeping shaping/layout independent from the vector rasterization technique.

### MSDF and MTSDF

[msdfgen](https://github.com/Chlumsky/msdfgen) is the primary reference. It describes MSDF as using RGB channels to preserve sharp corners, and MTSDF as adding a true signed-distance field in alpha. It also warns that distance-field channels must be sampled in linear space rather than interpreted as sRGB.

Per-glyph records need distinct values for:

- logical advance from shared shaping data;
- plane bounds for quad placement;
- atlas bounds for texture lookup;
- atlas page;
- distance range and flags.

The plane bounds include technique-specific padding and must never be used as the shaping advance.

### Generated bitmap strikes

The baker takes a source font and generates one or more pixel-size strikes. Each strike has atlas bytes plus per-glyph plane and atlas bounds. The same shared shaping data is used for every strike.

Important open choices include:

- grayscale versus monochrome/RGBA output;
- hinting policy;
- oversampling;
- atlas padding and page limits;
- raw R8/RGBA8 versus compressed image payloads;
- deterministic parity between native and Wasm baking.

Unhinted oversampled rasterization is the simplest deterministic baseline. TrueType hinting may improve small sizes but adds another interpreter and can create native/Wasm parity issues; it needs a separate evidence-based decision.

### Icons and emoji

Font icons usually need only cmap, advances, and presentation records. Optional name lookup belongs outside the shaping hot path.

Emoji shaping is not a separate shaper. Supplementary-plane cmap, variation selectors, ZWJ sequences, and ligature/contextual behavior use the same shaped-glyph output. Color or bitmap presentation is separate:

```text
shaped glyph ID
    ├── monochrome Slug
    ├── MSDF/MTSDF
    ├── bitmap atlas
    ├── Slug vector paint/layers from COLR or supported SVG glyphs
    └── color-bitmap/image presentation
```

Color emoji and SVG icon fonts are required after the first vertical slice. The baker converts supported COLR, OpenType-SVG, and manifest-backed SVG icon artwork into Slug-compatible geometry plus explicit paint/layer records; embedded color bitmap strikes remain GPU-ready image presentations. Shaping still emits the same glyph IDs. Arbitrary SVG scripting, animation, filters, and external resources are not part of the font runtime.

## 8. Runtime fallback baker

Pre-baked GLB is the production fast path, but the loader must accept ordinary font bytes. A lazy worker-hosted Wasm baker should produce the same canonical package in memory:

```text
pre-baked GLB → register and upload

source font → runtime baker library + Worker/Wasm core → canonical baked bytes
            → register and upload through the same loader
```

There should not be a permanent second unbaked runtime model. After worker baking, all consumers see the same `PMNDRS_font` representation.

The likely module split is:

- small shaper Wasm on the normal path;
- larger runtime baker library and Wasm core loaded only for fallback;
- one shared Rust compiler core used by native build tools and the worker.

Runtime-baked output should be cached using a key over source bytes, compiler and format versions, glyph selection, variation coordinates, and presentation options. IndexedDB or Cache Storage are implementation candidates.

Large CJK fonts make unrestricted runtime baking dangerous. The API must support code-point/range/text selection and compute the GSUB/GPOS shaping closure from that selection.

## 9. JS paragraph engine boundary

Paragraph policy belongs in TypeScript/JavaScript because container constraints, style spans, framework lifecycle, layout caching, and custom overflow behavior are application-facing.

The Wasm boundary owns correctness-sensitive shaping. The JS layer owns:

- paragraph/style objects;
- width and height constraints;
- break strategy;
- alignment and justification policy;
- max lines and overflow;
- caches and incremental reflow;
- batching boundary-sensitive reshape requests.

### Width changes

A width change always requires reflow but does not always require reshaping the entire paragraph.

For common Latin text, the paragraph engine can reuse shaped clusters and choose new line breaks. Boundary-sensitive cases—Arabic joining, contextual substitutions, cursive attachment, soft or inserted hyphens, ellipsis, and unsafe break boundaries—may require final line reshaping.

HarfBuzz exposes `UNSAFE_TO_BREAK` to identify positions where breaking requires reshaping; see its [getting-started guide](https://harfbuzz.github.io/getting-started.html). The paragraph engine combines Unicode break opportunities with cluster and unsafe-break information.

The intended call budget is:

```text
text/style/font change     one batched shaping call
simple width change        zero Wasm calls
boundary-sensitive reflow  one batched reshape call
per glyph                  never
```

Initial layout can shape broad logical runs, measure cluster advances, choose line boundaries, and batch only the final ranges requiring boundary-aware shaping.

## 10. Data-layout research

The format should favor direct indexing and flat arrays.

### Shared glyph data

Candidate structure-of-arrays sections:

```text
advanceX             i16 or i32[glyphCount]
advanceY             i16 or i32[glyphCount]
logicalBounds        i16x4[glyphCount]
inkBounds            i16x4[glyphCount]
glyphClass           u8 or u16[glyphCount]
markAttachmentClass  u8 or u16[glyphCount]
glyphFlags           u16[glyphCount]
presentationMask     u16[glyphCount]
```

Store design-unit values as narrow integers when the baker proves the range; use `i32` working and output positions. Fixed-point conversion to world/screen coordinates belongs after shaping.

### cmap

The current Slug approach discussed earlier used UTF-16 code units and therefore cannot represent all Unicode scalar values. The proposed cmap has:

- direct ASCII table;
- paged Unicode map with dense/sparse page choices;
- separate variation-sequence records;
- UTF-16 source offsets retained as clusters.

The final paged representation is not decided. A full 4,352-entry page directory is fast but costs raw bytes; a two-level directory may be the better default.

### Kerning and positioning

Do not flatten all class kerning into explicit glyph pairs. Candidate forms:

- direct small hot-glyph matrix;
- class maps plus dense class-pair matrix;
- CSR explicit overrides by left glyph;
- shared anchors for mark positioning.

The baker should choose representations based on measured byte cost and runtime cost, not a single universal encoding.

## 11. Performance and payload hypotheses

No performance claim in this section is established yet.

Expected qualitative results:

- direct flat data should reduce startup allocation and object traversal;
- dense IDs and class arrays should make common lookups cheaper;
- SIMD will improve selected bulk kernels more than contextual shaping;
- shaped-run caching will dominate repeated-string workloads;
- compiled font data may reduce size, but naive expansion can increase it;
- per-font generated Wasm may add more payload and compile time than it saves.

Required measurements:

- raw and Brotli-compressed Wasm size;
- raw and compressed shaping data size versus shaping-only OpenType;
- registration/startup time and peak memory;
- short-label, paragraph, Arabic, Indic, emoji, and mixed-script shaping;
- cached and uncached runs;
- scalar versus SIMD kernels;
- native versus worker-Wasm bake time and byte determinism;
- Slug, MTSDF, and bitmap upload time without repacking;
- reflow call counts and reshape rate under interactive resizing.

Representative initial fonts should include a compact Latin UI font, Arabic, Devanagari/USE, emoji or ZWJ coverage, an icon font, and a large CJK subset.

## 12. Decisions, hypotheses, and deferrals

### Proposed V1 decisions

- `pmndrs/text` is the product; Three Flatland consumes it.
- One renderer-independent shaping API.
- HarfRust is the behavioral baseline.
- One dense packed glyph-ID space.
- Shared shaping/metrics separated from presentation payloads.
- GLB with an `PMNDRS_font` family of extensions.
- Native and worker-Wasm baker use the same compiler core.
- JS owns paragraph policy; Wasm owns shaping.
- Coarse Wasm calls with persistent flat buffers.
- Pre-baked assets are preferred; runtime baking is a lazy fallback.

### Hypotheses requiring prototypes

- compiled lookup sections materially outperform HarfRust's generic access;
- compiled data is smaller than shaping-only OpenType for target fonts;
- Wasm SIMD produces meaningful whole-run gains;
- per-font AOT specialization is worthwhile;
- one GLB remains practical for multiple large presentation payloads.

### Deferred

- browser-time JIT;
- MLIR;
- GPU compute shaping;
- runtime variable-font axes;
- vertical writing;
- full hyphenation dictionaries;
- Graphite/AAT;
- color emoji and SVG icon-font generation, required after the first vertical slice;
- a public glTF extension proposal.

## Sources used in this synthesis

This is the source list preserved from the original synthesis. The maintained annotations and review notes live in [`RESEARCH.md`](../../RESEARCH.md).

- [HarfBuzz manual](https://harfbuzz.github.io/)
- [HarfBuzz shaping and output](https://harfbuzz.github.io/shaping-and-shape-plans.html)
- [HarfBuzz clusters](https://harfbuzz.github.io/clusters.html)
- [HarfBuzz shape plans and caching](https://harfbuzz.github.io/shaping-plans-and-caching.html)
- [HarfBuzz subsetting API](https://harfbuzz.github.io/harfbuzz-hb-subset.html)
- [HarfRust repository and conformance notes](https://github.com/harfbuzz/harfrust)
- [Fontations repository](https://github.com/googlefonts/fontations)
- [glTF 2.0 specification](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html)
- [Unicode UAX #9: Bidirectional Algorithm](https://www.unicode.org/reports/tr9/)
- [Unicode UAX #14: Line Breaking](https://www.unicode.org/reports/tr14/)
- [Unicode UAX #29: Text Segmentation](https://www.unicode.org/reports/tr29/)
- [WebAssembly core specification](https://www.w3.org/TR/wasm-core/)
- [WebAssembly SIMD proposal](https://github.com/WebAssembly/simd)
- [Andy Wingo: JIT code generation within WebAssembly](https://www.wingolog.org/archives/2022/08/18/just-in-time-code-generation-within-webassembly)
- [msdfgen](https://github.com/Chlumsky/msdfgen)
- [Linebender sparse-strips roadmap](https://linebender.org/blog/roadmap-may-2024/)
- [Linebender March 2025 renderer update](https://linebender.org/blog/tmil-15/)
- [Three Flatland Slug package](https://github.com/thejustinwalsh/three-flatland/tree/main/packages/slug)

## Preservation rules

- Preserve this document as a snapshot of the initial architecture argument.
- Correct factual or attribution errors, but do not silently rewrite earlier proposals as accepted decisions.
- Add or revise source annotations in [`RESEARCH.md`](../../RESEARCH.md).
- Move accepted choices into an ADR; keep unresolved choices in the decision register and open-questions documents.
