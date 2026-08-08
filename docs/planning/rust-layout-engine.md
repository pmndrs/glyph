---
type: Design Proposal
title: Rust text engine and retained render-plan ABI
description: Defines a Rust-owned shaping, layout, typography, and render-plan pipeline with one steady-state Wasm update transaction and renderer-directed incremental output.
status: draft
tags:
  - layout
  - shaping
  - typography
  - rendering
  - wasm
  - performance
  - abi
generated:
  by: openai-codex/gpt-5.6
  at: '2026-08-08T07:00:00Z'
sources:
  - id: layout-benchmark
    resource: ../../packages/text/scripts/benchmark-paragraph-layout.mts
    title: Paragraph layout benchmark, workflow text:layout-benchmark
  - id: paragraph
    resource: ../../packages/text/src/paragraph.ts
    title: TypeScript paragraph preparation and layout
  - id: paragraph-batch
    resource: ../../packages/text/src/paragraph-batch.ts
    title: Current canonical packing and dirty-range implementation
  - id: shaper-crate
    resource: ../../packages/text/rust/shaper/src/lib.rs
    title: HarfRust Wasm shaper crate
  - id: vertical-writing
    resource: vertical-writing.md
    title: Vertical-writing research
  - id: editorial-flow
    resource: editorial-flow-layout.md
    title: Editorial-flow research
  - id: writing-modes
    resource: https://www.w3.org/TR/css-writing-modes-4/
    title: CSS Writing Modes Level 4
  - id: css-text
    resource: https://www.w3.org/TR/css-text-4/
    title: CSS Text Level 4
  - id: text-decoration
    resource: https://www.w3.org/TR/css-text-decor-4/
    title: CSS Text Decoration Level 4
  - id: inline-layout
    resource: https://www.w3.org/TR/css-inline-3/
    title: CSS Inline Layout Level 3
  - id: multicol
    resource: https://www.w3.org/TR/css-multicol-2/
    title: CSS Multi-column Layout Level 2
  - id: jlreq
    resource: https://www.w3.org/TR/jlreq/
    title: Requirements for Japanese Text Layout
  - id: ruby
    resource: https://www.w3.org/TR/css-ruby-1/
    title: CSS Ruby Annotation Layout Module Level 1
  - id: harfbuzz
    resource: https://harfbuzz.github.io/harfbuzz-hb-buffer.html
    title: HarfBuzz buffer and safe-concatenation contract
  - id: icu4x
    resource: https://docs.rs/icu_segmenter/latest/icu_segmenter/
    title: ICU4X segmenter Unicode-version documentation
  - id: parley
    resource: https://docs.rs/parley/latest/parley/layout/
    title: Parley retained rich-text layout
  - id: pretext
    resource: https://github.com/chenglou/pretext
    title: Pretext incremental per-line text layout
  - id: webrender
    resource: https://firefox-source-docs.mozilla.org/gfx/RenderingOverview.html
    title: Firefox rendering overview and display lists
  - id: staging
    resource: https://docs.rs/wgpu/latest/wgpu/util/struct.StagingBelt.html
    title: wgpu staging-belt upload model
  - id: wasm-js-api
    resource: https://webassembly.github.io/spec/js-api/
    title: WebAssembly JavaScript API
  - id: wasm-simd
    resource: https://webassembly.github.io/spec/core/
    title: WebAssembly core SIMD and relaxed-operation semantics
  - id: rust-simd
    resource: https://doc.rust-lang.org/core/arch/wasm32/index.html
    title: Rust wasm32 SIMD intrinsics and target-feature model
  - id: safari-simd
    resource: https://webkit.org/blog/13966/webkit-features-in-safari-16-4/
    title: WebAssembly 128-bit SIMD in Safari 16.4
  - id: chrome-simd
    resource: https://blog.chromium.org/2021/04/chrome-91-handwriting-recognition-webxr.html
    title: WebAssembly SIMD enabled by default in Chrome 91
  - id: firefox-simd
    resource: https://bugzilla.mozilla.org/show_bug.cgi?id=1625130
    title: Firefox WebAssembly SIMD shipping record
  - id: worker-transfer
    resource: https://html.spec.whatwg.org/multipage/workers.html
    title: HTML Worker transfer semantics
  - id: renderer-capabilities
    resource: renderer-capabilities.md
    title: Renderer capability matrix
  - id: payload-budget
    resource: payload-budget.md
    title: Font and raster payload budget
  - id: mlreq
    resource: https://www.w3.org/TR/mlreq/
    title: Mongolian Layout Requirements
  - id: unicode-emoji
    resource: https://www.unicode.org/reports/tr51/
    title: Unicode Emoji 17
  - id: opentype-colr
    resource: https://learn.microsoft.com/en-us/typography/opentype/spec/colr
    title: OpenType COLR color table
  - id: opentype-cbdt
    resource: https://learn.microsoft.com/en-us/typography/opentype/spec/cbdt
    title: OpenType CBDT color bitmap table
  - id: opentype-sbix
    resource: https://learn.microsoft.com/en-us/typography/opentype/spec/sbix
    title: OpenType sbix color bitmap table
---

# Rust text engine and retained render-plan ABI

This proposal supersedes the narrower “move paragraph layout into Rust” draft. The unit moving into Rust is the complete
text engine: Unicode analysis, bidi, style itemization, shaping, cluster construction, line breaking and composition,
positioning, typography-derived geometry, and renderer-neutral render-plan compilation. TypeScript retains public API
lifecycle and renderer integration; it does not retain a second implementation of typography.

The engine publishes two related products:

1. a semantic layout snapshot for editing, accessibility, hit testing, native reuse, and diagnostics; and
2. a revisioned render plan describing resources, physical buffer views, minimal patches, ordered primitives, and draw
   packets that the initial Three/TSL dual-backend adapter or a native adapter lowers into its own commands.

The render plan is deliberately closer to a display list or submission transaction than a shaped-glyph array. It is
not a literal WebGPU command buffer: backend-specific pipelines, staging, fences, and command encoding remain with the
renderer.

## Decisions this proposal makes

- Correctness-critical shaping and layout logic has one Rust implementation shared by native and Wasm consumers.
- A dirty text session performs one Wasm update transaction in steady state. Unchanged animation frames perform none.
  Font registration, session creation, cold reservation, and transfer-buffer return are lifecycle operations, not
  hidden typography crossings.
- Per-line widths are computed inside Rust from declarative flow regions, columns, exclusions, and inline objects. An
  arbitrary host callback per line is incompatible with both a single crossing and native reuse.
- The engine output contains semantic layout state and a portable render plan. Canonical GPU-ready records are requested
  views within that plan, not the only representation of the result.
- Render implementations register a versioned render-plan policy describing formats, batching compatibility,
  capabilities, patch preferences, and permitted augmentations. Stable policies are referenced by ID on updates rather
  than serialized every frame.
- A loaded font owns its raster technique and resource binding. `FontStack`, `Text`, and `TextGroup` do not ask the user
  to repeat a technique: an ordered stack may contain fonts from different techniques in the same runtime, and the
  render policy declares which of those techniques its engine can lower.
- Result publication uses A/B Wasm buffers for synchronous reads only. A retained or asynchronous result is copied into
  a worker-owned transferable `ArrayBuffer`; root returns ownership of that same buffer to the worker on retirement so
  pooling or garbage collection occurs on the worker rather than root.
- Incremental output is revision-relative. If a consumer cannot apply the advertised base revision, the engine emits a
  checkpoint rather than allowing a partially updated buffer.
- Scalar Rust remains the correctness oracle, but the engine's chunking, storage, alignment, flags, summaries, scratch,
  and render-policy execution are designed around 128-bit Wasm lanes before the port. SIMD viability is an entry gate,
  not a cleanup experiment after an allocation-heavy scalar architecture has hardened.

## What the current code establishes

The current ownership split does not match the target architecture:

- `paragraph.ts` owns Unicode segmentation, style and bidi orchestration, shaping-run preparation, cluster measurement,
  UAX line-break consumption, greedy composition, ellipsis, visual reordering, positioning, alignment, and
  justification.
- the Rust shaper owns HarfRust calls, bidi analysis, font registration, and its wire ABI, but no paragraph composition;
- `paragraph-batch.ts` packs every live glyph from slot zero and then byte-compares the full live storage to discover
  dirty ranges; and
- renderer adapters repack or copy those canonical arrays again according to backend constraints.

That evidence changes several claims in the earlier draft:

- A current text edit crosses the Wasm boundary at most for bidi analysis and broad shaping. The redundant boundary
  reshape crossing has already been removed and contract tests assert zero reshape calls.
- “Atomic entry point, no logic moved” is not a valid stage. TypeScript needs bidi output to construct shaping runs, and
  future line composition determines the narrowed context used for boundary reshaping. Those operations cannot become
  private internal calls while TypeScript still orchestrates the data dependency between them.
- Small memcpy measurements show that copying is not the dominant cost in the measured workload. They do not establish
  that full-buffer rewriting, scanning, repeated upload calls, or suffix movement are free.
- Double buffering does not eliminate CPU-to-GPU transfer and does not make a detached JavaScript view valid after
  `memory.grow()`. It protects immutable publication generations; renderer-owned staging protects GPU submission.
- Returning only instance data would discard the information native consumers, editing surfaces, selection,
  accessibility, decorations, and alternative renderers need.

On the current branch, the pinned `text:layout-benchmark -- --glyphs 22000` workload renders 25,515 glyphs and measured:

| Invalidation |   Median |      p95 | Relative to 8.33 ms |
| ------------ | -------: | -------: | ------------------: |
| cold         | 53.78 ms | 73.83 ms |         6.5× median |
| font size    | 12.50 ms | 17.75 ms |         1.5× median |
| layout width |  9.38 ms | 13.69 ms |         1.1× median |
| text edit    | 39.11 ms | 41.72 ms |         4.7× median |

The warm lanes showed 12.7–15.4% relative standard deviation in that run. These are a local baseline, not a universal
forecast, but they establish that the present full-paragraph warm path does not synchronously meet 120 Hz.

## Architectural boundary

### Rust core

Create a renderer-neutral `no_std + alloc` Rust text-engine core, separated from the Wasm transport. The Wasm artifact
uses the repository-pinned Talc 5.0.4 dynamic allocator, aborting panics, LTO, one codegen unit, stripping, and the
`wasm-opt -Oz` pass, matching the existing portable Wasm crates. Host-only measurement, fixture, compression, and oracle binaries may
use `std`; production semantic code may not acquire a `std`-only dependency.

The core owns:

- retained document and paragraph state, revisions, cache dependencies, and invalidation;
- Unicode 17 grapheme, word, script, bidi, and line-break analysis;
- the existing immutable ordered `FontStack` and `.notdef`-driven fallback semantics, generalized so each selected font
  carries its own raster technique and resource binding, plus style itemization, OpenType features, and horizontal and
  vertical shaping of the existing static-font contract;
- cluster advances, safe boundary reshaping, line composition, justification, and positioning;
- horizontal and vertical writing-mode geometry;
- decorations, inserted-glyph provenance, inline-object placement, and interaction geometry;
- resource identities, stable instance identities, physical record compilation, dirty patches, and draw packets; and
- scalar and optional SIMD implementations behind identical semantic contracts.

The same crate is called directly by native consumers. A thin Wasm crate validates the binary request, invokes the
core, and publishes a versioned binary result. Browser-specific typed-array pinning must not leak into the core.

### TypeScript host

TypeScript owns:

- the ergonomic public API and conversion into explicit engine mutations;
- font and raster-resource lifecycle;
- registration of render-plan policies and backend capability sets;
- pinning and re-pinning Wasm memory views;
- transferable-buffer retirement: root transfers a retired buffer back to its originating worker rather than dropping
  it on the root thread;
- lowering the renderer-neutral plan through the one Three/TSL policy used by both WebGPU and forced WebGL2; and
- renderer-owned upload staging, command encoding, fences, and transfer-buffer retirement.

TypeGPU product integration is outside this stack. The Three/TSL adapter and a minimal native plan consumer prove the
display-list and policy boundaries without adding another renderer dependency or product surface.

It does not decide bidi runs, break lines, position glyphs, synthesize decorations, or rebuild dirty ranges.

## Retained update ABI

The hot operation is one mutation transaction:

```text
text_update(session_id: u32, request_offset: u32, request_len: u32) -> u32
```

“One crossing” means one call for a dirty session update. It does not mean one call on every `requestAnimationFrame`,
and it does not forbid cold lifecycle exports whose outputs are retained.

### Request

The versioned request contains offsets to packed sections for:

- ABI version, session ID, expected engine revision, and last consumed render-plan revision;
- ordered text mutations and stable style/span mutations;
- paragraph constraints and writing-mode changes;
- complete flow geometry for this call: regions and their shapes, exclusions, inline objects, viewport, and explicit
  page/region constraints, all in region-local coordinates before entry;
- deterministic composition limits: maximum regions, lines, clusters, and output bytes for this update;
- a registered render-policy ID and capability-set ID;
- requested semantic views such as hit-test, caret, selection, accessibility, and diagnostics; and
- optional policy parameters whose schema was validated at registration.

Stable fonts, policies, and capabilities are referenced by IDs. Repeating a large descriptor every frame would merely
move host work into serialization.

All offsets and lengths are range-checked before use. Enum tags, alignment, multiplication, and revision relationships
are validated at the Wasm boundary. Failure returns a typed result without exposing partially mutated state.

### Result

The result header contains:

- ABI version, status, engine revision, render-plan revision, and required base revision;
- active A/B output slot and publication generation;
- request and output capacity watermarks for a later update;
- offsets and lengths for semantic layout tables;
- offsets and lengths for resource, buffer, patch, primitive, and draw-packet tables; and
- diagnostics, feature fallbacks, and performance counters requested for development builds.

The engine commits a revision only after every section is valid. A failed update leaves the previously published
revision consumable.

### Capacity and memory growth

JavaScript cannot write an oversized request before calling the function that would grow its staging region. The ABI
therefore has an explicit cold lifecycle operation:

```text
text_reserve(session_id: u32, request_capacity: u32, result_capacity: u32) -> u32
```

The host computes the exact encoded request length before pinning. It calls `text_reserve` only when that length exceeds
the retained request arena or when a previous result watermark requires more result capacity. Reservation grows by the
declared settling policy, re-pins all views, and performs no typography. The normal sequence is:

1. reserve request and result capacity at session creation, or call `text_reserve` before pinning when a later mutation
   exceeds either watermark;
2. write the next mutation request into the retained staging arena;
3. call `text_update` once;
4. compare `memory.buffer` identity, re-pin all views if it changed, and validate the result header;
5. synchronously consume the published slot, or copy retained/asynchronous bytes into a worker-owned transfer buffer;
6. transfer that buffer to root with the plan revision and ownership token; and
7. when the renderer retires it, transfer the same buffer back to the worker for pooling or worker-side collection.

In the pinned runtime, `memory.grow()` detaches fixed-length `ArrayBuffer` views even when the memory declares a maximum.
The invariant is therefore not “only one export may ever grow.” It is: no memory-growing call may occur between pinning
a published result and the consumer's synchronous read, and the update operation is the only hot-path grow point. Future
resizable Wasm buffers can be feature-detected without weakening this fallback.

The Wasm A/B pair is never retained by root. The worker may reuse a Wasm slot as soon as its bytes have been consumed or
copied. Transfer buffers have an explicit ownership state machine—`worker-owned -> transferred-to-root -> retired ->
transferred-to-worker`—and are never accessed while detached. A bounded worker-side pool reuses returned capacities;
excess buffers become unreachable and are collected on the worker. Failure to return a buffer is observable backpressure,
not permission to grow an unbounded pool. GPU staging belts and submission fences remain backend responsibilities.
[^staging][^worker-transfer]

## Rust layout pipeline

Each update follows one dependency graph inside Rust:

```text
mutations
  -> retained Unicode analysis and style itemization
  -> bidi runs and font fallback
  -> shaping and clusters
  -> flow-band and inline-slot construction
  -> line breaking, narrowed boundary reshaping, and composition
  -> axis-neutral positioning, baselines, justification, and overflow
  -> decoration, inline-object, hit-test, caret, and selection geometry
  -> semantic snapshot
  -> policy-directed render-plan compilation
```

### Analysis and line breaking

The final engine cannot leave Unicode line breaking in TypeScript. The current JavaScript implementation is Unicode 17
and passes the repository's unmodified `LineBreakTest` gate. Published Rust segmenters do not yet provide the same
Unicode-version guarantee; for example, the current ICU4X line segmenter documents Unicode 15.1 data while its other
segmenters have advanced.[^icu4x]

The implementation stage should therefore port the current generated Unicode 17 tables and rule evaluation into Rust,
preserving attribution and licensing, and prove it against the same official vector file. Host-supplied break
opportunities may exist only as a short-lived differential-oracle mechanism before cutover, not as the architecture.

### Per-line composition and editorial flow

Pretext and Parley both support a retained prepared layout with line-by-line progress, but the public hot path here must
not call back to JavaScript for each width.[^pretext][^parley] Rust builds line bands from declarative regions and
subtracts exclusions to produce one or more available inline intervals. A line cursor carries the logical cluster,
fragment, region, column, and block-axis position. Public resume tokens allow pagination and viewport-limited layout
without exposing a mutable internal pointer.

Columns are strictly sequential. Each region has caller-supplied fixed geometry; the engine fills it once in logical
order and advances the cursor to the next region when its block extent is exhausted. There is no target-height search,
retry, redistribution, or implicit balancing solver. A shorter final column is valid output.

Sequential overflow through at least two supplied regions is required. Every region and exclusion is supplied before
the one `text_update` call, which completes shaping, band construction, exclusion subtraction, breaking, boundary
reshaping, positioning, and plan compilation without a measurement callback or host round trip. The measured envelope
may cap how many regions, vertices, exclusions, lines, and clusters one realtime transaction accepts; it may not remove
multi-region continuation. Missing the 4 ms gate blocks the milestone until the implementation or supported numeric
envelope changes. The engine never uses a wall-clock timer to stop mid-update. Partial/resume is an explicit overflow
result for requests outside that envelope, not the normal layout path.

### Portable flow model and Three integration

“Column” is not a core type. The core type is an ordered flow thread containing stable regions. Equal adjacent
rectangles render as columns; pages, panels, irregular shapes, and several text planes use the same model.

```text
FlowThread {
  regions: [FlowRegionId...]
  limits: { max_regions, max_lines, max_clusters, max_output_bytes }
}

FlowRegion {
  id
  writing_mode
  local_shape: rectangle | bounded_simple_polygon
  exclusions: [rectangle | bounded_simple_polygon...]
  clip_bounds
  geometry_revision
}
```

The exact polygon vertex, exclusion, and slot limits are selected by the Stage 0 performance packet. Shapes are in the
region's local 2D text plane. A region descriptor contains no Three object, world matrix, material, or GPU handle.

The current `ParagraphContentBox` becomes shorthand for a flow thread containing one rectangular region. The portable
paragraph API gains a mutually exclusive flow descriptor for explicit multi-region composition. Its layout output
identifies the region for every line and fragment and reports region-local inline/block coordinates plus overflow and
resume state.

The Three integration exposes `TextRegion`, an identity-bearing `THREE.Object3D` that owns one region's local shape,
exclusions, writing mode, clip bounds, and geometry revision. `Text` owns the ordered `FlowThread` story and references
its `TextRegion` objects explicitly. There is no semantic `TextFlow` scene object. `TextGroup` remains only a
rendering/batching owner; flow is never inferred from group child order.

- changing a region object's world transform updates rendering only;
- changing local region shape, writing mode, or exclusion geometry sends one flow-geometry mutation to Rust;
- render plans carry a region index/ID, and the Three/TSL policy reads a small `vec4`-record region-transform buffer on
  both WebGPU and the WebGL PBO fallback; and
- disposing or reordering a region changes the flow-thread revision without changing text or broad shaping state.

The canonical geometry inputs are rectangles and bounded simple polygons. Public helpers construct rectangles and
polygons and conservatively tessellate circles and curves when their geometry revision changes. For a 3D obstacle, the
Three layer projects a bounded silhouette into the target region's 2D plane and tessellates it before constructing the
update request. All resulting shapes are submitted with revisions in that same call. Rust owns line-band intersection,
exclusion subtraction, break choice, boundary reshape, and glyph placement. Projection and curve tessellation are scene
geometry integration, not a second typography implementation. Their cost is measured separately and vertex/exclusion
caps prevent arbitrary meshes from entering the realtime text transaction. Region or exclusion geometry may not depend
on the text measurement produced by that call; such a dependency would create the forbidden measurement-feedback loop.

An edit resumes from the earliest invalidated safe boundary. Recomposition stops when new line state converges with a
retained later line, or at the requested viewport/page boundary. A changed break still cascades when its flow actually
changes; the architecture makes that cascade incremental rather than pretending it does not exist.

Boundary reshaping uses HarfBuzz's safe-concatenation flags: walk backward to a safe cluster, shape only the narrowed
suffix through the proposed line end, retry farther back if the result begins unsafe, and splice the replacement. Tests
must contain a script and width for which the result is wrong when this step is removed.[^harfbuzz]

Position accumulation, alignment, justification, and vertical block progression use `f64` internally and narrow once
when writing an explicitly `f32` render view.

### Axis-neutral geometry and vertical text

Vertical text is not horizontal text with a rotated transform. The layout model uses logical inline and block axes from
the beginning, then maps them to physical coordinates at output. It supports at least:

- `horizontal-tb`, `vertical-rl`, and `vertical-lr` writing modes;
- `mixed`, `upright`, and `sideways` text orientation;
- vertical advances and origins from `vhea`, `vmtx`, and `VORG` where present;
- `vert`/`vrt2` OpenType behavior and Unicode vertical-orientation data;
- vertical baselines, column progression, punctuation placement, decoration orientation, and interaction geometry; and
- per-instance orientation so mixed Latin and CJK do not force separate semantic layouts.

This follows the distinction in Writing Modes and JLREQ: glyph orientation, line direction, punctuation, ruby, and
column order are related but not interchangeable operations.[^writing-modes][^jlreq]

## Publishing typography contract

The engine API should expose explicit typed values rather than cloning CSS strings, but its common-feature semantics
need a published reference. The initial contract is organized as capabilities so unsupported combinations fail or
report a fallback instead of silently approximating them.

| Area             | Required engine behavior                                                                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fonts and runs   | language and script, fallback, OpenType features, horizontal and vertical metrics, baselines; static fonts only                                                                  |
| Span positioning | explicit baseline shift, superscript/subscript positioning, and OpenType `sups`/`subs` features without a second text stream                                                     |
| Spacing          | letter spacing, word spacing, line height, paragraph space before/after, first-line and hanging indents, spacing in logical axes                                                 |
| Tabs             | authored left/right/center/decimal stops and bounded leader glyphs; the decimal alignment character is explicit rather than supplied by a locale database                        |
| Breaking         | word/character/no-wrap, whitespace handling, explicit soft hyphen and inserted-hyphen provenance                                                                                 |
| Alignment        | logical start/end/center, script-aware justification opportunities, hanging punctuation                                                                                          |
| Writing modes    | horizontal and both vertical progressions, mixed/upright/sideways orientation, vertical substitutions and origins                                                                |
| Decorations      | underline, overline, and line-through; color, thickness, offset, solid/double/dotted/dashed/wavy style, skip spaces, and bounded ink-box skipping                                |
| Editorial flow   | multiple regions and sequential columns, exclusions with multiple slots per band, inline objects, drop caps, forced breaks                                                       |
| Pagination       | explicit page/column breaks and resume tokens; no balancing or widow/orphan/keep solver                                                                                          |
| CJK emphasis     | emphasis marks and short horizontal runs in vertical text; ruby and warichu are out of scope                                                                                     |
| Emoji            | Unicode 17 grapheme, variation-selector, modifier, flag, tag, and ZWJ behavior through the ordinary font-fallback and shaping path; optional color art remains a raster resource |
| Interaction      | logical/visual ranges, cluster maps, caret stops, hit testing, selection geometry, accessibility reading order                                                                   |

Word spacing applies to identified word separators, while letter spacing operates between typographic character units
after shaping and bidi ordering; nonzero letter spacing also interacts with optional ligatures. Justification cannot be
implemented as uniform extra space between glyph records.[^css-text]

Decorations are layout-derived primitives, not renderer decoration flags. The core determines line fragments,
continuity, metrics, vertical orientation, skip-space behavior, and optional pre-baked ink-box intersections; the render
plan carries the resulting segments or paths alongside glyph primitives. Per-frame outline-curve intersection is not a
realtime feature.[^text-decoration]

The font baker must expose the data this contract consumes. Its prerequisites include underline and strike metrics,
vertical advances and origins, baseline data where available, glyph extents for skip-ink decisions, and retained feature
data required by vertical shaping. A declaration that these metrics “should be baked” is not implementation evidence.

### Per-font shaping-payload cost

Most retained features add engine behavior but no font bytes. The current baker already retains `GSUB`, `GPOS`, `GDEF`,
horizontal metrics, dense glyph extents, and optional `BASE`, `VORG`, `vhea`, and `vmtx` tables when present.

Measured source-table sizes for the repository fixtures establish the relevant bound:

| Capability                                                              | Per-font shaping-data effect                                                                                                                                         |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Word/letter spacing, breaking, regions, exclusions, and sequential flow | zero bytes                                                                                                                                                           |
| Tate-chu-yoko                                                           | zero bytes; uses existing glyphs and existing GSUB width features when available                                                                                     |
| Emphasis marks                                                          | zero bytes; uses an ordinary shaped/cached mark glyph                                                                                                                |
| Underline and strike                                                    | at most four extracted `i16` metrics, eight raw numeric bytes before container overhead                                                                              |
| Bounded ink-box skipping                                                | zero bytes; reuses the existing eight-byte dense extent record per glyph                                                                                             |
| Vertical shaping, Inter and Amiri fixtures                              | zero bytes; source fonts have no vertical tables and use the declared fallback                                                                                       |
| Vertical shaping, Noto Sans CJK JP                                      | `vmtx` 261,386 + `vhea` 36 + `VORG` 920 = 262,342 raw bytes, about 36.8 KiB when the three source tables are Brotli-compressed independently; already retained today |
| `BASE` in Noto Sans CJK JP                                              | 240 raw bytes; already retained and not exclusively vertical                                                                                                         |

Vertical layout therefore adds no new per-font bytes to the current artifact contract; it begins consuming data already
preserved. Underline metrics must be extracted from `post`, not retained by adding the whole table: Inter's source
`post` table is 32,773 bytes because it includes glyph names, while the needed underline position and thickness are four
raw bytes. Strike metrics already live in the required `OS/2` table.

The target Mac's installed Noto Sans Mongolian fixture has 1,598 glyphs. The exact tables retained by the current closed
shaping profile occupy 59,352 padded SFNT table bytes; with its SFNT directory, 8-byte dense extents, and availability
bits, the derived shaping payload is 72,524 raw bytes. This cost belongs only to that selected font. HarfRust 0.12 already
contains Mongolian script selection, Free Variation Selector handling, and shaping behavior, so accepting the font adds
no second shaper or language dictionary to the core. The vertical contract therefore includes Mongolian top-to-bottom,
left-to-right flow and conformance fixtures alongside CJK top-to-bottom, right-to-left flow.[^mlreq]

The engine has no EFIGS/Cyrillic/CJK-only language whitelist. It accepts any static font whose shaping is expressible by
the retained OpenType tables and the pinned HarfRust engine, and applications may compose per-language or already
subsetted font assets in one fallback list. Conformance priority covers Latin/EFIGS, Cyrillic, Arabic, Indic, CJK,
Mongolian, and Unicode emoji. A script requiring another global shaper such as AAT or Graphite is rejected rather than
pulling that system into every Wasm artifact.

### Emoji and color-font boundary

Emoji text remains ordinary Unicode prose. Unicode 17 grapheme and line-break data keep RGI modifier, flag, tag, keycap,
variation-selector, and ZWJ sequences intact; HarfRust maps a supported sequence to the font's glyphs, and the normal
fallback list may select an emoji-only font.[^unicode-emoji] No emoji sequence table is copied into each font.

Color artwork never enters the shared shaping SFNT, which continues to exclude `COLR`, `CPAL`, `SVG `, `CBDT`, `CBLC`,
and `sbix`. A separately imported color-bitmap baker consumes the source font and emits an optional `rgba8unorm`, sRGB
bitmap companion with its own selected glyph coverage, strikes, pages, records, hashes, and byte report. The first color
slice accepts OpenType-layout fonts with CBDT/CBLC or `sbix` bitmap glyphs and COLR/CPAL glyphs flattened at bake time;
it does not add AAT `morx` shaping or an SVG runtime. CBDT embeds PNG-backed strikes, `sbix` stores standard bitmap
graphics, and COLR describes layered or paint-graph vector compositions.[^opentype-cbdt] [^opentype-sbix]
[^opentype-colr]

The base branch already implements immutable ordered `FontStack` values and resolves `.notdef` clusters through later
fonts before layout. This stack ports that behavior into Rust and preserves its fixtures; it does not build a second
fallback mechanism. It removes the old raster-homogeneity restriction: every member must belong to the same text runtime,
but each loaded font carries its own technique and resource binding. Fallback remains a shaping decision about glyph
availability, not a renderer eligibility decision.

RGBA8 costs four GPU bytes per texel versus one for the grayscale R8 bitmap path; selected coverage and independently
resident pages are therefore mandatory, and the payload report keeps color pages separate.[^renderer-capabilities]
[^payload-budget] Slug color-paint compilation is not required to ship emoji in this stack; Bitmap is the required color
path. An MSDF or Slug prose font may therefore fall back to an emoji-only Bitmap font without reshaping or changing line
breaks; the render plan partitions the resolved glyphs by their actual technique and resource. No synthetic composite
technique or cross-technique artifact is required.

Exact outline skip-ink is cut because it would undermine the reduced shaping payload—for example, the Noto CJK source
`CFF ` table is 15,458,582 bytes. Static V0 also continues to reject variable-font axis/delta tables (`fvar`, `avar`,
`gvar`, `cvar`, `HVAR`, `VVAR`, and `MVAR`). Variable-font support is not part of this stack; adding it would require a
separate format, size, and runtime admission decision.

### Cut publishing features and cost envelope

“Annotations” does not mean arbitrary comments. It refers to specialized inline typography, principally:

- **ruby:** a second, usually smaller text stream associated with base characters or words—for example Japanese
  furigana, Chinese pronunciation, or an explanatory gloss—placed above/below horizontal text or beside vertical text;
- **emphasis marks:** dots, sesame marks, or another glyph placed beside individual CJK graphemes as typographic
  emphasis; and
- **tate-chu-yoko:** a short horizontal run, commonly two to four date or page-number digits, fitted upright into one
  vertical inline cell.

Ruby would be the large feature. It needs base/annotation pairing, independent shaping, mono/group distribution, overhang and
collision rules, line-break coupling, vertical placement, and potentially multiple annotation levels.[^ruby] A heavily
annotated educational document can approach one annotation glyph per base glyph, so shaping work, semantic glyph state,
and render records can approach 2× before pairing and overhang work. In the current physical schemas, another rendered
glyph represents 48 bytes for Bitmap, 108 bytes for MSDF, or 92 bytes for Slug before backend repacking; incremental
plans pay only for changed records, but an initial retained snapshot pays the live total.

Emphasis marks do not require a nested line breaker, but a fully emphasized range can add one mark primitive per
grapheme and therefore approach 2× primitive packing for that range. Tate-chu-yoko normally adds no characters: it
reshapes and fits a tagged short run as one vertical inline atom. Both belong in the first credible vertical release.

The product scope is therefore:

| Capability                                         | When it is used                                                                                   | Initial scope            | Cost control                                                                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Japanese line-start/end restrictions and tailoring | ordinary Japanese horizontal and vertical prose                                                   | include                  | compact rule/table delta; same line-break vectors plus tailored cases                                                             |
| Tate-chu-yoko                                      | short dates, counters, page numbers, and occasional Latin inside vertical text                    | include                  | bounded tagged runs; no general nested layout                                                                                     |
| Emphasis marks                                     | CJK emphasis where italics are inappropriate                                                      | include with decorations | cached mark shape; one extra primitive only where applied                                                                         |
| Ruby                                               | educational text, names, pronunciation guides, translations, manga, and specialist CJK publishing | cut                      | no base/annotation model or nested shaping stream                                                                                 |
| Warichu                                            | compact Japanese parenthetical notes set as two small lines inside one line                       | cut                      | no nested inline line-layout model                                                                                                |
| Automatic language hyphenation                     | narrow justified columns in language-aware publishing                                             | cut                      | no dictionaries, data-pack ABI, or language hyphenation algorithm; explicit soft hyphens remain                                   |
| Balanced columns                                   | final newspaper, magazine, and page composition                                                   | cut                      | columns fill sequentially; applications may choose region geometry externally                                                     |
| Widow/orphan and keep constraints                  | page/column finalization                                                                          | cut                      | explicit page/column breaks and resume tokens remain                                                                              |
| Automatic footnotes and sidenotes                  | page-coupled notes and scholarly annotations                                                      | cut                      | applications manually compose note text in independent regions; no second text channel or coupled page solver enters the engine   |
| OpenType math layout                               | formulas, stretchy operators, fractions, scripts, and equation structure                          | cut                      | the `MATH` table is not a complete math-layout specification and would require a separate recursive box engine                    |
| Text on a path                                     | labels following arbitrary curves                                                                 | cut                      | no arc-length mapping, tangent placement, curve-aware interaction, or path-decoration system in the core                          |
| OpenType-SVG glyph paint                           | SVG-authored color glyphs and icons                                                               | cut                      | no XML/SVG parser, DOM, scripting, animation, filter, or external-resource runtime; color emoji uses the bounded bitmap companion |

The cut features reserve no runtime tables, optional dictionaries, policy opcodes, semantic records, or implementation
stages. More generally, the core never automatically lays out a second authored text channel beside the selected prose.
Their documented cost explains the boundary; it is not a promise of later delivery. Reintroducing one requires a new
design decision and an independent size/performance admission proposal.

## Render-plan policy

A renderer implementer registers a policy once. The policy is data, not a hot JavaScript callback, so the same request
can be validated, executed in Wasm, and reused natively. Every first-party engine policy declares support for the shipped
Bitmap, MSDF, and Slug techniques; the initial Three policy is the first implementation of that invariant. A third-party
engine policy may declare only the techniques it implements and grow that set independently. Binding a `FontStack`
validates all of its technique IDs against that set, and a resolved glyph or requested paint capability that the selected
program cannot implement fails preparation before publication.

The descriptor includes:

- named independently bindable physical vector streams: scalar type, vector width, alignment, stride, capacity class,
  and usage intent;
- a technique capability table mapping stable technique IDs to program IDs, accepted resource kinds, supported paint and
  compositing features, and physical schemas;
- required semantic inputs and requested derived views;
- a batch-compatibility key assembled from declared resource, technique, material, clipping, depth, and ordering fields;
- backend capabilities such as storage-buffer support, indirect draws, aliasable vector widths, maximum binding sizes,
  and update alignment;
- an upload cost model: preferred coalescing gap, range/call penalty, whole-buffer threshold, and fragmentation budget;
- an allocation strategy chosen from ordered direct storage or stable pooled records with a chunked order/indirection
  buffer; and
- validated augmentations that derive extra fields from semantic records without reimplementing layout.

Augmentation is one versioned, typed, straight-line bytecode. It has semantic-field and constant loads, explicit
resource lookups, deterministic arithmetic and conversion, predicated selection, and physical-field stores. It has no
callback, backward branch, data-dependent loop, memory allocation, arbitrary address, or layout-mutating opcode. The
engine iterates the validated program over four-record SIMD lanes and executes scalar tails. Built-in Bitmap, MSDF, and
Slug policies use the same bytecode and verifier as external policies; a native builder emits that bytecode rather than
bypassing it with a second Rust policy trait.

The compiler-mapped V0 registration ABI uses a 36-byte request header followed by 40-byte capability-set, 56-byte
program, 16-byte physical-buffer, and 16-byte operation records. Capability-set selection is part of program lookup:
an exact set-specific program wins over a set-agnostic program, and an update naming an undeclared set fails before its
revision changes. Capability sets own storage/indirect/aliasing flags, maximum binding and draw limits, update alignment,
and the integer upload-cost model. Programs own the resource-kind mask, semantic-view request, batch-key mask, and one
of the two allocation strategies. Physical streams own explicit alignment, padded stride, usage, and capacity class.
All reserved bits and fields are zero and unknown flags fail registration.

V0 does not alias several logical stores into one mutable interleaved byte span. Augmentation instead combines semantic
fields into independently bindable `vec2`/`vec4` or integer-vector records, including the existing MSDF and Slug
WebGL-compatible packing. This keeps executor borrows disjoint, avoids another aliasing grammar in the native ABI, and
still lets a policy trade buffer count against record width. Adding interleaved field offsets would require a new ABI
version and measured binding-pressure evidence; it is not a latent V0 implementation choice.

Augmentation examples include packing `origin + size` into `vec4`, adding atlas/material indices, emitting selection or
object IDs, quantizing fields, or requesting per-glyph bounds. It may not choose line breaks, mutate cluster order, or
change semantic positions.

## Render-plan IR

The render plan is a revisioned display-list and resource transaction, following the separation used by retained
renderers such as WebRender: rendering intent and resource changes are portable; backend command encoding is not.
[^webrender]

It contains:

- **identity:** ABI, engine revision, plan revision, required base revision, policy/capability hashes, and output
  generation;
- **semantic tables:** optional line, fragment, run, cluster, logical/visual, caret, selection, and inserted-glyph tables;
- **resources:** stable IDs, generations, bounds, creation/update/retirement intent, and technique-specific references;
- **buffers:** stable buffer IDs, schemas, live lengths, capacities, and allocation generations;
- **patches:** allocate/resize, write range, fill, copy/relocate, and retire operations referencing exact payload spans in
  the published Wasm generation;
- **primitives:** ordered glyph, decoration, inline-object, clip, and custom-policy primitive records carrying the
  selected technique, resource, and program identities where applicable;
- **draw packets:** compatible primitive ranges, resource/buffer bindings, ordering tokens, and optional indirect
  argument records; and
- **retirement:** the earliest generation after which resources, slots, and output bytes may be reused.

The initial adapter lowers this IR to Three attributes, TSL storage nodes, and draws. The same graph runs through
Three's WebGPU backend and forced WebGL2 backend. In Three 0.185.1, WebGL PBO setup replaces the supplied typed array with
a power-of-two-padded retained array and a `DataTexture`; the adapter therefore performs one explicit copy into that
retained array and applies later patches to it. WebGPU may consume re-pinned Wasm views where Three preserves them.
Bitmap uses `vec2`/`vec4` records and MSDF and Slug use `vec4`/`uvec4` records, all valid in the fallback. A minimal native
consumer proves schema, patch, revision, and retirement semantics without claiming another renderer integration.

The V0 wire checkpoint uses a 144-byte, 16-byte-aligned result header followed by compiler-mapped little-endian tables:
44-byte semantic, 40-byte resource, 36-byte physical-buffer, 36-byte patch, 64-byte primitive, 48-byte draw, 24-byte
retirement, and 24-byte diagnostic records. Resource kind and create/update/retain action are separate. Buffer strategy
is an explicit ordered-direct or stable-indirect tag. Variable patch payload bytes are part of the same immutable
publication; write patches rebase their checked payload span to an absolute result offset. Other patch opcodes carry no
payload address. The header identifies the registered policy by handle and deterministic fingerprint. This fixes a
portable display-list/resource-transaction grammar; it does not expose Rust layout, padding, or native-endian struct
copies to consumers.

### Minimal updates

“Minimal” is policy-relative and measured. The objective includes bytes scanned, bytes rewritten, upload bytes, upload
calls, draw packets, memory overhead, fragmentation, and CPU/GPU time. Minimizing only dirty-byte count can lose when it
creates hundreds of tiny `queue.writeBuffer` calls.

The policy chooses one of two initial allocation strategies:

1. **Ordered direct records:** lowest shader and draw complexity; insertion can move the ordered suffix.
2. **Stable record pool plus chunked order/indirection:** local record patches and bounded order-chunk updates at the
   cost of one indexed lookup. The Three/TSL policy implements the lookup over storage records on both WebGPU and the
   WebGL PBO fallback.

There is no third segmented-record mode in this stack. Chunking belongs to the stable-indirect order representation,
and its draw-packet boundaries are part of that one strategy rather than another allocator and policy surface.

The engine assigns stable instance identities where shaped semantics remain equivalent across revisions. Invalidation
starts from edited text/style/flow dependencies, not from rewriting every live record and diffing all bytes afterward.
Patches are aligned and coalesced according to the registered backend cost model. Tests cover insertion, deletion,
replacement, style edits, and flow changes at the start, middle, and end of large retained paragraphs.

If `required_base_revision` does not match the consumer, the engine returns a checkpoint containing complete live state.
Skipped render revisions can never be repaired by applying an adjacent delta blindly.

The first retained compiler slice implements ordered-direct physical storage behind an explicit prepare/view/commit-or-
abort lifecycle. Stable instance IDs and semantic content revisions—not physical byte comparison—select dirty records.
Capability alignment expands ranges at record granularity; gap/call costs, fragmentation budget, and the whole-buffer
threshold coalesce them. Consecutive changed inputs stay batched through the four-record SIMD policy executor. A no-op
produces no resource, buffer, patch, retirement, or payload records; a tail deletion changes live metadata without an
upload; a middle insertion rewrites only that resource/program batch's suffix. Checkpoint/growth allocates and writes
complete aligned storage. CPU mirrors change only on commit, so failed A/B serialization can abort preparation.

This slice deliberately does not yet claim a complete display list: primitive/draw compilation, stable-indirect order
storage, session integration, and target-hardware timing remain open in Stage 2. Its production Wasm code is currently
unreachable from `text_update` and is removed by LTO; that keeps the shipping path unchanged while the missing tables
land, rather than treating native unit behavior as end-to-end evidence.

## Performance contract

Text does not own an 8.33 ms frame. The hard warm-update ceiling is p95 < 4.0 ms from mutation submission through a
validated plan ready for renderer lowering, including any required Wasm-to-transfer-buffer copy. The design target is
p95 ≤ 1.0 ms for localized edits and retained constraint changes that converge within the requested viewport. Renderer
lowering and CPU-side upload submission are reported separately and must also fit the application's total 4 ms UI
budget; neither target is justified by a best-case median.

The benchmark reports phases and retained-output costs separately:

- Unicode/style invalidation, shaping, composition, positioning, semantic geometry, plan compilation;
- bytes scanned, rewritten, published, copied by the adapter, and submitted to the GPU;
- patch count, upload call count, draw-packet count, allocations, memory growth, and output-generation pressure; and
- scalar-oracle versus SIMD-kernel time on the same data and output contract; and
- root/worker ownership transitions, transfer-buffer pool hits, copies, transferred bytes, returns, and backpressure.

At minimum, benchmark these deterministic workloads:

- the existing 25,515-glyph fully visible cold, font-size, width, and text-edit cases;
- localized insert/delete/replace/style edits at paragraph start, middle, and end;
- 100,000 retained glyphs with a bounded visible window and convergence after a local edit;
- mixed-direction Arabic/Latin, Indic shaping, CJK horizontal and vertical layout;
- decorations and word/letter spacing;
- multi-column flow with exclusions and an inline object; and
- renderer policies for ordered, indirect, and segmented storage on supported backends.

No-op frames do no Wasm work. After warm capacity is established, primary warm cases perform zero allocator calls and
zero memory growth. The fully visible 25,515-glyph font-size, width, and text-edit lanes and the retained/windowed
100,000-glyph localized-edit lane must all remain below the 4 ms p95 ceiling. The 1 ms target is reported for every lane
and is a required design objective, but it does not become an asserted result until measured. Cold initialization and
genuinely document-wide structural changes are reported separately with allocation, growth, and tail-latency evidence.

### Realtime feature admission

No finite implementation can guarantee a frame time for unbounded text or geometry. The product guarantee is therefore
defined over explicit input and work bounds selected from the Stage 0 measurements. Each request caps regions, lines,
clusters, exclusions per region, slots per band, policy operations, semantic-output bytes, patch bytes, and total output
bytes. Exceeding a cap produces a valid partial plan, an overflow reason, and a resume cursor; it never starts an
unbounded recovery or silently changes typography. The previous complete revision remains renderable until its
replacement is complete.

A realtime feature must satisfy all of these:

- its work is linear or better in invalidated/visible chunks, emitted fragments, or another explicitly capped input;
- it performs no nested layout, global optimization, unbounded backtracking, runtime dictionary loading, outline-curve
  intersection, arbitrary host callback, or convergence loop without a deterministic iteration cap;
- its warm path performs zero allocations and memory growth at the admitted capacity;
- expensive semantic views are absent unless requested; and
- its isolated and combined worst-case corpora remain under p95 4 ms, with p95 1 ms as the design target.

The admitted feature candidates are horizontal and vertical shaping, Unicode breaking, word/letter spacing,
underline/overline/line-through, bounded ink-box skipping, tate-chu-yoko with a short-run cap, emphasis marks, bounded
exclusions and inline objects, and bounded sequential-region flow. A candidate that misses the budget is narrowed or
cut; architectural generality is not a reason to ship it.

## SIMD-shaped engine design

SIMD is part of the storage and algorithm design, not a loop replacement at the end. The scalar implementation remains
an exact oracle and tail path, but production data structures must make contiguous lanes available from the first Rust
milestone.

### Data layout

- Store hot glyph and cluster fields as 16-byte-aligned SoA arrays: glyph IDs, clusters, design-unit advances and
  offsets, style/font slots, bidi levels, break flags, and stable identities. Physical render records remain
  policy-directed AoS/SoA outputs.
- Partition retained text into fixed-capacity chunks whose live capacity is a multiple of 16 clusters. The Stage 0
  packet compares 32-, 64-, and 128-cluster chunks; the chosen size is then an ABI-private invariant.
- Give each chunk summaries needed to skip it without visiting every cluster: total advance by uniform scale run,
  required/safe/allowed break masks, first/last candidate positions, bidi transition mask, text range, and revision.
- Retain HarfRust's `i32` design-unit advances and offsets until scaling is required. Do not eagerly convert the whole
  paragraph to `f64` arrays. Cluster grouping is performed once while HarfRust output is already monotone within a run.
- Reuse HarfRust `GlyphBuffer::clear()` allocations, UTF decoding buffers, feature records, run tables, line cursors,
  patch builders, policy VM registers, and both Wasm output arenas. Clearing live lengths must not drop capacities.
- Use slabs or generational arenas for variable-count lines, fragments, decorations, and inline objects. No object or
  hash-map entry is allocated per glyph or cluster in a warm update.

### Kernel map

| Kernel                            | Lane shape                                 | Planned treatment                                                                                      |
| --------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Built-in Bitmap/MSDF/Slug packing | four independent `f32`/`u32` records       | explicit four-lane load/transform/store; strongest first admission candidate                           |
| Declarative policy transforms     | four independent semantic records          | vector bytecode/graph execution so dispatch is amortized across four records                           |
| Bidi-level transitions            | sixteen `u8` levels                        | compare shifted contiguous levels and extract a bitmask                                                |
| Break and cluster flags           | sixteen `u8` flags                         | vector masks plus `bitmask`/trailing-zero candidate selection                                          |
| Patch verification/coalescing     | sixteen bytes or four words                | `v128` compare on already invalidated spans; never scan the whole live buffer as the primary algorithm |
| Glyph-to-cluster aggregation      | repeated cluster IDs and scatter writes    | reshape once into cluster-contiguous runs; core Wasm SIMD has no gather/scatter instruction            |
| Line-width search                 | chunk summaries plus ordered boundary scan | skip summary blocks; preserve scalar addition order at the exact width boundary                        |
| Decoration bounds/packing         | four independent segments                  | vectorize bounds and physical packing after line fragmentation is fixed                                |

Line-breaking correctness forbids changing floating-point association. Core WebAssembly SIMD provides deterministic
`v128` integer and float operations, but relaxed-SIMD operations permit implementation-dependent results and are not
used.[^wasm-simd] Exact integer scans are preferred; ordered `f64` accumulation remains scalar where changing order
could move a break. Both oracle and production paths narrow only when writing a declared lower-precision render field.

Rust 1.97's `core::simd` remains nightly-only. Wasm kernels therefore use stable `core::arch::wasm32` intrinsics with
`simd128`; native kernels use target-specific intrinsics behind the same chunk/kernel interface.[^rust-simd] The kernel
interface has compile-time SIMD and scalar backends, selected by one checked build feature; exactly one backend is
linked into an artifact. The standard Web artifact enables SIMD. The scalar backend is the differential oracle and
tail implementation and also keeps a same-ABI, no-SIMD compatibility artifact buildable without maintaining a second
semantic engine. That artifact is not published or selected at runtime until concrete consumer demand justifies it.

### Up-front viability packet

Before the semantic port chooses its retained structs, build a test-only kernel lab over captured arrays from the real
25,515- and 100,000-glyph workloads. It compares the same data layout under scalar, compiler-generated, and explicit
SIMD kernels for packing, flag scanning, chunk summaries, boundary search, and policy execution in Node, Chromium, and
representative native targets.

The packet must:

- prove exact semantic and byte output, including mixed direction, vertical data, partial chunks, and unaligned request
  offsets;
- inspect the optimized Wasm to prove the intended vector instructions survive Binaryen;
- record p50/p95/p99, instructions or phase time where available, warm allocations, memory growth, raw/Brotli bytes,
  and end-to-end contribution;
- demonstrate zero warm allocation and growth for the tested kernels; and
- select chunk size, alignment, summary layout, policy execution shape, and browser capability baseline before those
  types become production API.

A kernel is admitted when it improves its phase p95 by at least 20% and either improves the complete hot update by at
least 5% or removes enough latency/allocations to meet the 1/4 ms budgets, without regressing another primary workload
by more than 2%. Its production Brotli delta is capped at the smaller of 12 KiB or 5% of the engine module unless a
separate decision records stronger end-to-end evidence. These thresholds intentionally reject the repository's prior
MTSDF pattern of double-digit code growth for low-single-digit bounded gains.

The first packet checkpoint selects 64-cluster, 16-byte-aligned SoA storage. Across real 25,515- and 100,602-glyph
arrays, scalar, compiler-vectorized, and selected hybrid artifacts produced identical horizontal, vertical, partial-tail,
and four-byte-aligned output hashes in Node 24.18.0 and Chromium 149 without warm allocation or memory growth. Compiler
vectorization, not hand-written shuffles, owns straight-line record packing. Explicit `i8x16` break/bidi masks and
integer-exact `i64x2` summaries exceeded the 20% phase threshold; 64-cluster summaries won the large workload against
32 and 128. The production policy executor resolves output-buffer indices at registration, preflights all semantic SoA
inputs and physical outputs before writing, and dispatches validated straight-line bytecode over four records per SIMD
iteration with scalar tails. Its representative 17-operation program over 25,515 glyphs measured 1.174→0.428 ms p95
in Node and 1.113→0.438 ms in Chromium; compiler auto-vectorization remained within scalar variance. All three artifacts
produced the same output bytes. The selected lab artifact now adds 4,185 raw / 1,096 Brotli bytes over scalar, while the
standard production `+simd128` build is 530 raw bytes smaller and 62 Brotli bytes larger than its same-ABI scalar
release-valve build. The optimized disassembly contains the intended vector loads, stores, arithmetic, comparisons,
bitmasks, shuffles, and integer lanes. Boundary search, representative native SIMD, and end-to-end contribution remain
open parts of the packet because their production stages do not exist yet; they are not inferred from these admitted
kernels.

## Implementation stack

Each stage is a small Conventional Commit series with unchanged fixtures and an independently reviewable invariant.
The first stack proves the Wasm boundary, policy, display-list/render-plan contract, and complete current Rust semantic
pipeline before adding new publishing features. The single ABI is its final cutover, not its first commit.

### Foundation stack — Wasm, policy, render plan, and complete current semantics

### Stage 0 — contracts and measurement

- record the accepted architecture in the decision register and update the affected package concepts;
- define the binary schema, revisions, A/B publication and transferable-buffer ownership state machines, semantic
  tables, and render-plan IR;
- add phase, patch, upload, allocation, and generation-pressure instrumentation;
- add edit-locality, vertical, decoration, spacing, exclusion, and bounded-region benchmark fixtures without changing
  goldens;
- execute the up-front SIMD viability packet and select chunk, alignment, summary, and policy-execution layouts;
- add reproducible `simd` and `scalar` artifact builds with identical schemas and ABI, make SIMD the standard package,
  and test that an artifact contains only its selected kernel backend; and
- set the measured hard caps for clusters, lines, exclusions, slots, regions, policy operations, and output bytes.

### Stage 1 — engine shell, frame ABI, and retained ownership

- separate renderer-neutral Rust core from the Wasm transport;
- implement validated mutation transactions, stable revisions, request reservation, A/B Wasm publication, worker-owned
  transferable buffers, root retirement, and deterministic partial/resume results behind a test-only entry point;
- add aligned retained chunks, packed flags, chunk summaries, generational arenas, and zero-allocation warm scratch;
- test growth, detachment, malformed requests, failed updates, skipped revisions, detached-buffer misuse, missing returns,
  bounded-pool backpressure, and worker-side collection; and
- keep the shipping hot path unchanged while the Rust dependency chain is incomplete.

### Stage 2 — policy and retained render-plan proof

- land the typed straight-line policy bytecode and semantic/resource/buffer/patch/primitive/draw IR;
- compile captured current semantic fixtures into stable instance identities, ordered-direct or stable-indirect storage,
  invalidation-directed dirty patches, and capability-shaped draw packets;
- prove built-in Bitmap, MSDF, and Slug policies through scalar kernels before adding SIMD;
- lower the same plan through the one Three/TSL adapter on WebGPU and forced WebGL2 plus a minimal native consumer; and
- prove ordered MSDF-to-Slug and MSDF/Slug-to-Bitmap fallback, per-technique buffers and patches, atomic multi-program
  publication, the first-party policy accepting all three built-ins, and a restricted third-party policy rejecting an
  unsupported stack before rendering.

### Stage 3 — complete current shaping and layout in Rust

- port Unicode 17 grapheme and line-break analysis, bidi orchestration, style itemization, the existing ordered
  `FontStack` fallback semantics while removing its raster-homogeneity constraint, shaping-run construction, cluster
  measurement, horizontal line composition, reordering, positioning, alignment, justification, and existing overflow
  behavior;
- write semantic results directly into the retained plan compiler rather than returning shaped glyph arrays to
  TypeScript;
- retain the TypeScript engine temporarily only as a differential test oracle on deterministic fixtures;
- use the unchanged official Unicode vectors, fallback fixtures, mixed-direction goldens, and packed-consumer bytes; and
- implement only SIMD kernels admitted by the Stage 0 scalar-versus-SIMD evidence, with scalar paths and tails kept
  test-visible.

### Stage 4 — atomic cutover and foundation performance gate

- cut the public hot path to one `text_update` call after byte and semantic parity is established;
- remove TypeScript shaping and layout orchestration and the old analysis/shape/reshape exports together;
- apply retained patches through both Three/TSL backends, including WebGL2's required retained PBO copy; and
- pass the complete 25,515-glyph target-hardware gate before any additional publishing feature enters the stack.

### Following stacks — publishing features on the proven foundation

### Stage 5 — spacing, decorations, and interaction

- implement word- and letter-spacing semantics, tabs/indents, inserted hyphens, script-aware justification, and hanging
  punctuation;
- bake and consume underline/strike/vertical/baseline metrics;
- emit underline, overline, line-through, hit-test, caret, selection, and accessibility geometry; and
- verify direction changes, ligature boundaries, fallback fonts, line fragmentation, and vertical decoration orientation.

### Stage 6 — editorial and vertical layout

- implement axis-neutral horizontal/vertical composition and text orientation;
- add Japanese line tailoring, bounded tate-chu-yoko, emphasis marks, regions, exclusion subtraction, multiple inline
  slots, inline objects, drop caps, explicit breaks, and sequential fill;
- add retained cursor/resume/convergence behavior and safe narrowed reshaping at line boundaries; and
- resolve every declared region and exclusion in the same update call, flowing sequentially into at least a second
  fixed region without balancing or a host measurement round trip.

### Stage 7 — emoji color raster and integration cleanup

- add the optional Bitmap color companion and selected-page accounting without changing shaping-data size;
- verify emoji-only Bitmap fallback from MSDF and Slug prose through the heterogeneous `FontStack` contract;
- remove the differential TypeScript implementation after all gates pass;
- update roadmap, package concepts, decision register, and API reference; and
- finish with package checks, repository checks, benchmarks, browser conformance, and a clean worktree.

## Hard gates for every implementation stage

- never regenerate a golden or official Unicode fixture to accept a behavior change;
- `mise exec -- pnpm --filter @pmndrs/text test` remains 190 passing, 0 failing;
- `mise exec -- pnpm --filter @pmndrs/text check` passes lint, format, types, and tests;
- the benchmark application's 117 tests and 20 headless conformance cases pass;
- the mixed-direction Amiri golden and packed-consumer contract remain exact until an explicitly versioned render-plan
  contract replaces the latter;
- `text:layout-benchmark -- --glyphs 22000` reports both baseline and candidate tables at every stage;
- Unicode segmentation and line breaking pass the repository's unchanged official vectors;
- scalar and SIMD paths produce identical declared output bytes; and
- each adapter proves patch application from the stated base revision and checkpoint recovery after a skipped revision.

## Resolved product direction

- Render-plan policies are validated declarative bytecode built through typed host/native builders; no arbitrary
  JavaScript packing callback or second native policy implementation executes in the hot path.
- Loaded fonts own technique and resource binding. User-facing `FontStack`, Three `Text`, and `TextGroup` carry no
  separately authored technique; every first-party engine policy supports Bitmap, MSDF, and Slug, while third-party
  policies may declare and safely enforce a subset.
- Ruby, warichu, automatic language hyphenation and dictionaries, balanced columns, and widow/orphan/keep solvers are
  cut from the product scope. They reserve no base-runtime code or data.
- The hard warm-update ceiling is p95 < 4 ms on both the fully visible 25,515-glyph lanes and the 100,000-glyph
  retained/windowed localized-edit lane. The design target is p95 ≤ 1 ms.
- Sequential multi-region overflow is required, resolves all declared regions and exclusions in one update, and does
  not balance columns. Partial/resume remains only the explicit response to a declared out-of-envelope request.
- The standard Web artifact requires `simd128`. This excludes Safari before 16.4, Chromium before 91, Firefox before
  89 on x86/x64 or 90 on arm64, and Firefox on arm32/mips64.[^safari-simd] [^chrome-simd] [^firefox-simd] Initialization
  reports a typed unsupported-capability error when module validation fails; it does not user-agent sniff or silently
  load another module.
- A checked build-time feature can produce a schema- and ABI-identical scalar artifact from the same engine and kernel
  interface. It is retained as a release valve and published only when an actual consumer requires the older browser
  tail; SIMD remains the default build and package.

[^css-text]:
    [CSS Text Level 4](https://www.w3.org/TR/css-text-4/) defines the relevant spacing, hanging-punctuation,
    and justification concepts. The engine API need not duplicate CSS syntax.

[^harfbuzz]:
    [HarfBuzz buffer flags](https://harfbuzz.github.io/harfbuzz-hb-buffer.html) define safe-to-insert and
    unsafe-to-concatenate boundaries used for narrowed reshaping.

[^safari-simd]:
    [WebKit's Safari 16.4 release notes](https://webkit.org/blog/13966/webkit-features-in-safari-16-4/)
    record the addition of WebAssembly 128-bit SIMD.

[^chrome-simd]:
    [The Chromium 91 release announcement](https://blog.chromium.org/2021/04/chrome-91-handwriting-recognition-webxr.html)
    records WebAssembly SIMD becoming enabled by default.

[^firefox-simd]:
    [Mozilla's WebAssembly SIMD shipping record](https://bugzilla.mozilla.org/show_bug.cgi?id=1625130)
    records Firefox 89 for x86/x64, Firefox 90 for arm64, and no planned arm32 or mips64 implementation.

[^icu4x]:
    [`icu_segmenter` documentation](https://docs.rs/icu_segmenter/latest/icu_segmenter/) currently documents
    Unicode 15.1 line-break data, so it cannot replace this repository's Unicode 17 gate without new evidence.

[^jlreq]:
    [JLREQ](https://www.w3.org/TR/jlreq/) documents Japanese vertical composition, punctuation, ruby, emphasis,
    and line-start/end restrictions.

[^parley]:
    [Parley layout](https://docs.rs/parley/latest/parley/layout/) demonstrates retained rich-text layout,
    decorations, cursor/selection data, and line-breaking iteration in a current Rust implementation.

[^pretext]:
    [Pretext](https://github.com/chenglou/pretext) demonstrates a prepared text object advanced by a cursor and
    a different width for each line; its Canvas measurement model is not adopted here.

[^ruby]:
    [CSS Ruby Annotation Layout Level 1](https://www.w3.org/TR/css-ruby-1/) defines base/annotation pairing,
    levels, positioning, merging, and distribution that make ruby a coupled second layout stream.

[^rust-simd]:
    [Rust's stable `wasm32` architecture documentation](https://doc.rust-lang.org/core/arch/wasm32/index.html)
    documents `simd128` intrinsics, compilation requirements, and the lack of in-module runtime feature detection.

[^staging]:
    [`wgpu::util::StagingBelt`](https://docs.rs/wgpu/latest/wgpu/util/struct.StagingBelt.html) is an example of
    renderer-owned reuse for many buffer writes; it is separate from Wasm result publication.

[^text-decoration]:
    [CSS Text Decoration Level 4](https://www.w3.org/TR/css-text-decor-4/) defines the decoration
    dimensions and skip behavior used as the semantic reference.

[^webrender]:
    [Firefox's rendering overview](https://firefox-source-docs.mozilla.org/gfx/RenderingOverview.html)
    separates retained display-list intent from renderer-specific scene building and submission.

[^wasm-simd]:
    [The WebAssembly core specification](https://webassembly.github.io/spec/core/) defines fixed-width
    `v128` operations and records that relaxed operations may have implementation-dependent results.

[^worker-transfer]:
    [The HTML Worker model](https://html.spec.whatwg.org/multipage/workers.html) defines worker
    `postMessage` transfer lists used to move `ArrayBuffer` ownership between worker and root.

[^writing-modes]:
    [CSS Writing Modes Level 4](https://www.w3.org/TR/css-writing-modes-4/) defines logical inline/block
    directions and distinguishes writing mode from glyph orientation.
