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
- Each program owns an explicit typed gather recipe. Ordered 4-byte records name `semantic`, `glyph`, `resource`, or
  `strike` source lanes for every F32 field followed by every U32 field. This is numeric policy data, not a callback;
  registration validates and fingerprints it so retained input meanings cannot change under one handle. The per-font
  render binding owns the latter three lane families and layout owns semantic lanes. Both policy and binding
  registration are live, while gather execution waits for the Rust layout connection and therefore has no frame timing
  claim yet.
- A loaded font owns its raster technique and resource binding. `FontStack`, `Text`, and `TextGroup` do not ask the user
  to repeat a technique: an ordered stack may contain fonts from different techniques in the same runtime, and the
  render policy declares which of those techniques its engine can lower.

Per-font render data is normalized without paying for a union of every built-in technique's fields. One immutable
binding owns a technique/program variant, a dense font-wide glyph table, one or more strikes, a dense strike×glyph
address table, and a resource directory. MSDF and Slug use one scalable strike identified by zero ppem; Bitmap uses
strictly increasing physical ppem strikes and selects the nearest to `fontSize × rasterPixelRatio`, retaining the lower
strike at an exact tie. Every strike×glyph row selects a resource or carries the missing sentinel. Glyph, selected-strike,
and selected-resource F32/U32 data are field-major SoA tables with at most 32 lanes per scalar kind, so four neighboring
glyphs remain directly gatherable by the policy executor. The cold compiler-mapped decoder rejects noncanonical strikes,
unsorted/invalid resources, nonfinite floats, invalid indices, field-shape mismatch, reserved data, overlap, and shaping
glyph-count mismatch before publication.

The gather is one engine-global reusable workspace rather than one table per program or paragraph. For each glyph, its
selected program's ordered source recipe fills the same `0..N` F32/U32 field slots; the plan compilers already group
execution by program, so no union schema is required. Each typed lane is stored as contiguous four-record blocks with
16-byte alignment and a scalar tail. The 32,768-entry 60-byte internal `PlanGlyph` arena is policy-independent and is
reserved by module `initialize()`. Policy registration reserves only the maximum F32/U32 lane counts declared by that
policy, each to the same record capacity. The production empty-frame path now passes through this gather before plan
compilation; a Rust proof gathers all four source scopes into a nonempty ordered plan and asserts exact packed bytes.
Nonempty shaping/layout frame input is still open and no end-to-end timing is inferred from the synthetic proof.

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

The V0 compiler-mapped section records are 24-byte ordered UTF-16 replacements, 88-byte stable style upserts/removals,
52-byte flow constraints, 8-byte inline/block vertices, 56-byte regions, 48-byte exclusions, and 56-byte inline
objects. UTF-16 payload preserves the public cluster coordinate without a host UTF-8 conversion. Styles carry current
shaping fields plus word spacing, baseline shift, material, color, and decoration inputs; checked language and feature
payloads are offset-addressed. Constraint records carry the complete region range, viewport, and resume cursor for the
call. Rectangle bounds are inline; bounded polygons reference vertex records in the same request. Defining this wire
grammar does not make a section valid until its Rust decoder and retained transaction land.

The retained style transaction uses two flat pre-reserved arenas per session rather than allocating a language or
feature vector per span. Stable IDs drive an allocation-reusing mutation merge; authored cascade order remains a
separate value used to validate nesting and later resolve inheritance. Payload compaction happens while building the
inactive arena, so replacing a style cannot accumulate dead language or feature bytes. Root target density is retained
for bitmap strike selection but rejected on non-root spans. Commit is an arena swap and abort does not touch committed
styles.

Resolution is a separate derived A/B arena. One sweep of the validated containment order keeps the fully resolved parent
on a pre-reserved stack, applies only the fields stated by each opening scope, emits maximal segments at start/end
boundaries, and coalesces equal neighbors. Language and OpenType-feature values remain references into the compact
retained style arena. A root states font stack, logical size, and target density; absent line height deliberately means
natural font metrics rather than a fabricated multiplier.

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
text_reserve(
  session_id: u32,
  request_capacity: u32,
  result_capacity: u32,
  text_capacity: u32
) -> u32
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

Cold capacity separates retained per-session state from shared synchronous scratch. Session creation prewarms both
UTF-16 transaction buffers and the active/pending Unicode, bidi, shaping-run, shaped-glyph, and fallback arrays to 1,024
UTF-16 units unless the caller supplies a larger text capacity; shaped-glyph capacity begins at twice that value. Cold
reserve can grow them before the request view is pinned, and committed high-water capacity is reused. Retained A/B state
cannot be one engine-global workspace because more than one live session must preserve its committed result. HarfRust's
consumed-and-returned shaping buffer and policy gather are module-global scratch reused by synchronous updates; those
scratch arrays prewarm once to 32,768 entries, covering the 25,515-glyph target fixture. A warm update inside declared
capacities may not lazily settle another allocation.

Module initialization is explicit rather than an incidental side effect of the first operational export. The generated
ABI publishes `initialize()`, and the standard host calls it immediately after `WebAssembly.instantiate`; this eagerly
creates module-owned state before a font registration, session operation, or update can be observed. At the current
checkpoint it creates module state, reserves the 32,768-entry render-plan gather arena, reserves HarfRust's actual
32,768-codepoint internal info/position buffer, and reserves one 32,768-codepoint UTF-16 context scratch array. HarfRust
consumes that buffer by value and returns the same allocation through `GlyphBuffer::clear`; the registry restores it
after every successful segment and every fallible setup path instead of constructing a fresh buffer per segment.
Initialization grows the optimized module from 1,245,184 to 4,980,736 linear-memory bytes (57 pages), of which 25 pages
are the HarfRust/context addition, and repeated initialization preserves byte length and `memory.buffer` identity.
Policy-specific aligned field lanes settle at cold policy registration. The legacy exported batch-result vectors still
settle independently and are not evidence for the new frame path. Retained Unicode, bidi, shaping-run, shaped-glyph, and
fallback arrays now settle at session creation/reservation; line composition and geometry-output arrays have not landed
and are not included in the zero-allocation frame claim.

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

The frame engine now owns that exact Unicode 17 answer. A generator resolves the pinned `@cto.af/linebreak` 4.0.3
property trie and the punctuation, East Asian, and future-emoji properties used by its rules into one compact Rust scalar
partition. The `no_std` evaluator ports the same UAX #14 rule order into reusable scalar/break arrays, preserves the
upstream MIT notice, reports canonical UTF-16 offsets, and passes all 19,338 cases in the repository's unchanged official
`LineBreakTest` fixture. TypeScript opportunities are no longer an input to Rust layout.

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

The Rust engine cold-registers stack identity as a nonempty, duplicate-free ordered list of already registered
shaping-font handles. Equivalent registration is idempotent; conflicting order fails, and a member font cannot be
disposed while any registered stack retains it. Technique/resource data is deliberately not duplicated in the stack.
During `text_update`, HarfRust output is collapsed to logical cluster records; only clusters containing an actual glyph
zero advance to the next registered font. Flat source-ordered spans are reshaped at most once per stack depth and then
retained with the final shaped SoA. Sorting by source-run/cluster restores logical order for RTL output before one linear
span merge. A compiled Inter-to-Noto-Devanagari test observes two plan constructions in the same update, proving the
primary `.notdef` pass and fallback pass both ran. Stack lifecycle is cold and cardinality is normally small, so the
selected registry uses a compact vector. A generic tree map measured 837,865 raw / 312,057 gzip / 246,478 Brotli bytes;
removing that monomorphization reduced the artifact to 828,401 / 309,252 / 244,402 without changing the ABI or lookup
result.

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
- separate storage and draw compatibility keys assembled from declared resource, technique, material, clipping, depth,
  and ordering fields;
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
and the integer upload-cost model. Programs own the resource-kind mask, semantic-view request, storage-key mask, draw-key
mask, and one of the two allocation strategies. Physical streams own explicit alignment, padded stride, usage, and
capacity class.
All reserved bits and fields are zero and unknown flags fail registration.

V0 does not alias several logical stores into one mutable interleaved byte span. Augmentation instead combines semantic
fields into independently bindable `vec2`/`vec4` or integer-vector records, including the existing MSDF and Slug
WebGL-compatible packing. This keeps executor borrows disjoint, avoids another aliasing grammar in the native ABI, and
still lets a policy trade buffer count against record width. Adding interleaved field offsets would require a new ABI
version and measured binding-pressure evidence; it is not a latent V0 implementation choice.

Augmentation examples include packing `origin + size` into `vec4`, adding atlas/material indices, emitting selection or
object IDs, quantizing fields, or requesting per-glyph bounds. It may not choose line breaks, mutate cluster order, or
change semantic positions.

The policy program is the only bytecode in this design. It is a validated, forward-only packing expression executed by
Rust while compiling physical records; it has no loop, backward branch, arbitrary address, allocator, host callback, or
layout/shaping authority. The render plan below is fixed-record data, not executable bytecode.

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
44-byte semantic, 40-byte resource, 36-byte physical-buffer, 36-byte patch, 64-byte primitive, 64-byte draw, 24-byte
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

The retained ordered-direct compiler implements physical storage behind an explicit prepare/view/commit-or-abort
lifecycle. Stable instance IDs and semantic content revisions—not physical byte comparison—select dirty records.
Capability alignment expands ranges at record granularity; gap/call costs, fragmentation budget, and the whole-buffer
threshold coalesce them. Consecutive changed inputs stay batched through the four-record SIMD policy executor. A no-op
produces no resource, buffer, patch, retirement, or payload records; a tail deletion changes live metadata without an
upload; a middle insertion rewrites only that resource/program batch's suffix. Checkpoint/growth allocates and writes
complete aligned storage. CPU mirrors change only on commit, so failed A/B serialization can abort preparation. A dirty
transaction republishes the complete compact binding and command tables while its fat physical payload stays delta-
minimal. Glyph primitives are spans over consecutive physical records, split by logical run, binding identity, or the
65,535-record wire limit; this avoids publishing one 64-byte command per glyph. Draw packets carry numeric material,
clip, and depth identities plus exact resource/buffer table ranges. No-op preparation publishes no table or payload.

Storage and draw compatibility are deliberately independent. The standard shared-storage policy puts material in the
draw key but not the storage key, so different materials reference ranges in the same physical glyph buffers. A policy
may put material in both keys when a fallback or custom per-material schema requires separate physical buffers. This is
not left to the adapter after publication: focused tests prove both plans. The distinction matters for the pinned Three
implementation because its ordinary WebGPU and WebGL fallback render-object paths both submit `firstInstance = 0`; a
shared-buffer adapter must supply an explicit storage index base, while a partitioned policy avoids that requirement.

Interleaved `A, A, B, A` resource tests prove three ordered spans over two deduplicated resources and buffers, and both
allocation strategies pass wire validation. Stable-indirect compiles persistent physical slots plus 64-entry `u32`
order chunks under the same transactional prepare/view/commit-or-abort lifecycle. Each physical buffer identifies its
order buffer; that buffer uses the compiler-generated reserved binding ID 65,535. A localized insertion in the focused
one-stream fixture writes one new 4-byte physical record and one 16-byte order range, while arbitrary reorder writes
only order bytes. Deleted slots and chunks stay in publication-fence quarantine until acknowledged. The registered
fragmentation budget bounds accumulated draw spans: when an edit would exceed it, Rust rebases only the order buffer to
dense chunks, increments and retires that buffer generation, and preserves the physical glyph-buffer generation.
Order-buffer growth likewise republishes every live chunk because a replacement allocation cannot assume prior bytes.
No-op, abort, mixed-resource order, shared/partitioned material storage, fence-gated reuse, fragmentation rebasing, and
settled nested scratch capacities have focused tests. One frame may contain programs using both allocation strategies:
the dispatcher filters the same borrowed glyph and semantic-field slices in each compiler instead of allocating copied
partitions, assigns ordered-direct buffers to the low `u32` ID half and stable-indirect buffers to the high half, rebases
patch payload spans, deduplicates shared resources, and merges draws by their original global order token. A program may
therefore change allocation strategy without retiring a resource that remains live through the other compiler. A
homogeneous frame delegates its plan view directly to one compiler and does not populate merge scratch; a mixed no-op
publishes nothing, and repeated same-shape mixed edits retain settled vector capacities.

Each engine session now owns that dispatcher and pins the first committed policy handle/fingerprint while allowing
capability-set changes within the same validated policy. The compiler-derived update header is 124 bytes and carries a
dedicated `acknowledged_publication_generation`; it must advance monotonically and cannot name the publication currently
being prepared. `consumed_plan_revision` remains independent because host application does not prove GPU completion.
The Wasm update prepares the Rust plan, validates and serializes it into the inactive arena, commits compiler/session
state only after staging succeeds, and aborts preparation on every intervening failure. The acknowledgment itself
survives an aborted publication because it reports an already-completed renderer fence. Compiled-Wasm tests exercise
accepted and future acknowledgments plus A/B preservation. Host tests exercise compiler abort/retry directly. A
post-prepare Wasm failure is not constructible while the encoded plan is the minimum-size header; that ABI ordering
requires a regression test once Rust shaping/layout can produce nonempty plan output that exceeds a request limit.

This makes the full retained plan compiler reachable: the optimized artifact changes from 739,909 / 272,624 / 214,395
to 822,443 / 308,033 / 242,447 raw/gzip/Brotli bytes. The 82,534 raw / 35,409 gzip / 28,052 Brotli increase is shared
runtime code, not font-local shaping data, and is now an explicit size-optimization target. Ordered UTF-16 text
replacements now decode as borrowed records and commit into retained session scratch transactionally. Constraints,
regions, exclusions, polygon vertices, and inline objects are borrowed from the same request, fully validated before
mutation, checked against pending text offsets, and committed as a placement-independent semantic fingerprint. Styles
are retained and resolved into maximal derived segments. Retained text now drives transactional Unicode 17
extended-grapheme segmentation and Script/Script_Extensions itemization in Rust, with malformed UTF-16 aborting the
same frame transaction. Bidi/run intersection, shaping, and layout are not yet connected, so the Wasm path still emits
an empty Rust plan. Rust shaping/layout → nonempty plan connection and its 25,515-glyph end-to-end timing remain open;
the TypeScript layout benchmark is baseline evidence only.

The retained-text decoder, transaction buffers, and cold capacity control change the optimized artifact from
822,469 / 306,502 / 242,707 to 825,298 / 308,030 / 243,323 raw/gzip/Brotli bytes, a shared-runtime delta of
2,829 / 1,528 / 616 bytes. The per-session 1,024-unit default is runtime memory rather than binary payload. This size
checkpoint does not time shaping or layout because neither stage consumes the retained text yet.

The Unicode-analysis checkpoint uses `unicode-segmentation` 1.13.3 under `no_std`, generated Unicode 17 script tables
shared with the TypeScript generator, and flat reusable session arrays. Session text reservation prewarms both active
and pending analysis arenas; unchanged text does not re-run analysis. The compact Rust script partitions omit
derivable starts. Optimized Wasm measures 964,019 / 360,765 / 288,742 raw/gzip/Brotli bytes versus the prior
895,593 / 335,396 / 264,355 checkpoint. This is shared runtime data and code, not per-font shaping payload. The number
does not claim layout or shaping latency because neither has consumed these products yet.

Retained bidi and run-itemization now consume those products inside the same transaction. UAX #9 output is copied into
reusable active/pending level, class, paragraph, and equal-level-run arrays. Text or root base-direction changes re-run
bidi; unchanged text and style do not. Root direction selects paragraph base level, while a nested stated LTR/RTL value
is preserved separately as a run override and forces level parity only during one style×script×bidi interval sweep.
That sweep excludes mandatory hard-break controls and emits allocation-reusing shaping-run records. Optimized Wasm is
968,086 / 362,664 / 286,438 raw/gzip/Brotli bytes (+4,067 / +1,899 / -2,304 from retained Unicode). HarfRust fallback
shaping has not consumed the runs yet, so plan output and complete-path timing remain open.

Primary-font HarfRust shaping now consumes retained runs during Wasm `text_update`. The legacy batch export and frame
engine share one borrowed run view, actual prewarmed `UnicodeBuffer`, UTF-16 context scratch, and reusable 128-feature
scratch vector. Frame language/features borrow the retained style arena; glyph IDs, clusters, advances, offsets, flags,
and source-run/font records append directly into a pre-reserved A/B shape arena without constructing or serializing a
`ShapeBatchRequest`. A compiled real-Inter test observes plan-cache count 0→1 only after `text_update` and no increase
after an aborted update. Optimized Wasm is 973,367 / 364,517 / 287,942 raw/gzip/Brotli bytes (+5,281 / +1,853 /
+1,504). Ordered fallback is not yet applied, and layout/gather still receive no glyphs, so nonempty plan output and
complete-path timing remain open.

Ordered fallback now consumes the actual shaped result rather than consulting `cmap` or raster coverage. Reusable flat
span and logical-cluster arrays preserve the source run, UTF-16 range, selected stack index, and concrete font. Each pass
shapes current spans, marks a cluster missing when any constituent glyph is zero, restores logical order across RTL
output, and advances only that range to the next font. The pass count is bounded by stack depth; the final spans and
glyph SoA commit together, while any later frame failure discards both pending values. A compiled Inter-to-Noto
Devanagari update constructs exactly two HarfRust plans. Optimized Wasm is 982,356 / 368,183 / 290,439 raw/gzip/Brotli
bytes (+8,989 / +3,666 / +2,497). Layout/gather still receive no glyphs, so nonempty plan output and complete-path timing
remain open.

Unicode 17 line breaking now runs with grapheme/script analysis inside the pending Unicode transaction. The generated
table stores resolved line-break class plus only the punctuation, East Asian, and unassigned-extended-pictographic flags
read by the rule program; it does not embed a generic Unicode property runtime. Scalar records and break results reserve
with session text capacity and retain their high-water marks. All 19,338 official `LineBreakTest` cases match at UTF-16
offsets, and required CRLF/end breaks have focused tests. Optimized Wasm is 1,009,460 / 377,053 / 295,875 raw/gzip/Brotli
bytes (+27,104 / +8,870 / +5,436). Cluster measurement, composition, nonempty plan output, and complete-path timing remain
open.

Retained cluster measurement now consumes final fallback-shaped glyphs and Unicode analysis without a host view. One A/B
SoA stores grapheme UTF-16 bounds, `f64` logical advances, compact safe/allowed/required/hard-break flags, resolved-style
index, source-run/font identity, and one offset-to-cluster index. Glyph advances remain `i32` design units until the
cluster pass scales them once with font size and cached UPEM; letter spacing, word spacing, and hard-break width are
applied in that same ordered accumulation. UAX #14 opportunities are admitted only at a HarfRust-safe next cluster.
Synthetic exact tests cover scaling, both spacing lanes, hard breaks, allowed/required flags, unsafe suppression, and
capacity reuse; real-font compiled Wasm reaches the pass for primary and fallback text. Optimized Wasm is 1,014,577 /
379,510 / 295,708 raw/gzip/Brotli bytes (+5,117 / +2,457 / -167). The Brotli change is recorded as compressor interaction,
not a performance claim. Line composition, nonempty plan output, and complete-path timing remain open.

The first line-composition kernel now advances a grapheme cursor for one caller-supplied width without allocating. It
matches the retained TypeScript break order: word wrapping prefers safe UAX #14 opportunities, then safe HarfRust
boundaries; character wrapping admits every safe grapheme boundary; no-wrap still honors required breaks; and a final
hard break produces the trailing empty line. Width accumulation remains `f64`. This is a kernel proof only: region-band
resolution has not yet connected it to production frame output, so it carries no end-to-end timing or Wasm-size claim.

Declarative flow input now crosses from validated compiler-mapped request bytes into retained A/B Rust state in the
production transaction. Constraints, ordered regions, exclusions, and rebased polygon vertices are owned by the session;
no request pointer survives the call. The rectangle band fast path reuses two bounded slot vectors and subtracts
intersecting exclusion rectangles according to their wrap side, rejecting output beyond `max_slots_per_band`. An exact
fixture resolves a `0..100` region around a `20..40` exclusion to `[0..20, 40..100]`. Polygon intersection and driving
the line cursor remain open. Optimized Wasm is 1,016,720 / 384,593 / 297,049 raw/gzip/Brotli bytes (+2,143 / +5,083 /
+1,341 from the last production Wasm checkpoint); compressed deltas are recorded as transport evidence only.

The bounded polygon band kernel now reuses retained critical-block, crossing, section, and intersection vectors. Region
slots are conservatively intersected across vertex boundaries and intervening linear-edge slabs; horizontal boundary
segments are included before normalized interval intersection. Polygon exclusions project every vertex and band-edge
intersection over the margin-expanded band, then subtract that conservative inline range using the declared wrap side.
Focused fixtures cover a triangular serialized region, a concave U-shaped region that yields two slots, a diamond
exclusion, and rejection when the normalized answer exceeds the public slot envelope. The kernel is not yet called by
frame line placement, so this checkpoint makes no production Wasm-size or end-to-end timing claim.

Horizontal frame layout now calls the retained band and line kernels in production. A flow-layout A/B arena owns lines
and same-baseline fragments; one reusable slot workspace serves the session. Each band starts from the next cluster's
actual fallback-font metrics, composes over every available slot, and performs at most one conservative retry when the
widest first pass discovers taller content. Enlarging a band only intersects more region cross-sections and projects
more exclusion coverage, so the retry cannot expose later clusters. Exact tests place two fragments around one hole,
retry 10 px text to a 20 px mixed-style line with 16 px baseline, and continue four lines through region IDs
`[1, 2, 2, 2]` without balancing. Rebuilt Wasm preserves the frame and real-font/fallback integration tests. Optimized
Wasm is 1,039,404 / 392,671 / 303,705 raw/gzip/Brotli bytes (+22,684 / +8,078 / +6,656). Vertical flow, positioning,
boundary reshaping, semantic/glyph gather, nonempty plan output, and complete-path timing remain open.

Stable render identity now begins at retained text rather than mutable offsets. Parallel A/B UTF-16 unit-ID arrays apply
the exact ordered replacement operations as text, allocate nonzero monotonic IDs only for inserted units, and commit or
abort their allocator transactionally. Grapheme clusters inherit the first unit ID, so unchanged clusters retain
identity when earlier edits shift every following UTF-16 offset; edits within a cluster retain identity while later
content revision can change. An exact abort/retry fixture keeps `[1,2,3,4]`, then an offset-growing edit produces
`[1,5,6,3,4,7]`, proving shifted suffix preservation and deterministic retry. Optimized Wasm is 1,041,582 / 393,214 /
304,815 raw/gzip/Brotli bytes (+2,178 / +543 / +1,110). Per-cluster glyph ranges, glyph identity/revision, positioning,
and nonempty plans remain open.

Each cluster now owns a slice of one flat shaped-glyph index array. Construction counts glyphs by logical cluster,
prefix-sums those counts, then fills the slices while retaining HarfRust's run-local glyph order. This makes RTL and
multi-glyph clusters directly traversable without a per-glyph search, object, or map and reuses all arrays at their high
water mark. An exact reverse-order fixture maps shaped cluster stream `[2,1,0]` to logical slices `[2]`, `[1]`, `[0]`.
Optimized Wasm is 1,043,289 / 394,074 / 304,902 raw/gzip/Brotli bytes (+1,707 / +860 / +87).

The plan pool's allocation-reusing identity lookup is now a shared exact `u32 -> u32` scratch component. Epoch clearing
avoids zeroing the table on every prepare, open addressing resolves probe collisions with full-key equality, and growth
occurs only beyond the retained high water mark. This extraction prevents glyph reconciliation from carrying a second
identity-table implementation. Its isolated size is 1,043,094 / 394,035 / 307,259 raw/gzip/Brotli bytes (-195 / -39 /
+2,357); the Brotli regression is accepted for the single correctness implementation and will be remeasured with its
glyph-reconciliation consumer reachable.

Glyph identity reconciliation now consumes that index inside the cluster transaction. Existing cluster identities reuse
the IDs of surviving glyph ordinals; new clusters and added ordinals consume monotonic nonzero IDs. The allocator cursor
commits only with the pending cluster arena, so abort/retry is exact. A fixture transforms prior per-cluster glyph IDs
`[[1,2],[3]]` into `[[4],[1],[3,5]]` after inserting a cluster and growing the final cluster, then reproduces the result
without growing scratch. Optimized Wasm is 1,044,797 / 395,222 / 307,795 raw/gzip/Brotli bytes (+1,703 / +1,187 / +536).
Final positioned-content comparison will own `content_revision`; shaping identity alone does not overclaim GPU equality.

Horizontal positioning now completes the first nonempty production frame path. Reusable line-level scratch applies UAX
#9 L1 resets before L2 reorders logical cluster slices into visual order. Each editorial slot positions independently,
including direction-aware alignment and non-final-line space justification. HarfRust offsets and actual fallback-font
metrics accumulate in `f64`; baked glyph extents become positive-down primitive bounds after one `f32` narrowing, while
non-rendering glyphs advance the cursor without producing instances. Six F32 semantic lanes carry bounds, font size,
and raster ratio; four U32 lanes carry foreground, cluster, region, and flow-thread identity. Exact float bits plus all
integer and semantic fields determine a monotonic transactional `content_revision`. A unit fixture retains revisions
`[1,2]` across an identical rebuild and advances to `[3,4]` after shifting the slot one pixel. A compiled real-Inter
`text_update` publishes nonzero resource/buffer/patch/primitive/draw tables; the identical next call keeps the same Wasm
buffer and emits zero patches. Optimized Wasm is 1,057,210 / 400,071 / 311,492 raw/gzip/Brotli bytes (+12,413 / +4,849 /
+3,697). This proves plan reachability and minimal no-op updates, not the still-unmeasured 25,515-glyph latency target.

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

Current checkpoint evidence: the retained Rust transaction reaches real Inter shaping, fallback, measured clusters,
horizontal editorial flow, positioning, policy gather, and a nonempty render plan. Exact invalidation lets unchanged
ordered-direct frames publish an empty reuse transaction and lets font-size changes reuse Unicode, bidi, and shaping.
The original one-F32 diagnostic over 25,515 positioned glyphs measured
13.693/0.001/4.090/3.374/13.927/13.986 ms median for
cold/no-op/font-size/full-column-resize/suffix-edit/localized-edit. The unchanged TypeScript comparison measures
55.25/11.90/8.36/38.55 ms for cold/font-size/width/suffix-edit.

The renderer-parity benchmark now validates the real baked Bitmap, MTSDF, and Slug fixtures and emits their canonical
GPU schemas: five Bitmap buffers totaling 48 bytes per instance, seven MTSDF vec4 buffers totaling 112 bytes, and five
Slug float vec4 plus two unsigned vec4 buffers totaling 112 bytes. The same stress text positions 25,515 glyphs and
selects 21,805 renderable raster instances, matching the portable techniques' deliberate omission of absent records.
Policy validation now propagates semantic input dependencies through the straight-line program once and stores a mask
per physical output. Positioning records exact six-F32/four-U32 change bits in a compact side lane without enlarging the
60-byte `PlanGlyph`; ordered-direct and stable-indirect planning intersect the two masks. New or rebound records remain
conservative full writes. For 21,805 renderable instances, full-column resize now emits one position/geometry patch:
170.4 KiB for Bitmap and 340.7 KiB for MTSDF or Slug, down from cold-plan writes of 1,022.1, 2,384.9, and 2,384.9 KiB.
Font-size emits 340.7/340.7/681.4 KiB because Bitmap size and Slug inverse scale also change. Static UV, color, bounds,
effects, band, address, and count outputs remain retained.

Five-warmup/11-sample Bitmap/MTSDF/Slug medians are now 5.812/6.274/7.443 ms for font-size and
4.599/4.916/6.057 ms for full-column resize. Run-to-run latency does not establish a general speedup despite the exact
payload reduction; it confirms that packing and copying were not the dominant cost. The sub-4 ms gate still rejects the
current path, so layout composition is the next measured optimization target. Memory right-sizing, incremental text
edits, Three consumption, and deletion of the duplicate TypeScript path remain foundation-stack gates.

A symbolized temporary no-`std` Wasm profile can now isolate the canonical column-resize case without changing its
default measurement sequence. Positioning is the largest sampled Rust function, followed by policy gather. Positioned
reconciliation now checks the common equal-length/equal-stable-ID order before building the exact identity index; bidi
or flow reordering retains the map fallback. The current five-warmup/11-sample resize medians are
4.414/4.984/5.196 ms for Bitmap/MTSDF/Slug. The inter-run variance is too large to assign a precise causal speedup to
this small change, and all three remain above the median gate.

The common visually LTR lane now proves every retained bidi level is even and that no run has a direction override once
per positioning pass. It then walks logical clusters directly, avoiding per-line L1 scratch copies and visual
cluster/level writes; any odd level or override takes the unchanged complete L1/L2 path. On the same workload, two
adjacent eight-warmup/31-sample Bitmap baselines measured 5.197 and 5.162 ms, while two optimized runs measured 4.849
and 4.878 ms with the same one-patch 170.4 KiB output. Post-change MTSDF and Slug medians are 5.355 and 6.001 ms. This
retains a measured positioning reduction without claiming the still-open sub-4 ms gate. Optimized Wasm is 1,065,857
raw / 403,525 gzip / 318,137 Brotli bytes; Brotli changes by six bytes from D-201, while gzip is sensitive to the new
code layout.

Policy registration now closes the dependency chain in both directions: forward propagation records which F32/U32
input lanes reach each physical buffer, and reverse liveness records which physical buffers consume each operation.
For a positioned update, the frame-level semantic-change union selects active buffers, gather reads only their required
lanes, and scalar/SIMD execution skips operations that reach no active buffer. New glyphs, checkpoints, and changes
outside retained positioning force all inputs. Consecutive glyphs reuse their last resolved font binding and immutable
policy program without caching selection results.

The mechanisms must be evaluated together. Selective gather alone measured 5.027/5.685/6.443 ms for
Bitmap/MTSDF/Slug resize and operation liveness alone measured 4.880/5.329/5.985 ms, against the preceding
4.878/5.355/6.001 ms checkpoint. Combined they measured 4.207/4.833/5.615 ms. Adding binding/program resolution
caching measured 3.981 and 4.120 ms in two canonical full-sequence Bitmap runs, 4.646 ms for MTSDF, and 5.622 ms for
Slug. A separate case-isolated Bitmap process measured 4.799 ms, so process/JIT tiering prevents treating the single
3.981 ms result as closure of the sub-4 ms gate. Optimized Wasm is 1,069,973 raw / 405,888 gzip / 319,558 Brotli
bytes, an increase of 14,116 raw / 2,363 gzip / 1,421 Brotli bytes over D-202.

The first production cutover slice now shares the already initialized `RuntimeShaper` Wasm instance with a typed
text-engine host. The host owns raw policy/font-binding/font-stack registration and session disposal, invokes cold
reservation before pinning when the exact request outgrows its arena, writes directly into retained request memory, and
returns a borrowed view over the published A/B slot. It performs no layout, shaping, or render-plan interpretation in
TypeScript and does not create a second module instance. A compiled-Wasm integration test observes revisions 1/2 and
slots A/B while proving publication B leaves A byte-stable. The Three adapter is not switched by this slice; production
request/policy compilation and plan lowering remain open and are not claimed by the host proof.

The next production slice compiles one Three policy containing the complete first-party Bitmap, MTSDF, and Slug
program set and compiles validated raster artifacts into the corresponding immutable field-major font bindings. The
compiler allocates one final binding request rather than materializing per-field arrays. Exact fixture comparison covers
every emitted lane, and the combined policy registers in the real Wasm module. Technique, program, and resource form
storage identity; `material_id`, clip, depth, and order additionally form draw identity, preserving renderer authority
to share storage or split physical buffers without placing a callback in Wasm. String technique and resource IDs map
deterministically to nonzero `u32` values with UTF-8 FNV-1a, while a runtime-scoped registry rejects collisions across
both domains. This is production policy/binding compilation, not the Three cutover: the public adapter still consumes
legacy paragraph batches until frame-request compilation and render-plan lowering land.

Production frame serialization now covers the complete current request ABI in one final allocation: text mutations;
root and range styles; language and feature payloads; typography, paint, material, and decoration fields; constraints;
sequential rectangle or polygon regions; exclusion holes; inline objects; policy bytes; and revision/fence state. It
contains no shaping, layout, batching, or record-packing logic. For the existing rectangle stress case, the production
bytes are exactly equal to the established benchmark helper, including UTF-16 surrogate handling. A broad structural
fixture covers every variable table and the vertical/polygon/decorated lanes. The remaining proof is deliberately
scoped: normalize actual public Three state into this descriptor, submit a rich request to Rust, then lower the returned
plan; structural serialization alone is not that cutover.

Render-binding identity is now independent from shaping-font identity. A registered binding handle names one loaded
font/technique/resource combination and points to the retained shaping handle it shares; font stacks contain binding
handles. Fallback carries both identities through the shape and cluster arenas, metrics/extents use the shaping handle,
and policy gather uses the binding handle. This makes same-face multi-technique registration and mixed-technique
fallback representable without retaining the SFNT twice. Compiled Wasm proves Inter missing Devanagari advances to a
second binding and emits that binding's different technique in the Rust plan. The cost is one additional retained `u32`
cluster lane. On the unchanged 25,515-positioned/21,805-renderable workload, 8-warmup/31-sample column-resize medians
are 4.217/4.791/5.633 ms for Bitmap/MTSDF/Slug versus 4.120/4.646/5.622 ms at D-203; 6–7% RSD and lower run minima do
not establish a regression. Optimized Wasm is 1,070,580 raw / 402,114 gzip / 319,662 Brotli bytes, +607 / -3,774 / +104
bytes from D-203.

The production Three ownership layer is lazy and runtime-scoped. It keeps the all-technique policy and first-party
binding compilers out of renderer-neutral `TextRuntime`, allocates monotonic binding/stack/session handles, and
reference-counts exact ordered stack sequences. Last release disposes the Rust stack; reverse fallback order has a
distinct identity; retired handles are not immediately reused. A real Inter fixture registers Bitmap and MTSDF against
one shaping handle and proves the lifecycle in compiled Wasm. The coordinator is not yet referenced by the public Three
entry, so this slice establishes cold ownership without claiming the batch/session cutover or a shipping graph change.

The first consumption slice retains a validated plan view instead of decoding Rust records into host objects. One
`DataView` covers the Wasm memory buffer and survives normal A/B slot changes; only `memory.grow()` replaces it. Table
offsets, counts, strides, alignment, and publication bounds are validated once per publication, after which the Three
lowerer can apply patches and draws by fixed offsets. A real compiled-Wasm fixture produces nonempty resource, buffer,
patch, primitive, and draw tables through this view. GPU realization and the public Three import remain open.

The Three cutover must also preserve the existing batch meaning: one `TextGroup` contains multiple independent
paragraphs. Current Rust constraints describe multiple region flows over one retained prose stream, so assigning one
session to each `Text` would multiply boundary calls and physical buffers rather than preserve batching. One engine
session therefore retains paragraph-keyed child state and one shared planner/publication. Stable glyph/content IDs come
from session-wide monotonic namespaces, and Rust appends each child's positioned SoA into one pre-reserved gather
workspace. The append kernel is allocation-free after `begin(total_records)` and has an exact two-layout proof;
paragraph-keyed mutation/removal and atomic child commit remain the next implementation slice. Adjacent rebuilt-Wasm
Bitmap column-resize medians are 4.083 and 4.078 ms at 8 warmups/31 samples with 5.8%/6.1% RSD, so this slice makes no
speedup claim and shows no material regression. Optimized Wasm is 1,070,685 / 402,154 / 319,914 raw/gzip/Brotli bytes.

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
