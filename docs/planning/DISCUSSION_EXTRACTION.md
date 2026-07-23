---
type: Historical Record
title: Original discussion extraction
description: Preserves the complete design conversation, including superseded alternatives and unmeasured estimates.
status: historical
tags: [history, discussion, provenance]
---

# Original discussion extraction

Status: historical design record, not an accepted specification  
Source: [linked “Text Shaping Optimization” conversation](chatgpt-conversation://6a5962b7-faa8-83ea-b6b9-f35b31ca626f)  
Extraction date: 2026-07-22

This document preserves the complete substance of the design discussion before the project is rescoped. It intentionally includes alternatives, estimates, abandoned framings, and speculative ideas. Accepted direction belongs in the decision register and future ADRs; sourced technical findings belong in [`RESEARCH.md`](../../RESEARCH.md).

Numbers labeled **conversation estimate** were reasoned estimates in the discussion, not measured results. They must not become product claims without the benchmark plan.

## 1. Starting problem and constraints

The discussion began around improving text shaping in Three Flatland's Slug package. The constraints were:

- text layout and positioning should be as fast as practical;
- glyph rendering used Slug-style baked geometry in a GLB;
- shipping all of HarfBuzz Wasm was considered too large;
- the source TTF/OTF should not be required on the normal runtime path;
- font-specific work such as cmap, metrics, kerning, and OpenType layout should be precomputed where possible;
- runtime data should favor direct lookup and GPU upload;
- modern font behavior must not be reduced to Latin pair kerning.

An early distinction drove the rest of the design:

```text
shaping: Unicode → glyph IDs, clusters, advances, offsets
layout: shaped runs → lines and positioned glyphs
presentation: glyph ID → Slug/MSDF/bitmap/color drawing data
```

Vello sparse strips and Slug were identified as glyph/path rendering techniques, not replacements for HarfBuzz shaping.

## 2. Problems found in the original Slug shaping model

The original conceptual pipeline was:

```text
UTF-16 code unit
    ↓
binary-search cmap
    ↓
glyph ID
    ↓
advance
    ↓
explicit pair kerning
    ↓
absolute X position and wrapping
```

The discussion identified these correctness limits:

1. `charCodeAt()` walks UTF-16 code units, splitting supplementary-plane characters into surrogates.
2. A `Uint16Array` cmap cannot represent code points above U+FFFF.
3. Explicit pair kerning covers only a small subset of GPOS.
4. GSUB cannot be disabled in a modern shaper merely to preserve one-character/one-glyph indexing.
5. Shaping can produce many-to-one, one-to-many, reordered, attached, and zero-advance output.
6. A glyph must carry a cluster mapping, not just a presumed character index.
7. Shaping and wrapping should not be one loop because line boundaries are selected in source-text space.

The target shaped record became:

```ts
interface ShapedGlyph {
  glyphId: number
  cluster: number
  xAdvance: number
  yAdvance: number
  xOffset: number
  yOffset: number
  flags: number
}
```

Cluster values were chosen as UTF-16 offsets for JavaScript interoperability even though shaping internally decodes Unicode scalar values.

## 3. HarfBuzz behavior that cannot simply be baked away

The discussion decomposed HarfBuzz into:

1. segment properties: direction, script, language, feature set, variations;
2. Unicode preprocessing, normalization decisions, joining, category assignment, syllables, and reordering;
3. nominal cmap mapping;
4. GSUB lookup application;
5. GPOS advances, offsets, cursive attachment, and marks.

Font-specific data can be compiled, but arbitrary strings cannot all be pre-shaped. Contextual substitutions, joining, Indic syllables, combining marks, language features, and variations depend on runtime input.

The useful goal was reframed from “precompute every shaping result” to:

> Compile font-specific layout data into a runtime-oriented representation while retaining the shared Unicode and script state machines.

## 4. Evolution from three shaping profiles to one engine

An early proposal divided shaping into:

- fast Latin;
- compiled OpenType layout;
- full HarfBuzz-compatible shaping.

That was rejected as the public/product abstraction. The revised direction was one engine and one format with sparse capabilities:

```text
shape(font, text, options) → ShapedRun
```

A simple font naturally contains only cmap, metrics, and perhaps pair positioning. A complex font contains additional lookup data and invokes more script behavior. The API does not change.

Script logic may still be modular or lazy internally, but that is a packaging choice rather than a different shaping profile.

## 5. Proposed compiled font IR

The font was reframed as a program plus data. The discussion proposed high-level operations rather than a tiny stack VM:

```text
SingleDeltaRange
SingleMap
MultipleSubstitution
AlternateSubstitution
LigatureTrie
ReverseChainSingle
ContextDfa
SinglePosition
PairPositionDirect
PairPositionClass
CursiveAttachment
MarkToBase
MarkToLigature
MarkToMark
ContextPosition
```

A coarse program might be:

```text
APPLY_SINGLE_TABLE table=4
APPLY_LIGATURE_TRIE trie=2
APPLY_CONTEXT_DFA automaton=1
APPLY_CLASS_PAIRS table=7
APPLY_MARK_ATTACHMENTS set=3
```

The alternative—a bytecode instruction per load, compare, and branch—was considered too dispatch-heavy.

Proposed representations included:

- dense direct glyph-indexed metrics and classes;
- ASCII direct cmap plus paged Unicode cmap;
- range, bitset, or small-list coverage;
- CSR explicit pair overrides by left glyph;
- class maps plus dense class-pair matrices;
- packed ligature tries;
- contextual automata;
- per-glyph GDEF-derived flags;
- shared anchor pools;
- fixed-point or design-unit integer metrics.

The baker, not the runtime, would choose among dense and sparse representations.

## 6. Wasm interpreter, implementation language, and MLIR

Two bytecode layers were distinguished:

1. WebAssembly: the compiled implementation of the shared runtime.
2. Font shaping IR: baked font-specific data interpreted by that runtime.

The production interpreter was proposed in Rust or Zig, with Rust preferred for maintainability, safety, ecosystem, and HarfRust integration. Zig remained attractive for explicit memory control and small freestanding Wasm. C/C++ were discussed mainly for direct HarfBuzz reuse.

MLIR was considered inappropriate as the initial implementation language. A future compiler path could be:

```text
OpenType GSUB/GPOS
    ↓
custom shaping dialect/IR
    ↓
optimization and lowering
    ↓
LLVM IR
    ↓
Wasm
```

This would make sense only if font-specific specialization proved valuable enough to justify a compiler platform, dialect, verification, lowering passes, and large baker toolchain dependency.

A staged alternative was proposed:

1. readable TypeScript reference interpreter;
2. Rust/Zig Wasm interpreter;
3. simple direct IR-to-Wasm or generated-Rust AOT experiment;
4. MLIR only after demonstrated need for sophisticated transformations or multiple targets.

## 7. Browser JIT versus bake-time AOT

The discussion considered Andy Wingo's Wasm JIT work. Because Wasm code is not ordinary writable executable memory, runtime specialization would generate and instantiate another Wasm module and link it through a function table.

For font shaping, the concerns were:

- text runs are often short;
- module generation, validation, compilation, and instantiation add startup cost;
- specialization keys include font, script, language, direction, and features;
- caching and invalidation become complex.

Bake-time AOT specialization was considered more promising:

```text
font layout → high-level shaping IR → font-specialized Wasm
```

The recommended hybrid kept large tables as data and generated only stage order, specialized loops, constants, and dispatch. Giant switch statements containing all font data were explicitly discouraged.

Final discussion position:

- interpreter first;
- browser-time JIT not initially;
- per-font AOT only after measurement;
- shaped-run caching likely offers a larger real-world gain for repeated text.

## 8. SIMD discussion

The interpreter was proposed as SIMD-assisted, not SIMD-defined:

```text
scalar control engine
    ├── SIMD classify
    ├── SIMD range substitution
    ├── SIMD property scan
    ├── SIMD bulk adjustments
    ├── SIMD prefix sum
    └── scalar contextual/attachment fallback
```

Promising candidates:

- scan 8–16 UTF-16 units for an ASCII fast path;
- classify four code points or many byte-sized glyph flags;
- range tests and delta substitutions over eight `u16` glyph IDs;
- candidate detection for ligatures/context rules;
- bulk advance and offset updates;
- widening `i16` metrics into `i32` work values;
- short vector prefix sums for final positions;
- glyph quad, culling, and GPU instance generation.

Limitations identified:

- ordinary Wasm SIMD lacks general arbitrary gather loads, limiting cmap/class/pair lookup vectorization;
- ligatures consume variable lengths and mutate output;
- contextual rules have lookbehind/lookahead and ignored-glyph semantics;
- mark/cursive attachment follows irregular relationships;
- Arabic/Indic preprocessing contains state machines and reordering.

**Conversation estimates:** vectorized kernels might individually reach 2–4× or more on favorable regular work, while whole long-run shaping might see roughly 1.2–2×. Very short labels might see little benefit. These figures were not measured.

## 9. Ecosystem prior art and the proposed opportunity

The conversation surveyed adjacent projects and concluded that the individual layers are well established:

- HarfBuzz: shaping, OpenType/AAT behavior, subsetting, and font-platform utilities;
- FreeType: outline loading, hinting, and rasterization;
- Fontations/Skrifa: Rust font reading and outline/metadata access;
- HarfRust and RustyBuzz: Rust implementations/ports of HarfBuzz-style shaping;
- Allsorts: Rust parsing, shaping, and subsetting work;
- Parley: text layout;
- Swash and related Rust crates: glyph scaling/rasterization;
- Vello and sparse strips: GPU/vector rendering research.

The claimed opportunity was not a new shaping algorithm or rasterizer. It was the combined deployment architecture:

```text
OpenType source
    ↓ compile once
renderer-independent baked font identity/layout data
    ↓
small portable runtime
    ↓
multiple presentation backends
```

This was described as an “OpenType compiler” rather than another font parser, and aspirationally as “glTF for fonts.” The discussion did not establish market novelty through an exhaustive survey; that claim must be re-researched before external use.

The conversation also noted programmable-font/Wasm work around HarfBuzz as adjacent evidence that Wasm can be a shaping execution environment. It explicitly distinguished fonts containing custom Wasm shaping logic from this project's proposal to run the shared engine or compiled font data in Wasm. Current upstream status must be verified before this becomes a design dependency.

## 10. HarfBuzz reuse, HarfRust, and conformance

The discussion separated:

- script shapers and shared buffer semantics;
- font-specific GDEF/GSUB/GPOS programs.

It concluded that HarfBuzz does not expose a portable serialized shape plan or extractable shaper IR through its public API. Copying individual complex-shaper files would pull in buffer mutation, Unicode tables, generated syllable machines, feature masks, normalization, cluster merging, unsafe flags, fallback positioning, and compatibility workarounds.

Three approaches were considered:

1. minimal HarfBuzz Wasm over shaping-only OpenType data;
2. port/use HarfRust;
3. extract only selected scripts with explicitly limited conformance.

HarfRust became the preferred baseline after deciding that a Rust dependency was acceptable. The desired long-term boundary was:

```text
HarfRust Unicode/script/buffer machinery
          +
pmndrs/text baked lookup provider
```

A conceptual provider interface was proposed for cmap, advances, glyph class, and ordered GSUB/GPOS stages. It was acknowledged that this integration seam may require upstream work or a maintained adaptation because it is not necessarily a public HarfRust abstraction today.

Conformance was defined behaviorally. For identical font/text/direction/script/language/features/variations/buffer flags/cluster level, compare:

- glyph IDs;
- clusters;
- x/y advances;
- x/y offsets;
- glyph flags;
- output count and errors.

The proposed three-way test was:

```text
original font → HarfBuzz
original/subset font → HarfRust
baked GLB → pmndrs/text Wasm
```

It also called for HarfBuzz/HarfRust corpus reuse, differential fuzzing, cluster-specific tests, version pinning, and HarfRust fallback-versus-fast-path execution in verification builds.

## 11. Runtime and payload estimates from the discussion

All values in this section are **conversation estimates**, not measurements.

### Shared shaping runtime

Two sets of rough estimates appeared as the design evolved:

| Runtime concept | Raw Wasm estimate | Compressed estimate |
| --- | ---: | ---: |
| Simple initial shaping engine | not consistently separated | 25–60 KB |
| Broad modern engine | not consistently separated | 75–175 KB |
| Minimally wrapped HarfRust | 250–600 KB | 90–250 KB |
| Aggressively pruned HarfRust fork | 180–400 KB | 70–170 KB |
| Shared compiled-IR interpreter | 60–180 KB | 25–80 KB |
| Latin/default-only IR runtime | 25–80 KB | 12–40 KB |

The discussion emphasized that `no_std` alone would not cause the largest reduction. Larger levers were generic OpenType parsing, linked script shapers, Unicode table packing, variation support, exported/debug APIs, allocation/runtime glue, LTO, and feature selection.

### Per-font shaping payload

| Font category | Raw estimate | Compressed estimate |
| --- | ---: | ---: |
| Basic Latin UI, 256–512 glyphs | 6–29 KB | 3–15 KB |
| Typical capable Latin example | about 20 KB | 8–14 KB |
| Large Latin/Greek/Cyrillic | 20–80 KB | 10–40 KB |
| Arabic | 30–120 KB | 15–60 KB |
| Indic/context-heavy | 75–400 KB | 30–180 KB |
| CJK shaping data | 50–300 KB, geometry excluded | not pinned |

A concrete 512-glyph sketch allocated roughly:

```text
metrics and flags       ~2 KB
paged cmap              ~1.5–6 KB
class kerning           ~4.6 KB
Latin ligature trie     ~1–4 KB
mark positioning        ~2–10 KB
headers/indexes         ~2 KB
```

Shaping-only OpenType sections were estimated at roughly 10–60 KB compressed for Latin subsets and 40–300+ KB for elaborate Arabic/Indic fonts. Compiled IR reductions were guessed at 10–50% depending on font structure, with an explicit warning that naive expansion can make IR larger.

Per-font generated Wasm was estimated in two places as approximately 2–15 KB or 2–30 KB compressed on top of data, assuming tables remain data segments.

### Whole-shape speed estimates

| Workload | Conversation estimate for compiled lookup IR versus generic HarfRust path |
| --- | ---: |
| Short Latin labels | 0–30% |
| Long Latin | 1.2–2×, occasionally higher in favorable cases |
| Arabic | 1.2–1.8× |
| Indic/USE | 1.1–1.6× |
| Emoji/ZWJ | 1.0–1.5× |

The discussion used Amdahl's law to explain the ceiling: if lookup interpretation is half the cost and becomes 3× faster, total shaping improves only about 1.5×.

Suggested go/no-go thresholds included one or more of:

- at least 2× on the real dynamic-text workload;
- at least 100 KB compressed shared-runtime savings;
- at least 30% total font-asset reduction;
- materially lower startup/transient memory;
- or a unique capability such as direct canonical/GPU-oriented output.

These thresholds were brainstorming inputs, not accepted gates.

The conversation also estimated possible **local** kernel speedups, which are even less predictive of whole-shape performance:

| Kernel | Conversation estimate |
| --- | ---: |
| Coverage membership | 2–8× |
| Range single substitution | 3–10× |
| Class kerning lookup | 2–5× |
| Ligature candidate scanning | 2–4× |
| Anchor lookup | 1.5–4× |
| Shape-plan construction | mostly eliminated/cached |
| Font parse/validation on normal baked path | eliminated |

These estimates exist only to identify benchmark targets. They are not evidence that the associated representation should be built.

## 12. Unified shaping and multiple presentations

The discussion expanded the project beyond Slug to support:

- Slug vector curves;
- SDF/MSDF/MTSDF;
- generated bitmap strikes;
- post-slice color layers and image glyphs;
- icons and emoji.

All presentations share one packed glyph-ID space:

```text
source OpenType glyph ID
        ↓ subset/remap
packed glyph ID
        ├── shared shaping/metrics
        ├── Slug data
        ├── MTSDF record
        ├── bitmap strike record
        └── post-slice color/image record
```

The discussion proposed per-glyph presentation availability bits and runtime policy based on projected pixel size:

```text
color glyph → native color presentation
tiny text + strike available → bitmap
normal text + MTSDF available → MTSDF
large/zoomed text + Slug available → Slug
```

This policy remained illustrative, not decided.

It distinguished:

- logical bounds for measurement/selection;
- ink bounds for visible glyph extent;
- presentation bounds for padded quads, distance range, filtering, or effects.

Advances and kerning belong only to the shared font section. Presentation plane/atlas bounds must never drive shaping.

## 13. MTSDF and bitmap details discussed

Proposed distance-field metadata included:

- technique: SDF/MSDF/MTSDF;
- atlas dimensions and pages;
- texture format and color space;
- plane bounds;
- atlas bounds;
- page index;
- pixel/distance range;
- generation em size/scale;
- sampling and mip policy;
- availability marker.

A per-glyph MTSDF/MSDF record was estimated around 20 bytes before compression, making roughly 10 KB of metadata for 512 glyphs; atlas textures dominate.

Bitmap generation was defined as a baker responsibility:

```text
source outline
    ↓ static variation instance
    ↓ scale to requested ppem
    ↓ rasterize coverage
    ↓ crop/pad
    ↓ atlas pack
    ↓ strike glyph record
```

Proposed options included strike sizes, grayscale/mono/LCD/RGBA mode, hinting, antialiasing, oversampling, padding, atlas limits, and R8/RGBA8 format. An illustrative default used `[12, 16, 24, 32]`, grayscale, no hinting, 2× oversampling, one-pixel padding, and R8. None of those defaults was accepted.

Authored bitmap fonts were noted as a possible future ingestion case. The shaping source and presentation source could theoretically differ, but the primary product flow takes a normal source font and generates the presentations.

## 14. Icons, emoji, and color glyphs

Font icons were treated as a simple specialization: cmap, advance, presentation, and optional separate name lookup. A 2,000-icon codepoint-to-glyph map was roughly estimated at 12–16 KB raw before compression, excluding geometry.

Emoji were split into presentation cases while retaining one shaping engine:

- monochrome outline emoji: normal presentation plus supplementary cmap, variation selectors, ZWJ/ligature rules;
- color layered vector glyphs: post-slice layer/paint records referencing packed glyph IDs;
- bitmap/image emoji: atlas/image presentation.

Color layers and bitmap images were identified as presentation concerns, not alternative shaping systems. The current rescope makes color emoji and SVG icon fonts required after the first vertical slice: supported COLR/SVG vectors bake into Slug geometry and paint/layer records, while embedded images remain bitmap presentations.

## 15. GLB organization and direct GPU data

The proposed extension family was:

```text
PMNDRS_font
PMNDRS_font_slug
PMNDRS_font_distance_field
PMNDRS_font_bitmap
post-slice Slug color layers + bitmap images
```

The shared section would contain metrics, cmap, glyph properties, shaping programs/reference data, script/language/feature metadata, and presentation availability.

The discussion proposed a binary header and section directory with:

- magic and version;
- flags and glyph count;
- units per em;
- glyph-ID and coordinate widths;
- line metrics;
- section and presentation counts;
- offsets/lengths/counts/stride/alignment;
- compiler, HarfBuzz/HarfRust, and Unicode versions.

The key direct-data requirement was clarified:

> “Direct to GPU” means final scalar format, layout, stride, dimensions, and addressable byte ranges with no per-glyph conversion or repacking. It does not mean the browser avoids resource creation, copies, or image decoding.

The discussion suggested 16-byte general section alignment and noted that raw texture rows may require backend-specific padding such as WebGPU's copy layout constraints. Whether that padding belongs in the asset remained open.

It proposed using standard glTF accessors for genuinely GPU/interoperable arrays and a custom byte-oriented section for compact CPU shaping data.

## 16. Portable baker and runtime fallback

The baker changed from an offline-only tool into a portable compiler used in two environments:

```text
CLI/native build tool ─┐
                      ├── shared Rust compiler core → canonical PMNDRS_font bytes
worker Wasm fallback ─┘
```

The loader flow became:

```text
pre-baked PMNDRS_font → validate/register/upload

source TTF/OTF/WOFF2
    → lazy worker
    → lazy runtime baker library + Wasm core
    → canonical bytes
    → persistent cache
    → same validate/register/upload path
```

Two Wasm-backed libraries/modules were proposed:

- always/commonly loaded shaper Wasm module;
- larger lazy runtime baker library and Wasm core containing parsing, subsetting, outline conversion, Slug/MTSDF/bitmap generation, atlas packing, and GLB writing.

Runtime cache identity included:

- source font hash;
- compiler and format versions;
- glyph selection/ranges/text;
- variation coordinates;
- presentation options and generator versions.

Large fonts, especially CJK, motivated explicit glyph selection, shaping closure, time/memory/atlas limits, progress, cancellation, and transferable buffers.

Progressive secondary-presentation generation was considered but deferred because it complicates package identity and cache semantics. The format should not preclude adding/fetching presentations later.

## 17. Paragraph regions and reflow

Fixed regions were identified as paragraph layout constraints:

- width and optional height;
- maximum lines;
- wrap strategy;
- alignment/justification;
- line height;
- clipping, visibility, or ellipsis.

The detailed pipeline was:

```text
text + style spans
    ↓ paragraph and bidi analysis
    ↓ shape logical runs
    ↓ Unicode line-break opportunities
    ↓ measured shaped clusters
    ↓ choose line boundaries
    ↓ reshape final boundary-sensitive ranges
    ↓ visual line order and positioning
```

Breaks are selected at UTF-16 source boundaries, not glyph indexes. A measured cluster maps a source range to a glyph range, advance, and safety flags.

The initial wrapping algorithm was greedy:

1. accumulate cluster advances;
2. remember the latest legal break that fits;
3. on overflow, use that break;
4. optionally use an emergency grapheme break;
5. permit an overfull line for an indivisible cluster depending on policy.

Balanced wrapping was reserved as a later strategy using the same measurements.

Boundary reshaping may be required for Arabic joining, contextual substitutions, cursive attachment, soft/injected hyphens, ellipsis, start/end-sensitive lookups, and unsafe breaks. The discussion proposed shaping broad runs for measurement, then reshaping final line slices only where required, with optional pre/post context.

Bidi analysis is paragraph-wide, while visual reordering occurs per final line. Source text stays in logical order.

Height overflow behavior discussed:

- clip: retain layout and clip presentation;
- visible: continue beyond the region;
- ellipsis: shape ellipsis, reserve width, find a safe preceding boundary, and reshape the shortened final line.

## 18. JS paragraph engine and Wasm crossing budget

The final ownership decision in the conversation placed paragraph policy in JS/TypeScript and shaping in Wasm.

JS responsibilities:

- style spans and application API;
- width/height constraints;
- break strategy and alignment;
- overflow/ellipsis;
- layout caches;
- framework lifecycle;
- batching reshape ranges.

Wasm responsibilities:

- Unicode/script shaping;
- clusters and four positioning fields;
- unsafe flags;
- batched run/range shaping.

A width change always reflows, but ordinary Latin should reuse broad shaping. Boundary-sensitive lines may be reshaped.

The desired boundary-crossing budget was:

```text
text/style/font change       1 full batched shaping call
simple width change          0 Wasm calls
boundary-sensitive reflow    1 batched reshape call
per line                     avoid
per glyph                    never
```

Persistent Wasm memory and typed-array views were proposed to avoid serializing glyph objects or allocating arrays per call.

Three cache levels were discussed:

- paragraph analysis: Unicode, script, bidi, breaks, fallback, spans;
- broad run shaping: font/range/script/direction/language/features;
- line shaping: text range plus boundary context and style configuration.

Incremental reflow could stop once new line boundaries converge with a cached old tail.

## 19. Original broad milestone sequence

The conversation's final broad plan evolved into:

1. general shared font container and dense IDs;
2. HarfRust Wasm reference shaping;
3. presentation abstraction;
4. direct GPU buffers;
5. compiled common lookup data;
6. SIMD kernels;
7. compiled complex lookups;
8. portable bake core with Node and dynamically loaded runtime library hosts;
9. generated bitmap and MTSDF presentations;
10. JS paragraph engine and batched reshape;
11. conformance, fuzzing, and benchmarking throughout;
12. downstream Three Flatland migration.

The ordering was exploratory and contains too much for a single V1. [`SCOPE_LANES.md`](SCOPE_LANES.md) separates implementation scope from compatibility lanes.

## 20. Ideas explicitly rejected or deferred during discussion

- Three public shaping profiles.
- Treating sparse strips/Slug as a shaping alternative.
- Keeping one glyph per UTF-16 code unit.
- Shipping the complete original TTF/OTF on the normal path.
- Flattening all class kerning into every explicit pair.
- Using presentation atlas bounds as advances.
- Reconstructing large per-glyph JS object graphs.
- Calling Wasm per glyph or per line during every reflow.
- Starting with an MLIR dialect.
- Starting with browser-time JIT.
- Attempting to independently rewrite all HarfBuzz script shapers before shipping.
- Making all consumers download the runtime baker.
- Making variable font axes, vertical writing, Graphite, color/SVG presentation, or GPU shaping blockers for the first vertical slice. Color emoji and SVG icon fonts remain required post-slice product work.

## 21. Items that remained unresolved

- Exact HarfRust provider/integration seam.
- Reference engine and Unicode version pins.
- Whether reference shaping-only OpenType tables are retained in shipped V1 or only development builds.
- Exact cmap page representation.
- `u16` versus dual-width packed glyph IDs.
- Binary header and extension names.
- Hinting and bitmap rasterizer choice.
- MTSDF implementation suitable for Rust/Wasm and deterministic output.
- Bidi ownership and Unicode JS dependencies.
- Font fallback granularity.
- Worker cache storage API and limits.
- Raw versus compressed GPU texture payload strategy.
- Whether one GLB or separately fetchable presentations best serves large assets.
- The measured value of compiled lookup IR, SIMD, and per-font AOT.

## Extraction completeness checklist

The following original discussion topics are represented above:

- [x] current Slug shaping limitations;
- [x] HarfBuzz shaping stages;
- [x] precomputation limits;
- [x] unified engine versus profiles;
- [x] high-level shaping IR;
- [x] browser JIT and bake-time AOT;
- [x] implementation language and MLIR;
- [x] SIMD candidates and constraints;
- [x] ecosystem/novelty framing;
- [x] HarfBuzz reuse and HarfRust direction;
- [x] conformance strategy;
- [x] runtime and font payload estimates;
- [x] whole-shape speed estimates and Amdahl limit;
- [x] renderer-independent shaping;
- [x] Slug/MSDF/MTSDF/bitmap presentation data;
- [x] icons, emoji, color/image distinction;
- [x] GLB extension and binary-layout sketches;
- [x] direct-GPU meaning;
- [x] portable worker fallback baker;
- [x] generated bitmap pipeline;
- [x] paragraph regions, reflow, reshaping, bidi, and overflow;
- [x] JS paragraph ownership and Wasm crossing budget;
- [x] cache layers and milestone sequence;
- [x] rejected/deferred directions and unresolved questions.

This is a semantic extraction rather than a verbatim transcript. The linked conversation remains the provenance for wording and chronology; this record exists so rescoping does not erase explored lanes.
