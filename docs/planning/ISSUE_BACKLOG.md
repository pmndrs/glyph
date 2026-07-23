---
type: Issue Catalog
title: Issue-sized backlog
description: Provides issue-sized work candidates whose execution priority is controlled by the canonical roadmap.
status: proposed-catalog
tags: [issues, roadmap, planning]
---

# Issue-sized backlog

> Execution order is defined only by the [canonical roadmap](/roadmap/ROADMAP.md). This catalog supplies issue-sized decomposition and future work; its older queue headings are not a competing roadmap.

Status: proposed  
Sizing: S is roughly one focused PR, M may need two PRs, and L must be split before implementation.

This backlog is ordered by dependency. Issue titles are ready to copy into GitHub after maintainers approve the project brief.

## Historical decomposition of the one-font integration slice

The issues below remain useful implementation-sized candidates for milestones 0–7, but the [canonical roadmap](/roadmap/ROADMAP.md) controls their execution order. The broader epics remain later work unless that roadmap activates them.

### V0.1. Review bake, loader, runtime API, identity, and data contracts — S

Dependencies: none

Acceptance criteria:

- `(FontHandle, LocalGlyphId)` and layout font slots are accepted or revised;
- one-face-per-asset and many-fonts-per-registry ownership is decided;
- shared-core/Node-host/Worker-host ownership and canonical-path convergence are accepted or revised;
- shaped/layout typed views, memory lifetimes, and explicit presentation selection are reviewed;
- subsetting/remapping, compiled IR, SIMD, MTSDF, and Slug generation remain outside V0.

### V0.2. Pin the font fixture and capture shaping and bitmap oracles — M

Dependencies: V0.1

Acceptance criteria:

- one redistributable font revision, license, source URL, and SHA-256 are recorded;
- HarfRust, HarfBuzz, and Unicode versions are pinned;
- exact UTF-16 cases and field-for-field oracle results are checked in;
- expected bitmap pixels/bounds preserve source glyph IDs and record generator provenance.

### V0.3. Scaffold the interactive benchmark lab and headless runner — M

Dependencies: V0.1, V0.2

Acceptance criteria:

- `apps/benchmarks` provides one local browser shell with target, scenario, capability, and control contracts;
- selected target/scenario/controls round-trip through a shareable URL;
- unsupported target/scenario combinations remain visible with missing capabilities;
- the headless smoke runner imports the same registry, sample policy, validation, and result schema as the UI;
- independent bundle entries report JavaScript and Wasm sizes without importing every optional renderer/generator;
- one deterministic fixture target exports raw samples and environment metadata without claiming product performance.

Planning baseline: [`BENCHMARK_PLAN.md`](BENCHMARK_PLAN.md), using [`isaac-mason/js-physics-benchmarks`](https://github.com/isaac-mason/js-physics-benchmarks) as the structural precedent.

### V0.4. Implement the minimal shared baker and Node host — M

Dependencies: V0.2, V0.3

Acceptance criteria:

- a host-independent request retains shaping bytes and generates one grayscale bitmap strike;
- canonical `PMNDRS_font` bytes contain provenance and flat GPU-ready records;
- Node JS API and thin CLI call the same core;
- the core contains no filesystem/CLI logic and does not subset, remap, or compile layout;
- deterministic output, bake time, peak memory, and size baselines are recorded.

### V0.5. Implement the baked-first loader and lazy Worker fallback — M

Dependencies: V0.1, V0.4

Acceptance criteria:

- a valid baked asset reaches the canonical validator without importing fallback code;
- a miss warns once in development, dynamically imports the runtime baker library, starts its Worker host, imports the selected generator module, and transfers source/result buffers;
- Node and Worker output have identical canonical sections;
- fallback output re-enters the normal canonical load path;
- invalid baked assets produce structured diagnostics; no `forceRuntime` option exists;
- in-flight and completed loads are deduplicated in memory;
- bundle-graph tests prove the common path excludes the runtime baker library, Wasm bake core, and generator modules.

### V0.6. Implement the coarse runtime HarfRust Wasm boundary and registry — M

Dependencies: V0.4, V0.5

Acceptance criteria:

- canonical assets register/dispose through opaque handles and copy shaping bytes once;
- parsed HarfRust state and shape plans are reused;
- one batch returns font-scoped IDs, UTF-16 clusters, four positions, and flags as typed views;
- output matches pinned HarfRust fixtures;
- malformed ranges/counts/pages fail without per-glyph object construction;
- cold/warm size, latency, memory, and boundary-call baselines are recorded.

### V0.7. Implement one-font JS paragraph layout — M

Dependencies: V0.6

Acceptance criteria:

- the reference paragraph shapes and wraps at wide and narrow widths;
- measured clusters and line source ranges have golden outputs;
- ordinary width reflow reuses broad shaping;
- layout includes a font table/slots and never measures with presentation bounds;
- boundary-sensitive ranges use at most one reshape batch.

### V0.8. Render the generated bitmap on WebGPU and WebGL2 — M

Dependencies: V0.3, V0.5–V0.7

Acceptance criteria:

- explicit bitmap plugin prepares canonical flat records/texture payloads;
- instance generation consumes positioned `(fontSlot, glyphId)` output;
- GPU upload performs no per-glyph reconstruction/repacking;
- clipping/resize references pass on WebGPU and WebGL2;
- first-frame, upload, GPU-time, and GPU-memory baselines are stored.

### V0.9. Harden and review the completed vertical slice — M

Dependencies: V0.2–V0.8

Acceptance criteria:

- cancellation, stale handles, limits, corrupt inputs, disposal, and view invalidation are tested;
- two registrations remain isolated by handle/cache/resource identity;
- main, Node bake, Worker bake, and presentation imports stay separated;
- performance claims link to raw evidence and accepted contracts become ADRs;
- the next font or presentation is additive.

## Epic A — Decisions and reference corpus

### A1. Accept the V1 product and scope brief — S

Dependencies: none

Acceptance criteria:

- maintainers resolve every decision-gate item in `PROJECT_BRIEF.md`;
- edits are reflected in architecture and phase documents;
- deferred features have no implied V1 commitment.

### A2. Pin shaping and Unicode reference versions — S

Dependencies: A1

Acceptance criteria:

- HarfRust, HarfBuzz, and Unicode versions are recorded;
- upgrade policy states how fixture changes are reviewed;
- known HarfRust differences have initial tracking entries.

### A3. License and select the initial font corpus — M

Dependencies: A2

Acceptance criteria:

- corpus covers Latin, Arabic, Devanagari/USE, emoji/ZWJ, icons, and CJK subset;
- redistribution and CI use are documented per font;
- each fixture has text, script, language, direction, and feature cases.

### A4. Audit Three Flatland Slug prior art — M

Dependencies: A1

Acceptance criteria:

- relevant files and algorithms are inventoried;
- each item is classified as port, rewrite, reference only, or retire;
- license/attribution requirements are recorded;
- coupling to Three Flatland types is identified.

Research snapshot: [`SLUG_AUDIT.md`](SLUG_AUDIT.md). Implementation should begin by reviewing and accepting or revising its dispositions rather than repeating discovery.

### A5. Define benchmark methodology and result schema — M

Dependencies: A1, A3

Acceptance criteria:

- cold/warm, cached/uncached, native/Wasm, scalar/SIMD cases are defined;
- browser and machine metadata is recorded with results;
- raw/Brotli/gzip sizes are separate metrics;
- benchmark variance and regression thresholds are documented.

Planning baseline: [`BENCHMARK_PLAN.md`](BENCHMARK_PLAN.md).

### A6. Capture reproducible font and icon payload baselines — M

Dependencies: A3, A5

Acceptance criteria:

- pinned Inter, Font Awesome, and Lucide sources/artifacts have licenses, hashes, descriptors, and generator revisions;
- reports separate shared shaping/metrics, serialized presentation records, container overhead, transport bytes, and GPU-resident bytes;
- bitmap, MSDF/MTSDF, and Slug are measured independently with atlas dimensions, formats, mipmaps, and occupancy;
- selected-icon and full-library Lucide cases are separate;
- Node and Worker generators emit equivalent canonical report values and pixels;
- modeled values in the [font payload budget](PAYLOAD_BUDGET.md) are replaced by checked-in raw reports without changing visual or conformance gates.

### A7. Register the PMNDRS glTF vendor prefix — S

Dependencies: A1

Acceptance criteria:

- Poimandres maintainers approve the project name, public contact, requested `PMNDRS` prefix, and intended-use summary;
- an authorized maintainer files the issue body in the [registration draft](GLTF_EXTENSION_REGISTRATION.md) against `KhronosGroup/glTF`;
- prefix reservation is described separately from extension specification, implementation, and Khronos ratification;
- the resulting registry issue and `extensions/Prefixes.md` entry are linked from D-022;
- the `PMNDRS_font` specification PR remains blocked on an accepted schema, public reference implementation, validator fixtures, and reproducible sample assets.

## Epic B — Shaping contract experiment

### B1. Specify the experimental shaped-buffer ABI — M

Dependencies: A1, A2

Acceptance criteria:

- request batching, memory ownership, growth, and invalidation are specified;
- output fields include glyph ID, UTF-16 cluster, four positions, and flags;
- ID and coordinate widths have overflow behavior;
- no presentation fields enter the ABI.

### B2. Define three-way conformance fixture format — M

Dependencies: A2, A3, B1

Acceptance criteria:

- one fixture can be run through HarfBuzz, HarfRust, and the experimental shaper;
- every output field can be compared;
- allowlisted differences require a reason and upstream link;
- fixture version metadata is mandatory.

Planning baseline: [`CONFORMANCE_PLAN.md`](CONFORMANCE_PLAN.md).

### B3. Prototype a coarse-grained HarfRust Wasm call — M

Dependencies: B1

Acceptance criteria:

- one call shapes multiple runs or a paragraph batch;
- memory views are reused rather than reconstructed per glyph;
- a benchmark quantifies boundary overhead;
- no optimized lookup IR is introduced.

### B4. Establish conformance and fuzzing harnesses — M

Dependencies: B2, B3

Acceptance criteria:

- representative fixtures pass the pinned HarfRust baseline;
- random/structured Unicode input compares all output fields;
- crashes and malformed-input behavior become reproducible seeds;
- CI duration and corpus tiers are documented.

## Epic C — Binary model and GLB

### C1. Validate the `PMNDRS_font` shaping profile and metric envelope — M

Dependencies: A1, B1

Acceptance criteria:

- the closed SFNT table whitelist produces a valid single static face;
- duplicated glyph count, units, and line metrics agree with the SFNT;
- shaping hash and provenance hashes are deterministic;
- golden and corrupt payloads exercise every validation rule in the shaping contract.

### C2. Prove full-Unicode cmap behavior through the canonical shaping face — M

Dependencies: C1, A3

Acceptance criteria:

- ASCII, BMP, supplementary-plane, missing glyph, and variation-sequence cases work;
- UTF-16 clusters remain independent from Unicode scalar lookup;
- HarfRust reads the retained cmap without a JavaScript mapping table;
- size and lookup timing are reported against the original source face.

### C3. Validate shared metrics and identity — S

Dependencies: C1

Acceptance criteria:

- canonical advances and glyph properties come from the retained shaping face;
- stored metrics and i32 working/output coordinates are distinguished;
- no presentation duplicates shaping metrics.

### C4. Validate and freeze the experimental `PMNDRS_font` schemas — M

Dependencies: C1, C2, C3

Acceptance criteria:

- every checked-in schema validates golden combined and split assets;
- embedded, URI-resolved, and application-resolved presentation references are exercised;
- reciprocal shaping-hash and `extensionsRequired` behavior are explicit;
- a schema change updates the contract, golden bytes, and version analysis together.

### C5. Prototype deterministic pack/unpack golden tests — M

Dependencies: C1–C4

Acceptance criteria:

- repeated packs are byte-identical;
- every section has round-trip and corrupt-range cases;
- JS and Rust readers agree on offsets and values;
- no production loader API is exposed.

## Epic D — Presentation specifications

### D1. Validate presentation binding and packaging — S

Dependencies: C1, C3

Acceptance criteria:

- combined and split GLBs attach identical presentation records;
- embedded, external-URI, and resolver-provided resources are representable;
- shaping hash, glyph count, and ID width mismatches reject attachment;
- per-glyph absence uses the specified `0xffff` sentinel.

### D2. Implement golden Slug V0 packing fixtures — M

Dependencies: A4, D1

Acceptance criteria:

- 40-byte records, RGBA16F curves, u32 headers, and glyph-local u16 references match the contract;
- address reconstruction is exact across contours, endpoint sharing, and row padding;
- overflow and multi-page behavior reject or page without truncation;
- no nested runtime reconstruction or duplicate source/GPU curve representation remains.

### D3. Implement golden MSDF/MTSDF V0 packing fixtures — M

Dependencies: D1

Acceptance criteria:

- 20-byte records and lossless linear RGBA8 KTX2 pages match the contract;
- shared advances are absent and missing glyphs use `0xffff`;
- MSDF alpha is opaque and MTSDF alpha stores true signed distance;
- compressed variants remain additional and quality-gated.

### D4. Implement golden generated-bitmap V0 fixtures — M

Dependencies: D1

Acceptance criteria:

- 20-byte records, ppem, fixed-point plane bounds, pages, and sentinel match the contract;
- the first descriptor uses grayscale, no hinting, explicit oversampling and padding;
- lossless linear R8 KTX2 is present and shared advances are absent;
- Node and Worker records and decoded pixels are identical.

### D5. Validate direct GPU upload constraints — M

Dependencies: D2–D4

Acceptance criteria:

- WebGPU and target WebGL upload paths are prototyped;
- required row/section alignment is measured;
- any unavoidable decode/transcode step is named honestly;
- no per-glyph repacking is required.

### D6. Specify Slug color layers and SVG icon-font baking — L

Dependencies: D1, D2, E1

Acceptance criteria:

- COLRv0/COLRv1, OpenType-SVG, and manifest-backed SVG icon support matrices name every accepted, flattened, rasterized, or rejected operation;
- supported vectors bake into ordinary Slug geometry plus flat palette, paint, transform, clip, and layer records;
- shaping continues to return the original font-scoped glyph ID;
- runtime drawing parses no SVG document and executes no script, animation, filter, or external resource;
- generator and renderer remain optional dynamic imports.

### D7. Specify embedded color-bitmap emoji presentation — M

Dependencies: D1, D4, E1

Acceptance criteria:

- CBDT/CBLC and `sbix` extraction, strike choice, origin, bounds, and missing-glyph behavior are explicit;
- color space, premultiplication, texture format, decode/transcode, atlas paging, and GPU upload are specified;
- shared shaping advances and offsets are not duplicated or replaced;
- bitmap-color support remains optional and tree-shakable.

### D8. Specify the shared game-text paint and effects contract — M

Dependencies: D1–D4

Acceptance criteria:

- fill color, opacity, outline color/width, and hard-shadow color/offset are baseline fields;
- soft shadow/glow, gradients, textures, and source palettes are optional extensions;
- per-span and per-glyph paint changes reuse shaping and layout data;
- screen-pixel, presentation-pixel, em, and world-space units are not conflated;
- each backend reports supported effects and numeric limits such as MSDF distance range;
- unsupported effects return an explicit capability result instead of silently changing technique or quality.

### D9. Prototype exact Slug band packing and optional curve compression — M

Dependencies: D2, D5, A6

Acceptance criteria:

- baseline, exact-band, and compressed-curve variants use identical source glyphs and produce the report defined in [GPU compression](GPU_COMPRESSION.md);
- u32 headers and u16 glyph-local references reproduce every addressed curve sequence bit-for-bit, with explicit overflow behavior;
- RGBA16F remains the reference/fallback curve format;
- UASTC/BC7/ASTC curve variants record selected device formats and pass the established visual/geometric gates at UI through extreme magnification scales;
- WebGPU and WebGL2 capability/fallback behavior is demonstrated;
- transport bytes, dynamic transcoder bytes, transcode/upload time, resident GPU memory, shader cost, and frame time are reported separately;
- no KTX2/transcoder module appears in an application graph that does not require it.

## Epic E — Advanced compiler and baker extensions

The V0 queue already establishes the shared core, Node/Worker hosts, canonical writer, and one bitmap generator. This epic adds optimization and scale features after that foundation is measured.

### E1. Define source-font and canonical-outline interfaces — M

Dependencies: A2, A4

Acceptance criteria:

- one parsed/instanced outline feeds all presentation generators;
- source glyph IDs and packed glyph IDs cannot be confused;
- metrics and outline coordinate conventions are explicit.

### E2. Prototype glyph subsetting and shaping closure — M

Dependencies: A3, E1, C2

Acceptance criteria:

- requested code points expand through retained substitutions/attachments;
- every emitted glyph has canonical metrics;
- missing presentations are reported rather than silently misindexed;
- corpus tests cover ligatures and marks.

### E3. Prototype dense glyph remapping — M

Dependencies: E2, C3

Acceptance criteria:

- cmap, shaping data, and presentation records share the remap;
- `.notdef` behavior is explicit;
- `u16` overflow is rejected or upgrades through a specified path.

### E4. Extend native/worker diagnostics for advanced compilation — M

Dependencies: C5, E1–E3

Acceptance criteria:

- the existing core remains free of host-specific business logic;
- progress, cancellation, warning, and failure records are defined;
- output diagnostics separate shaping and presentation sizes/times.

### E5. Design runtime bake cache identity — S

Dependencies: E4

Acceptance criteria:

- key inputs cover every byte-affecting option/version;
- cache invalidation is deterministic;
- privacy/storage and quota failure behavior are documented.

### E6. Prototype worker transfer and resource limits — M

Dependencies: E4, E5

Acceptance criteria:

- source and result buffers are transferred, not cloned;
- main-thread responsiveness is measured;
- cancellation and hard memory/atlas limits are tested;
- cached output enters the same load path as offline output.

## Epic F — Paragraph engine

### F1. Specify paragraph, span, constraint, and layout models — M

Dependencies: B1

Acceptance criteria:

- source ranges are UTF-16 based;
- logical and visual order are distinct;
- wrap, alignment, height, max-lines, and overflow policies are explicit;
- models do not reference a presentation technique.

### F2. Define measured-cluster and break-opportunity model — M

Dependencies: F1, B1

Acceptance criteria:

- glyph ranges map to source ranges;
- UAX #14 opportunities, UAX #29 boundaries, and shaping unsafe flags are representable;
- ligature, mark, ZWJ, and surrogate cases have fixtures.

### F3. Prototype greedy reflow using cached shapes — M

Dependencies: F2

Acceptance criteria:

- width-only Latin reflow performs no shaping call;
- overlong indivisible clusters have a defined emergency policy;
- line metrics and trailing-space behavior are specified.

### F4. Prototype batched boundary reshaping — M

Dependencies: F3, B3

Acceptance criteria:

- all changed line ranges cross Wasm in one call;
- context range versus emitted range is explicit;
- Arabic, soft-hyphen, contextual, and ellipsis fixtures are included;
- resize benchmark reports reshape ratio and call count.

### F5. Add bidi line ordering and RTL fixtures — M

Dependencies: F1, F4

Acceptance criteria:

- paragraph bidi analysis and per-line visual order are distinct;
- source text is never reversed;
- mixed LTR/RTL line wrapping has reference fixtures.

## Epic G — Optimization experiments

Each issue depends on the reference and benchmark harnesses. None is required to validate the initial product architecture.

### G1. Benchmark direct baked cmap and metrics — M

Dependencies: B4, C2, C3, E3

Acceptance criteria:

- correctness matches the reference path;
- cold/warm speed, size, and memory are reported;
- go/no-go decision is recorded.

### G2. Benchmark compiled coverage/class operations — M

Dependencies: G1

Acceptance criteria: same as G1, with representation-size comparisons.

### G3. Benchmark single substitution and pair positioning IR — M

Dependencies: G2

Acceptance criteria: same as G1, including class and sparse fonts.

### G4. Benchmark ligature and attachment IR — M

Dependencies: G3

Acceptance criteria: same as G1, including Arabic/Indic/mark-heavy fixtures.

### G5. Add SIMD only to profiled kernels — M

Dependencies: G1–G4, A5

Acceptance criteria:

- scalar and SIMD outputs are identical;
- per-kernel and whole-run results are reported;
- short-string regressions and module-size cost are included;
- scalar fallback policy is defined.

### G6. Decide whether per-font AOT Wasm merits a prototype — S

Dependencies: G1–G5

Acceptance criteria:

- decision uses measured interpreter bottlenecks;
- module compilation/cache cost and multi-font payload are included;
- browser-time JIT remains separately scoped.

## Epic H — Autoresearch performance loop

No optimization in this epic can weaken correctness or visual-quality gates. Approximate quality/performance modes require separate product decisions.

### H1. Define the autoresearch experiment manifest and evidence schema — S

Dependencies: A5, B4

Acceptance criteria:

- hypothesis, immutable base commit, changed variables, target workloads, guard workloads, backends, metrics, and quality policy are required;
- result states include accepted, rejected, inconclusive, and variant-only;
- raw samples, generated shader/code output, environment data, and image diffs have stable artifact locations;
- the agent cannot change acceptance criteria after collecting results.

### H2. Build the reproducible interleaved A/B runner — L

Dependencies: H1, D5

Acceptance criteria:

- immutable base and candidate builds run in randomized or alternating order;
- warmup, viewport, DPR, vsync, power/thermal notes, and environment metadata are controlled or recorded;
- medians, tails, dispersion, and confidence/noise thresholds are reported from raw samples;
- WebGPU and WebGL2 are supported where the target renderer supports both;
- local runs never push, merge, publish, or replace baselines.

### H3. Build the strict presentation quality guard corpus — L

Dependencies: B4, D2–D4

Acceptance criteria:

- Latin, Arabic marks, CJK, icons, intricate SVG, grazing curves, holes/overlap, scale, minification, magnification, and transform cases are represented;
- deterministic binary/reference results use exact equality;
- cross-device raster variance is characterized separately from candidate-only differences;
- fixtures and tolerances cannot be modified by the same experiment that relies on them.

### H4. Reproduce proven Three Flatland Slug optimizations — L

Dependencies: D2, H2, H3

Acceptance criteria:

- dynamic loops, shader hoisting, structural expensive branches, compact exact band data, band-list deduplication, and exact bounds are each evaluated independently;
- each retained change has new-repository end-to-end evidence and passes the full quality guard;
- neutral or regressing changes are recorded rather than compounded;
- no lower-precision, approximate-minification, or grazing-quality tradeoff enters the baseline.

### H5. Run the first novel Slug autoresearch campaign — L

Dependencies: H4, licensed dense CJK/icon/SVG corpus

Acceptance criteria:

- adaptive bands and a build-time hull variant are evaluated first;
- a workload-specific variant adds no runtime/bundle cost to sources that do not select it;
- accepted experiments exceed the measured end-to-end noise gate without guard-workload regressions;
- every result is presented for human review as a local evidence commit and is not pushed automatically.
